//! User-triggered, one-shot Steam paste. No legacy prototype or UIA dependency.
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{Emitter, Manager};

#[derive(Default)]
pub struct SteamFill(Mutex<Option<Arc<AtomicBool>>>);
impl SteamFill {
    pub fn cancel(&self) {
        if let Ok(pending) = self.0.lock() {
            if let Some(flag) = pending.as_ref() {
                flag.store(false, Ordering::SeqCst);
            }
        }
    }
}
pub fn allowed_process(path: &str) -> bool {
    matches!(
        path.rsplit(['\\', '/'])
            .next()
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "steam.exe" | "steamwebhelper.exe"
    )
}

#[tauri::command]
pub fn steam_fill_cancel(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("仅主窗口可操作。".into());
    }
    window.state::<SteamFill>().cancel();
    Ok(())
}
#[tauri::command]
pub fn steam_fill_arm(window: tauri::WebviewWindow, id: u32, field: String) -> Result<(), String> {
    if window.label() != "main" {
        return Err("仅主窗口可操作。".into());
    }
    if !matches!(field.as_str(), "user" | "password") {
        return Err("只支持用户名或密码单项。".into());
    }
    let service = window
        .state::<crate::vault_service::VaultService>()
        .inner()
        .clone();
    let epoch = service.steam_epoch(id)?;
    let state = window.state::<SteamFill>();
    let mut pending = state.0.lock().map_err(|_| "填写服务不可用。")?;
    if pending.as_ref().is_some_and(|f| f.load(Ordering::SeqCst)) {
        return Err("已有待填写项目，请先取消或完成。".into());
    }
    let active = Arc::new(AtomicBool::new(true));
    *pending = Some(active.clone());
    #[cfg(windows)]
    {
        let app = window.app_handle().clone();
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let worker_active = active.clone();
        std::thread::spawn(move || {
            let result = windows::run(&app, &service, epoch, id, &field, &worker_active, tx);
            worker_active.store(false, Ordering::SeqCst);
            let message = result.unwrap_or_else(|e| e);
            let _ = app.emit_to("main", "lime-steam-fill", message);
        });
        match rx.recv_timeout(std::time::Duration::from_secs(2)) {
            Ok(result) => result,
            Err(_) => {
                active.store(false, Ordering::SeqCst);
                Err("填写快捷键启动失败。".into())
            }
        }
    }
    #[cfg(not(windows))]
    {
        active.store(false, Ordering::SeqCst);
        let _ = (service, epoch);
        Err("Steam 填写仅支持 Windows。".into())
    }
}

