//! One-shot clipboard flow for ordinary applications that accept paste.
//! It never injects text or submits forms: it only changes the clipboard once
//! after the user presses Tab during the explicitly armed 20-second window.
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

#[derive(Clone, Default)]
pub struct QuickPaste(Arc<Mutex<Option<Arc<AtomicBool>>>>);

impl QuickPaste {
    pub fn cancel(&self) {
        if let Ok(state) = self.0.lock() {
            if let Some(flag) = state.as_ref() {
                flag.store(false, Ordering::SeqCst);
            }
        }
    }
    fn finish(&self, flag: &Arc<AtomicBool>) {
        if let Ok(mut state) = self.0.lock() {
            if state
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, flag))
            {
                state.take();
            }
        }
    }
    fn arm(&self, flag: Arc<AtomicBool>) -> Result<(), String> {
        let mut state = self.0.lock().map_err(|_| "连续填写服务不可用。")?;
        if state.is_some() {
            return Err("已有连续填写正在等待，请先取消。".into());
        }
        *state = Some(flag);
        Ok(())
    }
}

fn require_floating(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "floating" {
        Ok(())
    } else {
        Err("仅悬浮轮盘可操作。".into())
    }
}

#[tauri::command]
pub fn quick_paste_accounts(
    window: tauri::WebviewWindow,
) -> Result<Vec<crate::vault::Metadata>, String> {
    require_floating(&window)?;
    window
        .state::<crate::vault_service::VaultService>()
        .floating_entries()
}

#[tauri::command]
pub fn quick_paste_arm(window: tauri::WebviewWindow, id: u32) -> Result<&'static str, String> {
    require_floating(&window)?;
    let service = window
        .state::<crate::vault_service::VaultService>()
        .inner()
        .clone();
    let epoch = service.floating_epoch(id)?;
    let clipboard = window
        .state::<crate::clipboard::ClipboardService>()
        .inner()
        .clone();
    let flag = Arc::new(AtomicBool::new(true));
    window.state::<QuickPaste>().arm(flag.clone())?;
    let password_only = service.with_floating_field(epoch, id, "user", |value| {
        if value.is_empty() {
            Ok(true)
        } else {
            clipboard.copy_text(value).map(|_| false)
        }
    });
    match password_only {
        Ok(true) => {
            let result = service
                .with_floating_field(epoch, id, "password", |value| clipboard.copy_text(value));
            window.state::<QuickPaste>().finish(&flag);
            result?;
            return Ok("password");
        }
        Ok(false) => {}
        Err(error) => {
            window.state::<QuickPaste>().finish(&flag);
            return Err(error);
        }
    }
    #[cfg(windows)]
    {
        let app = window.app_handle().clone();
        let service_for_worker = service.clone();
        let quick_paste = window.state::<QuickPaste>().inner().clone();
        let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
        let worker_flag = flag.clone();
        std::thread::spawn(move || {
            run_tab_wait(
                app,
                service_for_worker,
                clipboard,
                epoch,
                id,
                worker_flag,
                quick_paste,
                ready_tx,
            )
        });
        match ready_rx.recv_timeout(Duration::from_secs(2)) {
            Ok(Ok(())) => {}
            Ok(Err(error)) => return Err(error),
            Err(_) => {
                flag.store(false, Ordering::SeqCst);
                return Err("快捷键监听启动超时，请重试。".into());
            }
        }
    }
    #[cfg(not(windows))]
    {
        flag.store(false, Ordering::SeqCst);
        window.state::<QuickPaste>().finish(&flag);
        return Err("一次性 Tab 助手仅支持 Windows。".into());
    }
    Ok("username")
}

#[tauri::command]
pub fn quick_paste_cancel(window: tauri::WebviewWindow) -> Result<(), String> {
    require_floating(&window)?;
    window.state::<QuickPaste>().cancel();
    Ok(())
}

#[cfg(windows)]
static KEY_EVENT: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);

#[cfg(windows)]
fn quick_paste_key(message: u32, vk_code: u32) -> u8 {
    if message != 0x0100 {
        return 0;
    }
    match vk_code {
        9 => 1,
        27 => 2,
        _ => 0,
    }
}

