//! Disposable native UI for testing the backend before Tauri UI design.
//! Only hard-coded dummy credentials are supported. Never loads a password vault.
use std::{
    cell::RefCell,
    mem::size_of,
    thread,
    time::{Duration, Instant},
};
use windows::{
    Win32::{
        Foundation::*,
        System::{LibraryLoader::GetModuleHandleW, Threading::*},
        UI::{Input::KeyboardAndMouse::*, WindowsAndMessaging::*},
    },
    core::{Error, HSTRING, Result, w},
};

const USER: &str = "10000000";
const PASSWORD: &str = "Demo-验证-🔑-482!";
const SEARCH: i32 = 2001;
const STATUS: i32 = 2002;
const USER_BUTTON: usize = 2010;
const PASSWORD_BUTTON: usize = 2011;
const PAIR_BUTTON: usize = 2012;
const CANCEL: usize = 2013;
const EXIT: usize = 2014;
const DELAY: usize = 2015;
const OPEN_FLOAT: u32 = WM_APP + 30;
const COUNTDOWN_TIMER: usize = 91;
const RESET: u32 = WM_APP + 20;
const CHECK: u32 = WM_APP + 21;

// Fixed event names only: never record queries, credentials or target content.
fn trace(stage: &str) {
    use std::io::Write;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|time| time.as_millis())
        .unwrap_or_default();
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("quickfill-retry.log")
    {
        let _ = writeln!(file, "{timestamp} pid={} stage={stage}", std::process::id());
        let _ = file.sync_data();
    }
}

fn denied() -> Error {
    Error::from_hresult(E_ACCESSDENIED)
}

struct Target {
    window: HWND,
    focus: HWND,
    pid: u32,
    thread: u32,
    process: HANDLE,
    captured: Instant,
}
impl Drop for Target {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.process);
        }
    }
}
impl Target {
    fn capture(panel: HWND) -> Result<Self> {
        unsafe {
            let window = GetForegroundWindow();
            if window.is_invalid() || window == panel {
                return Err(denied());
            }
            let mut pid = 0;
            let thread = GetWindowThreadProcessId(window, Some(&mut pid));
            let process = OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                false,
                pid,
            )?;
            let mut target = Self {
                window,
                focus: HWND::default(),
                pid,
                thread,
                process,
                captured: Instant::now(),
            };
            target.focus = target.focus_now()?;
            if target.focus.is_invalid() {
                return Err(denied());
            }
            Ok(target)
        }
    }
    fn focus_now(&self) -> Result<HWND> {
        unsafe {
            let mut info = GUITHREADINFO {
                cbSize: size_of::<GUITHREADINFO>() as u32,
                ..Default::default()
            };
            GetGUIThreadInfo(self.thread, &mut info)?;
            if GetAncestor(info.hwndFocus, GA_ROOT) != self.window {
                return Err(denied());
            }
            Ok(info.hwndFocus)
        }
    }
    fn alive(&self) -> Result<()> {
        unsafe {
            let mut pid = 0;
            if self.captured.elapsed() > Duration::from_secs(60)
                || WaitForSingleObject(self.process, 0) != WAIT_TIMEOUT
                || !IsWindow(Some(self.window)).as_bool()
                || GetWindowThreadProcessId(self.window, Some(&mut pid)) != self.thread
                || pid != self.pid
            {
                return Err(denied());
            }
        }
        Ok(())
    }
    fn validate(&self, focus: HWND) -> Result<()> {
        self.alive()?;
        if unsafe { GetForegroundWindow() } != self.window || self.focus_now()? != focus {
            return Err(denied());
        }
        Ok(())
    }
}

#[derive(Default)]
struct State {
    target: Option<Target>,
    matches: bool,
    test: bool,
    panel: HWND,
    floating: HWND,
    pending: Option<(Target, Instant)>,
}
thread_local! { static STATE: RefCell<State> = RefCell::new(State::default()); }
thread_local! { static FIXTURE_FOCUS: RefCell<i32> = const { RefCell::new(1001) }; }

