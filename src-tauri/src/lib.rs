use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
mod browser_bridge;
mod browser_csv;
mod browser_protocol;
mod clipboard;
mod floating_layout;
mod placement;
mod quick_paste;
mod vault;
mod vault_service;

fn save_floating_placement(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let window = app
        .get_webview_window("floating")
        .ok_or("Floating window unavailable")?;
    let scale = window.scale_factor()?;
    let position = window.outer_position()?;
    let state = app.state::<floating_layout::FloatingLayout>();
    let state = state.0.lock().map_err(|_| "Floating state unavailable")?;
    let (center_x, center_y) = state.anchor();
    let preference = placement::Placement::new(
        f64::from(position.x) + center_x * scale,
        f64::from(position.y) + center_y * scale,
    );
    let path = app.path().app_config_dir()?.join("floating-position.json");
    placement::write(&path, preference)?;
    Ok(())
}

fn restore_floating_placement(
    window: &WebviewWindow,
    reset: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let path = window
        .app_handle()
        .path()
        .app_config_dir()?
        .join("floating-position.json");
    let saved = if reset { None } else { placement::read(&path) };
    let monitors = window.available_monitors()?;
    let matching = saved.and_then(|point| {
        monitors.iter().find(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            placement::contains(point, position.x, position.y, size.width, size.height)
        })
    });
    let monitor = matching
        .cloned()
        .or(window.primary_monitor()?)
        .ok_or("No monitor available")?;
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let state = window.state::<floating_layout::FloatingLayout>();
    let mut state = state.0.lock().map_err(|_| "Floating state unavailable")?;
    state.edge = None;
    state.cancel_motion();
    let (width, height, center_x, center_y) = floating_layout::geometry(state.layout, None);
    window.set_size(tauri::LogicalSize::new(width, height))?;
    // If the saved display was disconnected, use a visible default on primary.
    let center = saved.filter(|_| matching.is_some()).unwrap_or_else(|| {
        placement::Placement::new(
            f64::from(area.position.x) + 180.0 * scale,
            f64::from(area.position.y) + 298.0 * scale,
        )
    });
    let x = clamp_origin(
        center.center_x - center_x * scale,
        f64::from(area.position.x),
        f64::from(area.size.width),
        width * scale,
    );
    let y = clamp_origin(
        center.center_y - center_y * scale,
        f64::from(area.position.y),
        f64::from(area.size.height),
        height * scale,
    );
    window.set_position(tauri::PhysicalPosition::new(
        x.round() as i32,
        y.round() as i32,
    ))?;
    let _ = window.emit("lime-floating-reset", ());
    Ok(())
}

#[tauri::command]
fn runtime_status() -> &'static str {
    if cfg!(debug_assertions) {
        "1.0.0 · Debug"
    } else {
        "1.0.0 · 本地密码库"
    }
}

fn show_main(app: &tauri::AppHandle) -> Result<WebviewWindow, String> {
    let main = app
        .get_webview_window("main")
        .ok_or("Main window unavailable")?;
    main.unminimize().map_err(|e| e.to_string())?;
    main.show().map_err(|e| e.to_string())?;
    main.set_focus().map_err(|e| e.to_string())?;
    Ok(main)
}

fn supported_action(action: &str) -> bool {
    matches!(action, "vault" | "search" | "generate" | "lock")
}

