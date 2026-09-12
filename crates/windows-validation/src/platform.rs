use std::{
    process::{Child, Command},
    thread,
    time::{Duration, Instant},
};
use windows::{
    Win32::{
        Foundation::{E_ACCESSDENIED, E_FAIL, E_INVALIDARG, HWND, LPARAM, LRESULT, WPARAM},
        System::{Com::*, LibraryLoader::GetModuleHandleW, Variant::VARIANT},
        UI::{Accessibility::*, WindowsAndMessaging::*},
    },
    core::{Error, Interface, PCWSTR, Result, w},
};

const TEST_USER: &str = "demo-user@example.invalid";
const TEST_PASSWORD: &str = "Fixture-Only-482!";
const VERIFY: u32 = WM_APP + 1;

struct Com;
impl Com {
    fn initialize() -> Result<Self> {
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
        }
        Ok(Self)
    }
}
impl Drop for Com {
    fn drop(&mut self) {
        unsafe {
            CoUninitialize();
        }
    }
}

struct Fixture(Child);
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn failure() -> Error {
    Error::from_hresult(E_FAIL)
}

pub fn run() -> Result<()> {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    if arguments.as_slice() == ["--quickfill-demo"] {
        return crate::quickfill::run(false);
    }
    if arguments.as_slice() == ["--quickfill-self-test"] {
        return crate::quickfill::run(true);
    }
    if arguments.as_slice() == ["--keyboard-fixture"] {
        return crate::quickfill::fixture();
    }
    if arguments.as_slice() == ["--fixture"] {
        return fixture();
    }
    if arguments.as_slice() == ["--self-test"] {
        return self_test();
    }
    if arguments.len() == 2 && arguments[0] == "--probe-pid" {
        let pid: i32 = arguments[1]
            .parse()
            .map_err(|_| Error::from_hresult(E_INVALIDARG))?;
        if pid <= 0 {
            return Err(Error::from_hresult(E_INVALIDARG));
        }
        let _com = Com::initialize()?;
        let automation: IUIAutomation =
            unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)? };
        return probe(&automation, pid);
    }
    println!(
        "Usage: windows-validation --self-test | --probe-pid <PID> | --quickfill-demo | --quickfill-self-test"
    );
    Ok(())
}

fn windows_for(automation: &IUIAutomation, pid: i32) -> Result<IUIAutomationElementArray> {
    unsafe {
        let condition =
            automation.CreatePropertyCondition(UIA_ProcessIdPropertyId, &VARIANT::from(pid))?;
        automation
            .GetRootElement()?
            .FindAll(TreeScope_Children, &condition)
    }
}

fn probe(automation: &IUIAutomation, pid: i32) -> Result<()> {
    unsafe {
        let windows = windows_for(automation, pid)?;
        let count = windows.Length()?;
        println!("pid={pid} accessible_top_level_windows={count}");
        let condition = automation.CreatePropertyCondition(
            UIA_ControlTypePropertyId,
            &VARIANT::from(UIA_EditControlTypeId.0),
        )?;
        for i in 0..count {
            let edits = windows
                .GetElement(i)?
                .FindAll(TreeScope_Descendants, &condition)?;
            let mut passwords = 0;
            let mut value_patterns = 0;
            let mut usable_usernames = 0;
            let mut usable_passwords = 0;
            for j in 0..edits.Length()? {
                let edit = edits.GetElement(j)?;
                let is_password = edit.CurrentIsPassword()?.as_bool();
                if is_password {
                    passwords += 1;
                }
                if let Ok(pattern) = edit.GetCurrentPattern(UIA_ValuePatternId) {
                    value_patterns += 1;
                    let pattern: IUIAutomationValuePattern = pattern.cast()?;
                    // A pattern alone is not evidence that a login field is usable.
                    // This is only a capability report, never permission to fill.
                    let usable = edit.CurrentControlType()? == UIA_EditControlTypeId
                        && edit.CurrentProcessId()? == pid
                        && edit.CurrentIsEnabled()?.as_bool()
                        && edit.CurrentIsKeyboardFocusable()?.as_bool()
                        && !edit.CurrentIsOffscreen()?.as_bool()
                        && !pattern.CurrentIsReadOnly()?.as_bool();
                    if usable {
                        if is_password {
                            usable_passwords += 1;
                        } else {
                            usable_usernames += 1;
                        }
                    }
                }
            }
            println!(
                "window_index={i} edits={} passwords={passwords} value_patterns={value_patterns} usable_non_password_edits={usable_usernames} usable_password_edits={usable_passwords}",
                edits.Length()?
            );
            if usable_usernames == 1 && usable_passwords == 1 {
                println!(
                    "assessment=candidate_pair_requires_app_identity_and_login_context_validation"
                );
            } else {
                println!("assessment=insufficient_or_ambiguous_fields_do_not_autofill");
            }
        }
    }
    Ok(())
}