fn key(vk: VIRTUAL_KEY, scan: u16, flags: KEYBD_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: scan,
                dwFlags: flags,
                ..Default::default()
            },
        },
    }
}
fn send(inputs: &[INPUT]) -> Result<()> {
    if unsafe { SendInput(inputs, size_of::<INPUT>() as i32) } != inputs.len() as u32 {
        return Err(denied());
    }
    Ok(())
}
fn modifiers_released() -> bool {
    [
        VK_CONTROL, VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN, VK_LBUTTON, VK_RBUTTON,
    ]
    .iter()
    .all(|vk| unsafe { GetAsyncKeyState(vk.0 as i32) >= 0 })
}
fn wait_release() -> Result<()> {
    let deadline = Instant::now() + Duration::from_millis(800);
    while !modifiers_released() {
        if Instant::now() >= deadline {
            return Err(denied());
        }
        thread::sleep(Duration::from_millis(10));
    }
    Ok(())
}
fn type_text(target: &Target, focus: HWND, text: &str) -> Result<()> {
    trace("input_begin");
    // One Unicode scalar per batch keeps surrogate pairs together. Checks reduce
    // but cannot eliminate races with physical input or a foreground switch.
    for character in text.chars() {
        if !modifiers_released() || unsafe { GetAsyncKeyState(VK_ESCAPE.0 as i32) < 0 } {
            return Err(denied());
        }
        target.validate(focus)?;
        let mut utf16 = [0u16; 2];
        let mut inputs = Vec::with_capacity(4);
        for unit in character.encode_utf16(&mut utf16) {
            inputs.push(key(VIRTUAL_KEY(0), *unit, KEYEVENTF_UNICODE));
            inputs.push(key(
                VIRTUAL_KEY(0),
                *unit,
                KEYEVENTF_UNICODE | KEYEVENTF_KEYUP,
            ));
        }
        send(&inputs)?;
        thread::sleep(Duration::from_millis(10));
    }
    trace("input_end");
    Ok(())
}
fn fill(panel: HWND, target: &Target, action: usize) -> Result<()> {
    trace(match action {
        USER_BUTTON => "username_selected",
        PASSWORD_BUTTON => "password_selected",
        _ => "pair_selected",
    });
    wait_release()?;
    target.alive()?;
    // Check after waiting for key/mouse release, before hiding and restoring.
    if unsafe { GetForegroundWindow() } != panel {
        return Err(denied());
    }
    unsafe {
        trace("restore_begin");
        let _ = ShowWindow(panel, SW_HIDE);
        let _ = SetForegroundWindow(target.window);
    }
    let deadline = Instant::now() + Duration::from_millis(400);
    while target.validate(target.focus).is_err() {
        if Instant::now() >= deadline {
            return Err(denied());
        }
        thread::sleep(Duration::from_millis(10));
    }
    // Foreground ownership can be observable before the target processes its
    // activation/focus messages. Allow those to settle, then revalidate.
    thread::sleep(Duration::from_millis(150));
    target.validate(target.focus)?;
    trace("restore_validated");
    if !modifiers_released() {
        return Err(denied());
    }
    match action {
        USER_BUTTON => type_text(target, target.focus, USER),
        PASSWORD_BUTTON => type_text(target, target.focus, PASSWORD),
        PAIR_BUTTON => {
            type_text(target, target.focus, USER)?;
            target.validate(target.focus)?;
            if !modifiers_released() {
                return Err(denied());
            }
            send(&[
                key(VK_TAB, 0, KEYBD_EVENT_FLAGS(0)),
                key(VK_TAB, 0, KEYEVENTF_KEYUP),
            ])?;
            thread::sleep(Duration::from_millis(150));
            // Chromium can retain the same native focus HWND across DOM fields.
            // The user explicitly chooses this mode; no password-field claim is made.
            let next_focus = target.focus_now()?;
            type_text(target, next_focus, PASSWORD)
        }
        _ => Err(denied()),
    }
}

