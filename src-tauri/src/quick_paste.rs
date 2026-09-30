//! One-shot clipboard flow for ordinary applications that accept paste.
//! It never injects text or submits forms: it only changes the clipboard once
//! after the user presses Tab during the explicitly armed 20-second window.
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

#[derive(Default)]
pub struct QuickPaste(Mutex<Option<Arc<AtomicBool>>>);

impl QuickPaste {
    pub fn cancel(&self) {
        if let Ok(mut state) = self.0.lock() {
            if let Some(flag) = state.take() {
                flag.store(false, Ordering::SeqCst);
            }
        }
    }
    fn arm(&self, flag: Arc<AtomicBool>) -> Result<(), String> {
        let mut state = self.0.lock().map_err(|_| "连续填写服务不可用。")?;
        if state
            .as_ref()
            .is_some_and(|current| current.load(Ordering::SeqCst))
        {
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
            window.state::<QuickPaste>().cancel();
            result?;
            return Ok("password");
        }
        Ok(false) => {}
        Err(error) => {
            window.state::<QuickPaste>().cancel();
            return Err(error);
        }
    }
    #[cfg(windows)]
    {
        let app = window.app_handle().clone();
        let service_for_worker = service.clone();
        std::thread::spawn(move || {
            run_tab_wait(app, service_for_worker, clipboard, epoch, id, flag)
        });
    }
    #[cfg(not(windows))]
    {
        flag.store(false, Ordering::SeqCst);
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
fn run_tab_wait(
    app: tauri::AppHandle,
    service: crate::vault_service::VaultService,
    clipboard: crate::clipboard::ClipboardService,
    epoch: u64,
    id: u32,
    active: Arc<AtomicBool>,
) {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_ESCAPE, VK_TAB};
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut was_down = false;
    while active.load(Ordering::SeqCst) && Instant::now() < deadline {
        let tab_down = unsafe { GetAsyncKeyState(i32::from(VK_TAB)) < 0 };
        let escape_down = unsafe { GetAsyncKeyState(i32::from(VK_ESCAPE)) < 0 };
        if escape_down {
            active.store(false, Ordering::SeqCst);
            let _ = app.emit_to("floating", "lime-quick-paste", "cancelled");
            return;
        }
        if tab_down && !was_down {
            let result = service
                .with_floating_field(epoch, id, "password", |value| clipboard.copy_text(value));
            active.store(false, Ordering::SeqCst);
            let message = if result.is_ok() {
                "password-ready"
            } else {
                "expired"
            };
            let _ = app.emit_to("floating", "lime-quick-paste", message);
            return;
        }
        was_down = tab_down;
        std::thread::sleep(Duration::from_millis(10));
    }
    active.store(false, Ordering::SeqCst);
    let _ = app.emit_to("floating", "lime-quick-paste", "expired");
}