#[tauri::command]
fn desktop_action(
    app: tauri::AppHandle,
    window: WebviewWindow,
    action: String,
) -> Result<(), String> {
    if !matches!(window.label(), "main" | "floating") || !supported_action(&action) {
        return Err("Unsupported action".into());
    }
    if action == "lock" {
        vault_service::lock_all(&app);
    }
    show_main(&app)?
        .emit("lime-action", &action)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn show_floating(app: tauri::AppHandle, window: WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Main window required".into());
    }
    app.get_webview_window("floating")
        .ok_or("Floating window unavailable")?
        .show()
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn drag_floating(window: WebviewWindow) -> Result<(), String> {
    if window.label() != "floating" {
        return Err("Floating window required".into());
    }
    floating_layout::drag_until_released(window).await
}

// Coordinates are logical pixels, matching the two CSS layouts. Preserve the
// fruit's screen position while changing the surrounding navigation surface.
#[cfg(test)]
fn floating_geometry(expanded: bool) -> (f64, f64, f64, f64) {
    if expanded {
        (300.0, 310.0, 150.0, 138.0)
    } else {
        (96.0, 88.0, 48.0, 40.0)
    }
}

fn clamp_origin(origin: f64, start: f64, extent: f64, window: f64) -> f64 {
    origin.clamp(start, (start + extent - window).max(start))
}

#[tauri::command]
fn resize_floating(window: WebviewWindow, expanded: bool) -> Result<(), String> {
    floating_layout::floating_layout(
        window,
        if expanded {
            floating_layout::Layout::Wheel
        } else {
            floating_layout::Layout::Compact
        },
        None,
    )
    .map(|_| ())
}

pub fn run() {
    let mut context = tauri::generate_context!();
    if std::env::args().any(|arg| arg == "--browser-background") {
        for window in &mut context.config_mut().app.windows {
            window.visible = false;
        }
    }
    // This app does not depend on the old UIA/SendInput validation executable.
    tauri::Builder::default()
        // Register first: a second launch should never create windows or a tray.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if args.iter().any(|arg| arg == "--browser-background") {
                return;
            }
            if let Err(error) = show_main(app) {
                eprintln!("Could not restore the existing window: {error}");
            }
        }))
        .invoke_handler(tauri::generate_handler![
            runtime_status,
            quick_paste::quick_paste_accounts,
            quick_paste::quick_paste_arm,
            quick_paste::quick_paste_cancel,
            browser_bridge::browser_install,
            browser_bridge::browser_disconnect,
            desktop_action,
            show_floating,
            drag_floating,
            resize_floating,
            floating_layout::floating_layout,
            floating_layout::prepare_floating_motion,
            floating_layout::finish_floating_motion,
            clipboard::copy_generated_password,
            vault_service::vault_status,
            vault_service::vault_auth,
            vault_service::vault_lock,
            vault_service::vault_touch,
            vault_service::vault_list,
            vault_service::vault_strengths,
            vault_service::vault_save,
            vault_service::quick_save_context,
            vault_service::quick_save_account,
            vault_service::floating_touch,
            vault_service::vault_categorize,
            vault_service::vault_regroup,
            vault_service::vault_delete,
            vault_service::vault_undo,
            vault_service::vault_reveal,
            vault_service::vault_copy,
            vault_service::vault_choose_csv,
            vault_service::vault_commit_csv,
            vault_service::vault_cancel_csv,
            vault_service::vault_choose_import,
            vault_service::vault_import,
            vault_service::vault_export,
            vault_service::vault_change_password
        ])
        .setup(|app| {
            app.manage(floating_layout::FloatingLayout::default());
            app.manage(clipboard::ClipboardService::start(app.handle().clone()));
            app.manage(quick_paste::QuickPaste::default());
            let vault =
                vault_service::VaultService::new(app.path().app_data_dir()?.join("vault.lime"));
            app.manage(vault.clone());
            app.manage(
                browser_bridge::BrowserBridge::start(app.path().app_data_dir()?, vault.clone())
                    .ok(),
            );
            let vault_app = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(1));
                if vault.check() {
                    vault_service::lock_all(&vault_app);
                }
            });
            let show = MenuItem::with_id(app, "show", "打开收藏室", true, None::<&str>)?;
            let floating =
                MenuItem::with_id(app, "floating", "显示 / 隐藏悬浮轮盘", true, None::<&str>)?;
            let lock = MenuItem::with_id(app, "lock", "锁定密码库", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出应用", true, None::<&str>)?;
            let reset = MenuItem::with_id(
                app,
                "reset-floating",
                "重置悬浮轮盘位置",
                true,
                None::<&str>,
            )?;
            let menu = Menu::with_items(app, &[&show, &floating, &reset, &lock, &quit])?;
            let icon = app
                .default_window_icon()
                .ok_or("Missing application icon")?
                .clone();
            TrayIconBuilder::with_id("lime-tray")
                .icon(icon)
                .tooltip("直到密码变成一颗酸橙")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        let _ = show_main(app);
                    }
                    "lock" => {
                        vault_service::lock_all(app);
                        if let Ok(main) = show_main(app) {
                            let _ = main.emit("lime-action", "lock");
                        }
                    }
                    "floating" => {
                        if let Some(window) = app.get_webview_window("floating") {
                            if window.is_visible().unwrap_or(false) {
                                if let Err(error) = save_floating_placement(app) {
                                    eprintln!("Could not save floating placement: {error}");
                                }
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                            }
                        }
                    }
                    "reset-floating" => {
                        if let Some(window) = app.get_webview_window("floating") {
                            if let Err(error) = restore_floating_placement(&window, true) {
                                eprintln!("Could not reset floating placement: {error}");
                            }
                            let _ = window.show();
                            if let Err(error) = save_floating_placement(app) {
                                eprintln!("Could not save floating placement: {error}");
                            }
                        }
                    }
                    "quit" => {
                        vault_service::lock_all(app);
                        app.state::<clipboard::ClipboardService>().clear(app, true);
                        if let Err(error) = save_floating_placement(app) {
                            eprintln!("Could not save floating placement: {error}");
                        }
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                    ) {
                        let _ = show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            let floating_window = WebviewWindowBuilder::new(
                app,
                "floating",
                WebviewUrl::App("index.html?surface=floating".into()),
            )
            .title("酸橙 · 悬浮轮盘")
            .inner_size(96.0, 88.0)
            .position(132.0, 258.0)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .visible(false)
            .build()?;
            if let Err(error) = restore_floating_placement(&floating_window, false) {
                eprintln!("Could not restore floating placement: {error}");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Err(error) = save_floating_placement(window.app_handle()) {
                    eprintln!("Could not save floating placement: {error}");
                }
                let _ = window.hide();
            }
        })
        .run(context)
        .expect("Could not start the Lime desktop preview");
}