fn set_text(window: HWND, id: i32, text: &str) {
    unsafe {
        if let Ok(control) = GetDlgItem(Some(window), id) {
            let _ = SetWindowTextW(control, &HSTRING::from(text));
        }
    }
}
fn read_own_text(window: HWND, id: i32) -> String {
    unsafe {
        let Ok(control) = GetDlgItem(Some(window), id) else {
            return String::new();
        };
        let mut text = [0u16; 256];
        let length = GetWindowTextW(control, &mut text);
        String::from_utf16_lossy(&text[..length as usize])
    }
}
fn filter(panel: HWND) {
    let query = read_own_text(panel, SEARCH).trim().to_lowercase();
    let matches = query.is_empty() || "qq 演示 demo 10000000".contains(&query);
    let armed = STATE.with(|state| {
        let mut state = state.borrow_mut();
        state.matches = matches;
        state.target.is_some()
    });
    set_text(
        panel,
        STATUS,
        if !armed {
            "先点击目标输入框，再按 Ctrl + Alt + Space"
        } else if matches {
            "QQ 演示账号 · 10000000 · 仅虚构数据"
        } else {
            "没有匹配账号"
        },
    );
    unsafe {
        for id in [USER_BUTTON, PASSWORD_BUTTON, PAIR_BUTTON, DELAY] {
            if let Ok(button) = GetDlgItem(Some(panel), id as i32) {
                let _ = EnableWindow(button, matches && armed);
            }
        }
    }
}
fn open_panel(panel: HWND) -> Result<()> {
    stop_countdown(panel);
    trace("hotkey_received");
    let target = Target::capture(panel).ok();
    trace(if target.is_some() {
        "target_captured"
    } else {
        "no_target_show_panel"
    });
    STATE.with(|state| state.borrow_mut().target = target);
    unsafe {
        let _ = ShowWindow(panel, SW_SHOW);
        let _ = SetForegroundWindow(panel);
    }
    set_text(panel, SEARCH, "");
    filter(panel);
    unsafe {
        let _ = SetFocus(Some(GetDlgItem(Some(panel), SEARCH)?));
    }
    Ok(())
}
fn cancel(panel: HWND) {
    stop_countdown(panel);
    trace("panel_cancelled_or_hidden");
    STATE.with(|state| state.borrow_mut().target = None);
    unsafe {
        let _ = ShowWindow(panel, SW_HIDE);
    }
}
fn stop_countdown(panel: HWND) {
    unsafe {
        let _ = KillTimer(Some(panel), COUNTDOWN_TIMER);
    }
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        if s.pending.take().is_some() {
            trace("delayed_fill_cancelled");
        }
        unsafe {
            let _ = SetWindowTextW(s.floating, w!("填写"));
        }
    });
}
fn countdown(panel: HWND) {
    let pending = STATE.with(|s| s.borrow_mut().pending.take());
    let Some((target, deadline)) = pending else {
        return;
    };
    let valid = target.alive().is_ok()
        && unsafe { GetForegroundWindow() } == target.window
        && unsafe { GetAsyncKeyState(VK_ESCAPE.0 as i32) } >= 0;
    if !valid {
        trace("delayed_target_changed_cancelled");
        stop_countdown(panel);
        return;
    }
    let remaining = deadline.saturating_duration_since(Instant::now());
    if !remaining.is_zero() {
        STATE.with(|s| {
            let mut s = s.borrow_mut();
            unsafe {
                let _ = SetWindowTextW(
                    s.floating,
                    &HSTRING::from(format!("{}秒·取消", remaining.as_secs() + 1)),
                );
            }
            s.pending = Some((target, deadline));
        });
        return;
    }
    stop_countdown(panel);
    trace("delayed_deadline_reached");
    // No SetForegroundWindow here. User must have clicked a field in the
    // originally selected window. Native focus does not identify DOM field type.
    let result = target.focus_now().and_then(|focus| {
        if !modifiers_released() {
            return Err(denied());
        }
        target.validate(focus)?;
        type_text(&target, focus, PASSWORD)
    });
    trace(if result.is_ok() {
        "delayed_input_sent"
    } else {
        "delayed_failed_or_partial"
    });
}
unsafe extern "system" fn floating_proc(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    unsafe {
        match message {
            WM_MOUSEACTIVATE => LRESULT(MA_NOACTIVATE as isize),
            WM_LBUTTONUP | WM_NCLBUTTONUP => {
                STATE.with(|s| {
                    let s = s.borrow();
                    let _ = PostMessageW(Some(s.panel), OPEN_FLOAT, WPARAM(0), LPARAM(0));
                });
                LRESULT(0)
            }
            _ => DefWindowProcW(window, message, wparam, lparam),
        }
    }
}
unsafe extern "system" fn panel_proc(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    unsafe {
        match message {
            OPEN_FLOAT => {
                let pending = STATE.with(|s| s.borrow().pending.is_some());
                if pending {
                    stop_countdown(window);
                } else if open_panel(window).is_err() {
                    cancel(window);
                }
                LRESULT(0)
            }
            WM_TIMER if wparam.0 == COUNTDOWN_TIMER => {
                countdown(window);
                LRESULT(0)
            }
            WM_HOTKEY => {
                if open_panel(window).is_err() {
                    cancel(window);
                }
                LRESULT(0)
            }
            WM_ACTIVATE if wparam.0 & 0xffff == WA_INACTIVE as usize => {
                trace("panel_deactivated_target_cleared");
                STATE.with(|state| state.borrow_mut().target = None);
                filter(window);
                LRESULT(0)
            }
            WM_COMMAND => {
                let id = wparam.0 & 0xffff;
                if id == SEARCH as usize {
                    filter(window);
                } else if id == DELAY {
                    let target = STATE.with(|s| {
                        let mut s = s.borrow_mut();
                        if s.matches && GetForegroundWindow() == window {
                            s.target.take()
                        } else {
                            None
                        }
                    });
                    if let Some(target) = target {
                        stop_countdown(window);
                        STATE.with(|s| {
                            s.borrow_mut().pending =
                                Some((target, Instant::now() + Duration::from_secs(5)))
                        });
                        trace("delayed_password_armed");
                        let _ = ShowWindow(window, SW_HIDE);
                        if SetTimer(Some(window), COUNTDOWN_TIMER, 50, None) == 0 {
                            stop_countdown(window);
                        }
                    }
                } else if [USER_BUTTON, PASSWORD_BUTTON, PAIR_BUTTON].contains(&id) {
                    // Require the real panel to be foreground; a stale command cannot fill.
                    let target = STATE.with(|state| {
                        let mut s = state.borrow_mut();
                        if s.matches && GetForegroundWindow() == window {
                            s.target.take()
                        } else {
                            None
                        }
                    });
                    if let Some(target) = target {
                        if fill(window, &target, id).is_err() {
                            trace("fill_failed_or_partial");
                            cancel(window);
                            // Do not retry partial input or expose any field contents.
                            eprintln!("quickfill_cancelled_or_partial_input; no automatic retry");
                            let test = STATE.with(|s| s.borrow().test);
                            if !test {
                                let _ = MessageBoxW(
                                    None,
                                    w!("填写已取消或只完成了一部分。请检查输入框后重试。"),
                                    w!("快捷填写验证"),
                                    MB_OK | MB_ICONINFORMATION,
                                );
                            }
                        }
                    }
                } else if id == CANCEL {
                    cancel(window);
                } else if id == EXIT {
                    let _ = DestroyWindow(window);
                }
                LRESULT(0)
            }
            WM_CLOSE => {
                cancel(window);
                LRESULT(0)
            }
            WM_DESTROY => {
                stop_countdown(window);
                let floating = STATE.with(|s| s.borrow().floating);
                if !floating.is_invalid() {
                    let _ = DestroyWindow(floating);
                }
                let _ = UnregisterHotKey(Some(window), 1);
                PostQuitMessage(0);
                LRESULT(0)
            }
            _ => DefWindowProcW(window, message, wparam, lparam),
        }
    }
}