#[cfg(windows)]
mod windows {
    use super::*;
    use std::{
        mem::{size_of, zeroed},
        ptr::null_mut,
        time::{Duration, Instant},
    };
    use windows_sys::Win32::{
        Foundation::*,
        Security::*,
        System::Threading::*,
        UI::{Input::KeyboardAndMouse::*, WindowsAndMessaging::*},
    };
    struct Handle(HANDLE);
    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
    struct Target {
        window: HWND,
        focus: HWND,
        pid: u32,
        thread: u32,
        process: Handle,
    }
    impl Target {
        fn capture() -> Result<Self, String> {
            unsafe {
                let window = GetForegroundWindow();
                let mut pid = 0;
                let thread = GetWindowThreadProcessId(window, &mut pid);
                if window.is_null() || thread == 0 {
                    return Err("无法识别当前窗口。".into());
                }
                let process = Handle(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid));
                if process.0.is_null() {
                    return Err("无法核验 Steam 进程权限。".into());
                }
                let mut path = [0u16; 32768];
                let mut len = path.len() as u32;
                if QueryFullProcessImageNameW(process.0, 0, path.as_mut_ptr(), &mut len) == 0
                    || !allowed_process(&String::from_utf16_lossy(&path[..len as usize]))
                {
                    return Err("当前窗口不是 Steam，已取消填写。".into());
                }
                let mut raw_token = null_mut();
                if OpenProcessToken(process.0, TOKEN_QUERY, &mut raw_token) == 0 {
                    return Err("无法核验 Steam 权限。".into());
                }
                let token = Handle(raw_token);
                let mut elevation: TOKEN_ELEVATION = zeroed();
                let mut length = 0;
                if GetTokenInformation(
                    token.0,
                    TokenElevation,
                    (&mut elevation as *mut TOKEN_ELEVATION).cast(),
                    size_of::<TOKEN_ELEVATION>() as u32,
                    &mut length,
                ) == 0
                    || elevation.TokenIsElevated != 0
                {
                    return Err("不向管理员权限的 Steam 填写，请使用普通权限运行。".into());
                }
                let mut info: GUITHREADINFO = zeroed();
                info.cbSize = size_of::<GUITHREADINFO>() as u32;
                if GetGUIThreadInfo(thread, &mut info) == 0 || info.hwndFocus.is_null() {
                    return Err("Steam 没有可核验的焦点，请先点击输入框。".into());
                }
                Ok(Self {
                    window,
                    focus: info.hwndFocus,
                    pid,
                    thread,
                    process,
                })
            }
        }
        fn verify(&self) -> bool {
            unsafe {
                let mut pid = 0;
                let mut exit = 0;
                let mut info: GUITHREADINFO = zeroed();
                info.cbSize = size_of::<GUITHREADINFO>() as u32;
                GetForegroundWindow() == self.window
                    && GetWindowThreadProcessId(self.window, &mut pid) == self.thread
                    && pid == self.pid
                    && GetExitCodeProcess(self.process.0, &mut exit) != 0
                    && exit == STILL_ACTIVE as u32
                    && GetGUIThreadInfo(self.thread, &mut info) != 0
                    && info.hwndFocus == self.focus
            }
        }
    }
    fn down(key: u16) -> bool {
        unsafe { GetAsyncKeyState(i32::from(key)) < 0 }
    }
    fn key(vk: u16, flags: u32) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }
    struct Hotkey;
    impl Drop for Hotkey {
        fn drop(&mut self) {
            unsafe {
                UnregisterHotKey(null_mut(), 0x4c49);
            }
        }
    }
    pub fn run(
        app: &tauri::AppHandle,
        service: &crate::vault_service::VaultService,
        epoch: u64,
        id: u32,
        field: &str,
        active: &AtomicBool,
        tx: std::sync::mpsc::SyncSender<Result<(), String>>,
    ) -> Result<String, String> {
        unsafe {
            if RegisterHotKey(
                null_mut(),
                0x4c49,
                MOD_CONTROL | MOD_ALT | MOD_NOREPEAT,
                u32::from(b'P'),
            ) == 0
            {
                let _ = tx.send(Err("Ctrl + Alt + P 已被占用，无法准备填写。".into()));
                return Err("填写快捷键被占用。".into());
            }
        }
        let _registration = Hotkey;
        let _ = tx.send(Ok(()));
        let expires = Instant::now() + Duration::from_secs(30);
        loop {
            if !active.load(Ordering::SeqCst) || down(VK_ESCAPE) {
                return Err("已取消 Steam 填写。".into());
            }
            if Instant::now() >= expires {
                return Err("Steam 填写已过期，请重新准备。".into());
            }
            let mut message: MSG = unsafe { zeroed() };
            if unsafe { PeekMessageW(&mut message, null_mut(), WM_HOTKEY, WM_HOTKEY, PM_REMOVE) }
                != 0
            {
                let target = Target::capture()?;
                let release_deadline = Instant::now() + Duration::from_secs(2);
                while [
                    VK_CONTROL,
                    VK_MENU,
                    VK_SHIFT,
                    VK_LWIN,
                    VK_RWIN,
                    u16::from(b'P'),
                ]
                .iter()
                .any(|k| down(*k))
                {
                    if !active.load(Ordering::SeqCst)
                        || down(VK_ESCAPE)
                        || !target.verify()
                        || Instant::now() >= release_deadline
                    {
                        return Err("焦点变化或快捷键未松开，已取消填写。".into());
                    }
                    std::thread::sleep(Duration::from_millis(10));
                }
                if !active.load(Ordering::SeqCst) || !target.verify() || Instant::now() >= expires {
                    return Err("Steam 目标已变化或授权已过期。".into());
                }
                let result = service.with_steam_field(epoch, id, field, |value| {
                    if !target.verify() || !active.load(Ordering::SeqCst) {
                        return Err("Steam 目标已变化。".into());
                    }
                    let sequence = app
                        .state::<crate::clipboard::ClipboardService>()
                        .copy_text(value)?;
                    if clipboard_win::seq_num().map(|n| n.get()) != Some(sequence) {
                        return Err("剪贴板已被其他操作更改，已取消填写。".into());
                    }
                    if !target.verify() || !active.load(Ordering::SeqCst) {
                        return Err("Steam 目标已变化。".into());
                    }
                    let events = [
                        key(VK_CONTROL, 0),
                        key(u16::from(b'V'), 0),
                        key(u16::from(b'V'), KEYEVENTF_KEYUP),
                        key(VK_CONTROL, KEYEVENTF_KEYUP),
                    ];
                    if unsafe {
                        SendInput(
                            events.len() as u32,
                            events.as_ptr(),
                            size_of::<INPUT>() as i32,
                        )
                    } != events.len() as u32
                    {
                        let release = [
                            key(u16::from(b'V'), KEYEVENTF_KEYUP),
                            key(VK_CONTROL, KEYEVENTF_KEYUP),
                        ];
                        unsafe {
                            SendInput(
                                release.len() as u32,
                                release.as_ptr(),
                                size_of::<INPUT>() as i32,
                            );
                        }
                        return Err("Windows 未完整接受粘贴操作，已停止。".into());
                    }
                    Ok(())
                });
                if result.is_err() {
                    app.state::<crate::clipboard::ClipboardService>()
                        .clear(app, true);
                }
                result?;
                return Ok("已向 Steam 发送单项粘贴，请核对输入框。未自动提交登录。".into());
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_steam_process_names_are_eligible() {
        assert!(allowed_process(r"C:\Program Files (x86)\Steam\steam.exe"));
        assert!(allowed_process(r"C:\Steam\bin\cef\steamwebhelper.exe"));
        for p in [
            "qq.exe",
            "wechat.exe",
            "chrome.exe",
            "steam.exe.evil",
            "notsteam.exe",
        ] {
            assert!(!allowed_process(p));
        }
    }
}
