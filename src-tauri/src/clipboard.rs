use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

#[derive(Clone, serde::Serialize)]
pub struct Status {
    pub ticket: u32,
    pub status: &'static str,
}

struct Lease {
    sequence: u32,
    expires: Instant,
}
#[derive(Default, Clone)]
pub struct ClipboardService(Arc<Mutex<Option<Lease>>>);

fn valid_password(value: &str) -> bool {
    (8..=64).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_graphic())
}

fn same_sequence(expected: u32, current: Option<u32>) -> bool {
    expected != 0 && current == Some(expected)
}

impl ClipboardService {
    pub fn start(app: tauri::AppHandle) -> Self {
        let service = Self::default();
        let worker = service.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(250));
            worker.clear(&app, false);
        });
        service
    }

    // The mutex serializes writes and expiry, while OpenClipboard keeps the
    // sequence comparison and clear atomic relative to other Windows apps.
    #[cfg(windows)]
    pub fn copy_text(&self, value: &str) -> Result<u32, String> {
        if value.is_empty() || value.len() > 4096 || value.contains('\0') {
            return Err("复制内容无效或过长。".into());
        }
        let mut pending = self.0.lock().map_err(|_| "剪贴板服务暂不可用。")?;
        let _clipboard =
            clipboard_win::Clipboard::new_attempts(10).map_err(|_| "剪贴板正被占用，请重试。")?;
        clipboard_win::raw::set_string(value).map_err(|_| "复制失败，请重试。")?;
        let sequence = clipboard_win::seq_num()
            .map(|n| n.get())
            .ok_or("已复制，但无法安排自动清理。")?;
        *pending = Some(Lease {
            sequence,
            expires: Instant::now() + Duration::from_secs(30),
        });
        Ok(sequence)
    }

    #[cfg(not(windows))]
    pub fn copy_text(&self, _value: &str) -> Result<u32, String> {
        Err("当前仅支持 Windows 桌面版复制。".into())
    }

    pub fn clear(&self, app: &tauri::AppHandle, immediate: bool) {
        let Ok(mut pending) = self.0.lock() else {
            return;
        };
        let Some(lease) = pending.as_ref() else {
            return;
        };
        if !immediate && Instant::now() < lease.expires {
            return;
        }
        let status = clear_sequence(lease.sequence);
        // Retry a busy clipboard for up to two seconds; never clear new data.
        if status == "failed"
            && !immediate
            && Instant::now() < lease.expires + Duration::from_secs(2)
        {
            return;
        }
        let event = Status {
            ticket: lease.sequence,
            status,
        };
        *pending = None;
        let _ = app.emit_to("main", "lime-clipboard", event);
    }
}

#[cfg(windows)]
fn clear_sequence(sequence: u32) -> &'static str {
    let Ok(_clipboard) = clipboard_win::Clipboard::new_attempts(10) else {
        return "failed";
    };
    if !same_sequence(sequence, clipboard_win::seq_num().map(|n| n.get())) {
        return "changed";
    }
    if clipboard_win::empty().is_ok() {
        "cleared"
    } else {
        "failed"
    }
}
#[cfg(not(windows))]
fn clear_sequence(_sequence: u32) -> &'static str {
    "failed"
}

#[tauri::command]
pub fn copy_generated_password(window: tauri::WebviewWindow, value: String) -> Result<u32, String> {
    if window.label() != "main" {
        return Err("只能从主窗口复制。".into());
    }
    if !valid_password(&value) {
        return Err("只能复制 8–64 位可见 ASCII 字符。".into());
    }
    // A newly generated value does not read the vault and is available before authentication.
    window.state::<ClipboardService>().copy_text(&value)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn newer_clipboard_data_is_never_owned_even_if_text_is_identical() {
        assert!(same_sequence(10, Some(10)));
        assert!(!same_sequence(10, Some(11)));
        assert!(!same_sequence(10, None));
        assert!(!same_sequence(0, Some(0)));
    }
    #[test]
    fn copy_boundary_rejects_empty_long_and_control_character_payloads() {
        assert!(valid_password("Lime-sample-2026!"));
        for invalid in ["", "short", "line\nbreak", "null\0byte", "含有中文密码"] {
            assert!(!valid_password(invalid));
        }
        assert!(!valid_password(&"a".repeat(65)));
    }
}