fn create_window(class_name: &HSTRING, title: &HSTRING, procedure: WNDPROC) -> Result<HWND> {
    unsafe {
        let instance = GetModuleHandleW(None)?;
        let class = WNDCLASSW {
            lpfnWndProc: procedure,
            hInstance: instance.into(),
            lpszClassName: windows::core::PCWSTR(class_name.as_ptr()),
            hCursor: LoadCursorW(None, IDC_ARROW)?,
            hbrBackground: windows::Win32::Graphics::Gdi::GetSysColorBrush(
                windows::Win32::Graphics::Gdi::COLOR_BTNFACE,
            ),
            ..Default::default()
        };
        if RegisterClassW(&class) == 0 {
            return Err(Error::from_win32());
        }
        CreateWindowExW(
            WS_EX_APPWINDOW,
            class.lpszClassName,
            title,
            WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU,
            180,
            160,
            560,
            280,
            None,
            None,
            Some(instance.into()),
            None,
        )
    }
}
fn control(
    parent: HWND,
    class: &str,
    text: &str,
    id: usize,
    bounds: [i32; 4],
    extra: WINDOW_STYLE,
) -> Result<HWND> {
    unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE(0),
            &HSTRING::from(class),
            &HSTRING::from(text),
            WS_CHILD | WS_VISIBLE | extra,
            bounds[0],
            bounds[1],
            bounds[2],
            bounds[3],
            Some(parent),
            Some(HMENU(id as *mut _)),
            Some(GetModuleHandleW(None)?.into()),
            None,
        )
    }
}