#[cfg(test)]
mod tests {
    use super::{clamp_origin, floating_geometry, supported_action};
    #[test]
    fn resizing_preserves_center_away_from_edges() {
        let (_, _, compact_x, compact_y) = floating_geometry(false);
        let (_, _, expanded_x, expanded_y) = floating_geometry(true);
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let x = 400.0 + (compact_x - expanded_x) * scale;
            let y = 400.0 + (compact_y - expanded_y) * scale;
            assert_eq!(x + expanded_x * scale, 400.0 + compact_x * scale);
            assert_eq!(y + expanded_y * scale, 400.0 + compact_y * scale);
        }
    }
    #[test]
    fn bounds_support_negative_monitors_and_small_work_areas() {
        assert_eq!(clamp_origin(-2000.0, -1920.0, 1920.0, 300.0), -1920.0);
        assert_eq!(clamp_origin(-50.0, -1920.0, 1920.0, 300.0), -300.0);
        assert_eq!(clamp_origin(1900.0, 0.0, 1920.0, 300.0), 1620.0);
        assert_eq!(clamp_origin(20.0, 0.0, 200.0, 300.0), 0.0);
    }
    #[test]
    fn only_explicit_navigation_actions_are_accepted() {
        for action in ["vault", "search", "generate", "lock"] {
            assert!(supported_action(action));
        }
        for action in ["fill", "exit", "shell", "", "SEARCH"] {
            assert!(!supported_action(action));
        }
    }
}