#[cfg(windows)]
unsafe extern "system" fn keyboard_hook(
    code: i32,
    wparam: windows_sys::Win32::Foundation::WPARAM,
    lparam: windows_sys::Win32::Foundation::LPARAM,
) -> windows_sys::Win32::Foundation::LRESULT {
    use windows_sys::Win32::UI::WindowsAndMessaging::{CallNextHookEx, HC_ACTION, KBDLLHOOKSTRUCT};
    if code == HC_ACTION as i32 {
        let key = unsafe { *(lparam as *const KBDLLHOOKSTRUCT) };
        let event = quick_paste_key(wparam as u32, key.vkCode);
        if event == 2 {
            KEY_EVENT.store(event, Ordering::SeqCst);
        } else if event == 1 {
            let _ = KEY_EVENT.compare_exchange(0, event, Ordering::SeqCst, Ordering::SeqCst);
        }
    }
    unsafe { CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam) }
}

#[cfg(windows)]
fn run_tab_wait(
    app: tauri::AppHandle,
    service: crate::vault_service::VaultService,
    clipboard: crate::clipboard::ClipboardService,
    epoch: u64,
    id: u32,
    active: Arc<AtomicBool>,
    quick_paste: QuickPaste,
    ready: std::sync::mpsc::SyncSender<Result<(), String>>,
) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, PeekMessageW, SetWindowsHookExW, UnhookWindowsHookEx, MSG, PM_REMOVE,
        WH_KEYBOARD_LL,
    };
    KEY_EVENT.store(0, Ordering::SeqCst);
    let hook =
        unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook), std::ptr::null_mut(), 0) };
    if hook.is_null() {
        active.store(false, Ordering::SeqCst);
        quick_paste.finish(&active);
        let _ = ready.send(Err("快捷键监听启动失败，请重试。".into()));
        let _ = app.emit_to("floating", "lime-quick-paste", "unavailable");
        return;
    }
    let _ = ready.send(Ok(()));
    let deadline = Instant::now() + Duration::from_secs(20);
    while active.load(Ordering::SeqCst) && Instant::now() < deadline {
        let mut message = MSG::default();
        while unsafe { PeekMessageW(&mut message, std::ptr::null_mut(), 0, 0, PM_REMOVE) } != 0 {
            unsafe {
                DispatchMessageW(&message);
            }
        }
        if !active.load(Ordering::SeqCst) {
            break;
        }
        match KEY_EVENT.swap(0, Ordering::SeqCst) {
            2 => {
                active.store(false, Ordering::SeqCst);
                unsafe {
                    UnhookWindowsHookEx(hook);
                }
                quick_paste.finish(&active);
                let _ = app.emit_to("floating", "lime-quick-paste", "cancelled");
                return;
            }
            1 => {
                let result = service
                    .with_floating_field(epoch, id, "password", |value| clipboard.copy_text(value));
                active.store(false, Ordering::SeqCst);
                unsafe {
                    UnhookWindowsHookEx(hook);
                }
                quick_paste.finish(&active);
                let outcome = if result.is_ok() {
                    "password-ready"
                } else {
                    "expired"
                };
                let _ = app.emit_to("floating", "lime-quick-paste", outcome);
                return;
            }
            _ => {}
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    active.store(false, Ordering::SeqCst);
    unsafe {
        UnhookWindowsHookEx(hook);
    }
    quick_paste.finish(&active);
    KEY_EVENT.store(0, Ordering::SeqCst);
    let _ = app.emit_to("floating", "lime-quick-paste", "expired");
}

#[cfg(test)]
mod tests {
    use super::quick_paste_key;

    #[test]
    fn hook_accepts_only_tab_and_escape_key_downs() {
        assert_eq!(quick_paste_key(0x0100, 9), 1);
        assert_eq!(quick_paste_key(0x0100, 27), 2);
        assert_eq!(quick_paste_key(0x0101, 9), 0);
        assert_eq!(quick_paste_key(0x0104, 9), 0);
        assert_eq!(quick_paste_key(0x0100, 65), 0);
    }
}