pub fn run(test: bool) -> Result<()> {
    trace("startup");
    STATE.with(|state| state.borrow_mut().test = test);
    let panel = create_window(
        &HSTRING::from("QuickFillValidationPanel"),
        &HSTRING::from("快捷填写 · 技术验证（虚构账号）"),
        Some(panel_proc),
    )?;
    STATE.with(|s| s.borrow_mut().panel = panel);
    if !test {
        unsafe {
            let instance = GetModuleHandleW(None)?;
            let class = WNDCLASSW {
                lpfnWndProc: Some(floating_proc),
                hInstance: instance.into(),
                lpszClassName: w!("QuickFillFloatingEntry"),
                hCursor: LoadCursorW(None, IDC_HAND)?,
                hbrBackground: windows::Win32::Graphics::Gdi::GetSysColorBrush(
                    windows::Win32::Graphics::Gdi::COLOR_BTNFACE,
                ),
                ..Default::default()
            };
            if RegisterClassW(&class) == 0 {
                return Err(Error::from_win32());
            }
            let floating = CreateWindowExW(
                WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
                class.lpszClassName,
                w!("填写"),
                WS_POPUP | WS_BORDER | WS_CAPTION,
                24,
                160,
                112,
                64,
                None,
                None,
                Some(instance.into()),
                None,
            )?;
            STATE.with(|s| s.borrow_mut().floating = floating);
            let _ = ShowWindow(floating, SW_SHOWNOACTIVATE);
        }
    }
    control(
        panel,
        "STATIC",
        "点击目标输入框 → Ctrl + Alt + Space → 搜索 QQ",
        0,
        [16, 12, 510, 24],
        WINDOW_STYLE(0),
    )?;
    control(
        panel,
        "EDIT",
        "",
        SEARCH as usize,
        [16, 44, 510, 28],
        WS_BORDER | WS_TABSTOP,
    )?;
    control(
        panel,
        "STATIC",
        "",
        STATUS as usize,
        [16, 84, 510, 24],
        WINDOW_STYLE(0),
    )?;
    for (id, text, x, width) in [
        (USER_BUTTON, "填用户名", 16, 130),
        (PASSWORD_BUTTON, "填密码", 157, 130),
        (PAIR_BUTTON, "用户名 → Tab → 密码", 298, 228),
    ] {
        control(panel, "BUTTON", text, id, [x, 120, width, 32], WS_TABSTOP)?;
    }
    control(
        panel,
        "STATIC",
        "延时填写：选中后 5 秒内点击原应用密码框。",
        0,
        [16, 164, 510, 22],
        WINDOW_STYLE(0),
    )?;
    control(
        panel,
        "BUTTON",
        "5秒后填密码",
        DELAY,
        [165, 196, 190, 30],
        WS_TABSTOP,
    )?;
    control(
        panel,
        "BUTTON",
        "收起 / Esc",
        CANCEL,
        [16, 196, 140, 30],
        WS_TABSTOP,
    )?;
    control(
        panel,
        "BUTTON",
        "退出验证程序",
        EXIT,
        [366, 196, 160, 30],
        WS_TABSTOP,
    )?;
    unsafe {
        RegisterHotKey(
            Some(panel),
            1,
            MOD_CONTROL | MOD_ALT | MOD_NOREPEAT,
            VK_SPACE.0 as u32,
        )?;
    }
    filter(panel);
    if !test {
        unsafe {
            let _ = ShowWindow(panel, SW_SHOW);
        }
    }
    let worker = if test {
        let raw = panel.0 as usize;
        Some(thread::spawn(move || self_test(raw)))
    } else {
        None
    };
    unsafe {
        let mut message = MSG::default();
        loop {
            let result = GetMessageW(&mut message, None, 0, 0).0;
            if result == -1 {
                return Err(Error::from_win32());
            }
            if result == 0 {
                break;
            }
            if message.message == WM_KEYDOWN && message.wParam.0 == VK_ESCAPE.0 as usize {
                cancel(panel);
                continue;
            }
            if !IsDialogMessageW(panel, &message).as_bool() {
                let _ = TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
    }
    if let Some(worker) = worker {
        worker.join().map_err(|_| denied())??;
    }
    Ok(())
}

unsafe extern "system" fn fixture_proc(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    unsafe {
        match message {
            RESET => {
                FIXTURE_FOCUS.with(|id| *id.borrow_mut() = if wparam.0 == 1 { 1002 } else { 1001 });
                set_text(window, 1001, "");
                set_text(window, 1002, "");
                let _ = SetFocus(
                    GetDlgItem(Some(window), if wparam.0 == 1 { 1002 } else { 1001 }).ok(),
                );
                LRESULT(1)
            }
            CHECK => {
                if wparam.0 == 4 {
                    return LRESULT(
                        (read_own_text(window, 1001).encode_utf16().count()
                            | (read_own_text(window, 1002).encode_utf16().count() << 16))
                            as isize,
                    );
                }
                let expected = match wparam.0 {
                    0 => (USER, ""),
                    1 => ("", PASSWORD),
                    2 => (USER, PASSWORD),
                    _ => ("", ""),
                };
                LRESULT(
                    (read_own_text(window, 1001) == expected.0
                        && read_own_text(window, 1002) == expected.1) as isize,
                )
            }
            WM_SETFOCUS => {
                FIXTURE_FOCUS.with(|id| {
                    let _ = SetFocus(GetDlgItem(Some(window), *id.borrow()).ok());
                });
                LRESULT(0)
            }
            WM_CLOSE => {
                let _ = DestroyWindow(window);
                LRESULT(0)
            }
            WM_DESTROY => {
                PostQuitMessage(0);
                LRESULT(0)
            }
            _ => DefWindowProcW(window, message, wparam, lparam),
        }
    }
}
pub fn fixture() -> Result<()> {
    let root = create_window(
        &HSTRING::from("QuickFillKeyboardFixture"),
        &HSTRING::from("快捷填写 · 自建测试目标"),
        Some(fixture_proc),
    )?;
    control(
        root,
        "EDIT",
        "",
        1001,
        [20, 30, 470, 28],
        WS_TABSTOP | WS_BORDER,
    )?;
    control(
        root,
        "EDIT",
        "",
        1002,
        [20, 80, 470, 28],
        WS_TABSTOP | WS_BORDER | WINDOW_STYLE(ES_PASSWORD as u32),
    )?;
    unsafe {
        let _ = ShowWindow(root, SW_SHOW);
        let _ = SetFocus(Some(GetDlgItem(Some(root), 1001)?));
        let mut message = MSG::default();
        loop {
            let status = GetMessageW(&mut message, None, 0, 0).0;
            if status == -1 {
                return Err(Error::from_win32());
            }
            if status == 0 {
                break;
            }
            if !IsDialogMessageW(root, &message).as_bool() {
                let _ = TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
    }
    Ok(())
}

fn request(window: HWND, message: u32, param: usize) -> Result<usize> {
    let mut result = 0;
    unsafe {
        if SendMessageTimeoutW(
            window,
            message,
            WPARAM(param),
            LPARAM(0),
            SMTO_ABORTIFHUNG,
            1500,
            Some(&mut result),
        )
        .0 == 0
        {
            return Err(denied());
        }
    }
    Ok(result)
}
fn hotkey() -> Result<()> {
    send(&[
        key(VK_CONTROL, 0, KEYBD_EVENT_FLAGS(0)),
        key(VK_MENU, 0, KEYBD_EVENT_FLAGS(0)),
        key(VK_SPACE, 0, KEYBD_EVENT_FLAGS(0)),
        key(VK_SPACE, 0, KEYEVENTF_KEYUP),
        key(VK_MENU, 0, KEYEVENTF_KEYUP),
        key(VK_CONTROL, 0, KEYEVENTF_KEYUP),
    ])
}
fn wait_for(mut predicate: impl FnMut() -> bool) -> Result<()> {
    let deadline = Instant::now() + Duration::from_secs(3);
    while !predicate() {
        if Instant::now() >= deadline {
            return Err(denied());
        }
        thread::sleep(Duration::from_millis(20));
    }
    Ok(())
}
fn self_test(raw_panel: usize) -> Result<()> {
    let panel = HWND(raw_panel as *mut _);
    let outcome = (|| -> Result<()> {
        let mut child = std::process::Command::new(std::env::current_exe().map_err(|_| denied())?)
            .arg("--keyboard-fixture")
            .spawn()
            .map_err(|_| denied())?;
        let result = (|| -> Result<()> {
            let mut fixture = HWND::default();
            wait_for(|| {
                fixture = unsafe {
                    FindWindowW(w!("QuickFillKeyboardFixture"), None).unwrap_or_default()
                };
                !fixture.is_invalid()
            })?;
            // Verify this is precisely the child created by this test, not another window.
            let mut pid = 0;
            unsafe {
                GetWindowThreadProcessId(fixture, Some(&mut pid));
            }
            if pid != child.id() {
                return Err(denied());
            }
            for (index, action) in [USER_BUTTON, PASSWORD_BUTTON, PAIR_BUTTON]
                .into_iter()
                .enumerate()
            {
                unsafe {
                    let _ = SetForegroundWindow(fixture);
                }
                wait_for(|| unsafe { GetForegroundWindow() == fixture })?;
                request(fixture, RESET, if index == 1 { 1 } else { 0 })?;
                hotkey()?;
                wait_for(|| unsafe { GetForegroundWindow() == panel }).inspect_err(|_| {
                    eprintln!("self_test_stage=panel_activation mode={index}");
                })?;
                // Search and execute the same command handler used by the panel buttons.
                set_text(panel, SEARCH, "qq");
                unsafe {
                    PostMessageW(Some(panel), WM_COMMAND, WPARAM(action), LPARAM(0))?;
                }
                wait_for(|| request(fixture, CHECK, index) == Ok(1)).inspect_err(|_| {
                    eprintln!("self_test_stage=fixture_verification mode={index}");
                    if let Ok(lengths) = request(fixture, CHECK, 4) {
                        eprintln!(
                            "test_fixture_username_units={} password_units={}",
                            lengths & 0xffff,
                            lengths >> 16
                        );
                    }
                })?;
                // Field contents can be visible before the panel's handler returns.
                // Drain that handler before issuing the next global hotkey.
                request(panel, WM_NULL, 0)?;
                wait_release()?;
                thread::sleep(Duration::from_millis(100));
                println!("PASS: hotkey/search/restore/input mode={index} fixture verified");
            }
            // Search miss: even a posted action must not write.
            unsafe {
                let _ = SetForegroundWindow(fixture);
            }
            request(fixture, RESET, 0)?;
            hotkey()?;
            wait_for(|| unsafe { GetForegroundWindow() == panel })?;
            set_text(panel, SEARCH, "no-such-account");
            request(panel, WM_COMMAND, PAIR_BUTTON)?;
            if request(fixture, CHECK, 3)? != 1 {
                return Err(denied());
            }
            println!("PASS: search miss did not fill");
            // Deactivating the panel clears the request; stale commands are inert.
            set_text(panel, SEARCH, "qq");
            unsafe {
                let _ = SetForegroundWindow(fixture);
            }
            wait_for(|| unsafe { GetForegroundWindow() == fixture })?;
            request(panel, WM_NULL, 0)?;
            request(panel, WM_COMMAND, PAIR_BUTTON)?;
            if request(fixture, CHECK, 3)? != 1 {
                return Err(denied());
            }
            println!("PASS: panel deactivation cancelled stale request");
            Ok(())
        })();
        let _ = child.kill();
        let _ = child.wait();
        result
    })();
    unsafe {
        let _ = PostMessageW(Some(panel), WM_COMMAND, WPARAM(EXIT), LPARAM(0));
    }
    outcome
}