fn field(
    automation: &IUIAutomation,
    root: &IUIAutomationElement,
    id: &str,
) -> Result<IUIAutomationElement> {
    unsafe {
        let condition =
            automation.CreatePropertyCondition(UIA_AutomationIdPropertyId, &VARIANT::from(id))?;
        root.FindFirst(TreeScope_Descendants, &condition)
    }
}

fn fill_fixture_field(
    root: &IUIAutomationElement,
    target: &IUIAutomationElement,
    pid: i32,
    foreground_at_request: HWND,
    value: &str,
) -> Result<()> {
    unsafe {
        let hwnd = root.CurrentNativeWindowHandle()?;
        let pattern: IUIAutomationValuePattern =
            target.GetCurrentPattern(UIA_ValuePatternId)?.cast()?;
        // Revalidate immediately before each write. UIA and foreground state are
        // not atomic; production adapters still need a stricter interaction policy.
        if root.CurrentProcessId()? != pid
            || target.CurrentProcessId()? != pid
            || !IsWindow(Some(hwnd)).as_bool()
            || GetForegroundWindow() != foreground_at_request
        {
            return Err(Error::from_hresult(E_ACCESSDENIED));
        }
        pattern.SetValue(&windows::core::BSTR::from(value))?;
    }
    Ok(())
}

fn fixture_verified(hwnd: HWND) -> bool {
    unsafe {
        let mut result = 0usize;
        let sent = SendMessageTimeoutW(
            hwnd,
            VERIFY,
            WPARAM(0),
            LPARAM(0),
            SMTO_ABORTIFHUNG,
            2000,
            Some(&mut result),
        );
        sent.0 != 0 && result == 1
    }
}

// This harness only writes to a child of this executable that it just started.
// There is intentionally no command for filling an arbitrary PID or HWND.
fn self_test() -> Result<()> {
    let _com = Com::initialize()?;
    let automation: IUIAutomation =
        unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)? };
    let mut child = Fixture(
        Command::new(std::env::current_exe().map_err(|_| failure())?)
            .arg("--fixture")
            .spawn()
            .map_err(|_| failure())?,
    );
    let pid = child.0.id() as i32;
    let deadline = Instant::now() + Duration::from_secs(10);
    let root = loop {
        if child.0.try_wait().map_err(|_| failure())?.is_some() {
            return Err(failure());
        }
        let windows = windows_for(&automation, pid)?;
        if unsafe { windows.Length()? } == 1 {
            let candidate = unsafe { windows.GetElement(0)? };
            if field(&automation, &candidate, "1001").is_ok()
                && field(&automation, &candidate, "1002").is_ok()
            {
                break candidate;
            }
        }
        if Instant::now() >= deadline {
            return Err(failure());
        }
        thread::sleep(Duration::from_millis(100));
    };
    probe(&automation, pid)?;
    unsafe {
        let hwnd = root.CurrentNativeWindowHandle()?;
        let foreground = GetForegroundWindow();
        for (id, value) in [("1001", TEST_USER), ("1002", TEST_PASSWORD)] {
            let target = field(&automation, &root, id)?;
            fill_fixture_field(&root, &target, pid, foreground, value)?;
        }
        // Ask the fixture to verify its own dummy fields. No password is read through UIA.
        if !fixture_verified(hwnd) {
            return Err(failure());
        }
        let username = field(&automation, &root, "1001")?;
        let denied = fill_fixture_field(
            &root,
            &username,
            -1,
            GetForegroundWindow(),
            "must-not-write",
        );
        if !matches!(denied, Err(ref error) if error.code() == E_ACCESSDENIED)
            || !fixture_verified(hwnd)
        {
            return Err(failure());
        }
        println!("PASS: wrong process identity rejected without modifying dummy fields.");
        // A deliberately impossible foreground snapshot deterministically models
        // a stale request, without switching focus in the user's applications.
        let stale_foreground = HWND(-1isize as *mut _);
        let denied = fill_fixture_field(&root, &username, pid, stale_foreground, "must-not-write");
        if !matches!(denied, Err(ref error) if error.code() == E_ACCESSDENIED)
            || !fixture_verified(hwnd)
        {
            return Err(failure());
        }
        println!("PASS: stale foreground snapshot rejected without modifying dummy fields.");
    }
    println!("PASS: Rust UI Automation filled and fixture verified both dummy fields.");
    println!(
        "LIMIT: real focus races and third-party application compatibility remain unverified."
    );
    Ok(())
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    unsafe {
        match message {
            VERIFY => {
                for (id, expected) in [(1001, TEST_USER), (1002, TEST_PASSWORD)] {
                    let Ok(edit) = GetDlgItem(Some(hwnd), id) else {
                        return LRESULT(0);
                    };
                    let mut buffer = [0u16; 128];
                    let length = GetWindowTextW(edit, &mut buffer);
                    if String::from_utf16_lossy(&buffer[..length as usize]) != expected {
                        return LRESULT(0);
                    }
                }
                LRESULT(1)
            }
            WM_DESTROY => {
                PostQuitMessage(0);
                LRESULT(0)
            }
            _ => DefWindowProcW(hwnd, message, wparam, lparam),
        }
    }
}

fn fixture() -> Result<()> {
    unsafe {
        let instance = GetModuleHandleW(None)?;
        let class = WNDCLASSW {
            lpfnWndProc: Some(window_proc),
            hInstance: instance.into(),
            lpszClassName: w!("PasswordToolValidationFixture"),
            ..Default::default()
        };
        if RegisterClassW(&class) == 0 {
            return Err(Error::from_win32());
        }
        let root = CreateWindowExW(
            WS_EX_NOACTIVATE,
            class.lpszClassName,
            w!("Password tool - dummy validation fixture"),
            WS_OVERLAPPEDWINDOW,
            40,
            40,
            420,
            160,
            None,
            None,
            Some(instance.into()),
            None,
        )?;
        for (id, y, password) in [(1001, 20, false), (1002, 60, true)] {
            let style = WS_CHILD
                | WS_VISIBLE
                | WS_BORDER
                | WS_TABSTOP
                | WINDOW_STYLE(if password { ES_PASSWORD as u32 } else { 0 });
            CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                w!("EDIT"),
                PCWSTR(wide("").as_ptr()),
                style,
                20,
                y,
                350,
                25,
                Some(root),
                Some(HMENU(id as *mut _)),
                Some(instance.into()),
                None,
            )?;
        }
        let _ = ShowWindow(root, SW_SHOWNOACTIVATE);
        let mut message = MSG::default();
        loop {
            let status = GetMessageW(&mut message, None, 0, 0).0;
            if status == -1 {
                return Err(Error::from_win32());
            }
            if status == 0 {
                break;
            }
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
    Ok(())
}
