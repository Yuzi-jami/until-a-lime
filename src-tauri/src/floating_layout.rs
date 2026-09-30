//! One source of truth for the transparent window and its fruit anchor.
use std::sync::Mutex;
use tauri::{Manager, WebviewWindow};

#[derive(Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Edge {
    Left,
    Right,
    Top,
    Bottom,
}

#[derive(Clone, Copy, PartialEq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Layout {
    Compact,
    Wheel,
    Panel,
    Notice,
}

pub struct State {
    pub layout: Layout,
    pub edge: Option<Edge>,
    motion: Option<PendingMotion>,
    revision: u64,
}
impl Default for State {
    fn default() -> Self {
        Self {
            layout: Layout::Compact,
            edge: None,
            motion: None,
            revision: 0,
        }
    }
}
#[derive(Default)]
pub struct FloatingLayout(pub Mutex<State>);

impl State {
    pub fn anchor(&self) -> (f64, f64) {
        if let Some(motion) = &self.motion {
            (motion.frame.from_x, motion.frame.from_y)
        } else {
            let (_, _, x, y) = geometry(self.layout, self.edge);
            (x, y)
        }
    }

    pub fn cancel_motion(&mut self) {
        self.motion = None;
        self.revision += 1;
    }
}

#[derive(Clone, Copy)]
struct Placement {
    layout: Layout,
    edge: Option<Edge>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    ax: f64,
    ay: f64,
}

#[derive(Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MotionFrame {
    id: u64,
    from_x: f64,
    from_y: f64,
    to_x: f64,
    to_y: f64,
}

struct PendingMotion {
    frame: MotionFrame,
    target: Placement,
}

pub fn geometry(layout: Layout, edge: Option<Edge>) -> (f64, f64, f64, f64) {
    match layout {
        Layout::Wheel | Layout::Panel => (300.0, 360.0, 150.0, 138.0),
        Layout::Notice => (300.0, 210.0, 150.0, 40.0),
        Layout::Compact => match edge {
            Some(Edge::Left) => (48.0, 88.0, 0.0, 40.0),
            Some(Edge::Right) => (48.0, 88.0, 48.0, 40.0),
            Some(Edge::Top) => (96.0, 44.0, 48.0, 0.0),
            Some(Edge::Bottom) => (96.0, 44.0, 48.0, 44.0),
            None => (96.0, 88.0, 48.0, 40.0),
        },
    }
}

fn nearest_edge(cx: f64, cy: f64, bounds: (f64, f64, f64, f64), threshold: f64) -> Option<Edge> {
    let (left, top, right, bottom) = bounds;
    [
        (Edge::Left, (cx - left).abs()),
        (Edge::Right, (cx - right).abs()),
        (Edge::Top, (cy - top).abs()),
        (Edge::Bottom, (cy - bottom).abs()),
    ]
    .into_iter()
    .filter(|(_, distance)| *distance <= threshold)
    .min_by(|a, b| a.1.total_cmp(&b.1))
    .map(|(edge, _)| edge)
}

// Unlike Tauri's start_dragging (which only posts a message), this future
// resolves after Windows leaves its native move loop, including cancellation.
#[cfg(windows)]
pub async fn drag_until_released(window: WebviewWindow) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    window
        .run_on_main_thread(move || {
            let result = native_drag(hwnd);
            let _ = sender.try_send(result);
        })
        .map_err(|e| e.to_string())?;
    receiver.recv().await.ok_or("拖动窗口已关闭。")?
}

#[cfg(windows)]
fn native_drag(hwnd: isize) -> Result<(), String> {
    use windows_sys::Win32::{
        Foundation::{HWND, POINT},
        UI::{
            Input::KeyboardAndMouse::{GetAsyncKeyState, ReleaseCapture, VK_LBUTTON},
            WindowsAndMessaging::{GetCursorPos, SendMessageW, HTCAPTION, WM_NCLBUTTONDOWN},
        },
    };
    // SAFETY: this runs on the window's owning UI thread. No hooks or injected
    // input are used; Windows performs its normal caption drag until release.
    unsafe {
        // The user may have released while a preceding layout change completed.
        if GetAsyncKeyState(i32::from(VK_LBUTTON)) >= 0 {
            return Ok(());
        }
        let mut point = POINT { x: 0, y: 0 };
        if GetCursorPos(&mut point) == 0 {
            return Err("无法读取鼠标位置。".into());
        }
        ReleaseCapture();
        SendMessageW(
            hwnd as HWND,
            WM_NCLBUTTONDOWN,
            HTCAPTION as usize,
            caption_position(point.x, point.y),
        );
    }
    Ok(())
}

#[cfg(any(windows, test))]
fn caption_position(x: i32, y: i32) -> isize {
    // WM_NCLBUTTONDOWN uses signed screen coordinates packed into two WORDs.
    ((u32::from(y as u16) << 16) | u32::from(x as u16)) as isize
}

#[cfg(not(windows))]
pub async fn drag_until_released(_window: WebviewWindow) -> Result<(), String> {
    Err("悬浮窗拖动目前仅支持 Windows。".into())
}

#[tauri::command]
pub fn floating_layout(
    window: WebviewWindow,
    layout: Layout,
    settle: Option<bool>,
) -> Result<Option<Edge>, String> {
    if window.label() != "floating" {
        return Err("Floating window required".into());
    }
    let state = window.state::<FloatingLayout>();
    let mut state = state.0.lock().map_err(|_| "悬浮窗状态不可用。")?;
    let plan = plan_layout(&window, &state, layout, settle.unwrap_or(false))?;
    apply_placement(&window, plan.target)?;
    state.cancel_motion();
    state.layout = layout;
    state.edge = plan.target.edge;
    Ok(if layout == Layout::Compact {
        state.edge
    } else {
        None
    })
}

struct LayoutPlan {
    target: Placement,
    scale: f64,
    cx: f64,
    cy: f64,
    bounds: (f64, f64, f64, f64),
}

fn plan_layout(
    window: &WebviewWindow,
    state: &State,
    layout: Layout,
    settle: bool,
) -> Result<LayoutPlan, String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let (ox, oy) = state.anchor();
    let cx = f64::from(position.x) + ox * scale;
    let cy = f64::from(position.y) + oy * scale;
    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .or(window.primary_monitor().map_err(|e| e.to_string())?)
        .ok_or("没有可用屏幕。")?;
    let area = monitor.work_area();
    let left = f64::from(area.position.x);
    let top = f64::from(area.position.y);
    let right = left + f64::from(area.size.width);
    let bottom = top + f64::from(area.size.height);
    // Keep the old clipped anchor until AFTER computing the fruit's center.
    // A completed drag can leave its old edge and snap to a different one.
    let retained_edge = if settle { None } else { state.edge };
    let edge = retained_edge.or_else(|| {
        if layout == Layout::Compact {
            nearest_edge(cx, cy, (left, top, right, bottom), 70.0 * scale)
        } else {
            None
        }
    });
    Ok(LayoutPlan {
        target: target_placement(layout, edge, cx, cy, scale, (left, top, right, bottom)),
        scale,
        cx,
        cy,
        bounds: (left, top, right, bottom),
    })
}

fn target_placement(
    layout: Layout,
    edge: Option<Edge>,
    cx: f64,
    cy: f64,
    scale: f64,
    bounds: (f64, f64, f64, f64),
) -> Placement {
    let (left, top, right, bottom) = bounds;
    let (width, height, ax, ay) = geometry(layout, edge);
    let mut x = cx - ax * scale;
    let mut y = cy - ay * scale;
    if let Some(edge) = edge {
        match edge {
            Edge::Left => x = left,
            Edge::Right => x = right - width * scale,
            Edge::Top => y = top,
            Edge::Bottom => y = bottom - height * scale,
        }
    }
    x = super::clamp_origin(x, left, right - left, width * scale);
    y = super::clamp_origin(y, top, bottom - top, height * scale);
    Placement {
        layout,
        edge,
        x: x.round(),
        y: y.round(),
        width,
        height,
        ax,
        ay,
    }
}

fn apply_placement(window: &WebviewWindow, target: Placement) -> Result<(), String> {
    window
        .set_size(tauri::LogicalSize::new(target.width, target.height))
        .map_err(|e| e.to_string())?;
    window
        .set_position(tauri::PhysicalPosition::new(
            target.x.round() as i32,
            target.y.round() as i32,
        ))
        .map_err(|e| e.to_string())?;
    Ok(())
}

// The animation runs inside a temporary, on-screen surface containing both
// fruit positions. Only after it finishes do we crop down to the half fruit.
#[tauri::command]
pub fn prepare_floating_motion(
    window: WebviewWindow,
    layout: Layout,
    settle: Option<bool>,
) -> Result<Option<MotionFrame>, String> {
    if window.label() != "floating" {
        return Err("Floating window required".into());
    }
    let state = window.state::<FloatingLayout>();
    let mut state = state.0.lock().map_err(|_| "悬浮窗状态不可用。")?;
    if state.motion.is_some() {
        return Err("悬浮窗正在移动。".into());
    }
    if !matches!(layout, Layout::Compact | Layout::Wheel)
        || !matches!(state.layout, Layout::Compact | Layout::Wheel)
    {
        return Ok(None);
    }
    let plan = plan_layout(&window, &state, layout, settle.unwrap_or(false))?;
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let old = (
        f64::from(position.x),
        f64::from(position.y),
        f64::from(size.width),
        f64::from(size.height),
    );
    let (stage, frame) = motion_frame(&plan, old, state.revision + 1);
    if (frame.to_x - frame.from_x).hypot(frame.to_y - frame.from_y) < 0.5 {
        return Ok(None);
    }
    apply_placement(&window, stage)?;
    state.revision = frame.id;
    state.motion = Some(PendingMotion {
        frame,
        target: plan.target,
    });
    Ok(Some(frame))
}

fn motion_frame(plan: &LayoutPlan, old: (f64, f64, f64, f64), id: u64) -> (Placement, MotionFrame) {
    let target = plan.target;
    let scale = plan.scale;
    let (left, top, right, bottom) = plan.bounds;
    let x = old.0.min(target.x).max(left).round();
    let y = old.1.min(target.y).max(top).round();
    let width = ((old.0 + old.2)
        .max(target.x + target.width * scale)
        .min(right)
        - x)
        .max(1.0)
        / scale;
    let height = ((old.1 + old.3)
        .max(target.y + target.height * scale)
        .min(bottom)
        - y)
        .max(1.0)
        / scale;
    let frame = MotionFrame {
        id,
        from_x: (plan.cx - x) / scale,
        from_y: (plan.cy - y) / scale,
        to_x: (target.x + target.ax * scale - x) / scale,
        to_y: (target.y + target.ay * scale - y) / scale,
    };
    (
        Placement {
            x,
            y,
            width,
            height,
            ..target
        },
        frame,
    )
}

#[tauri::command]
pub fn finish_floating_motion(window: WebviewWindow, id: u64) -> Result<Option<Edge>, String> {
    if window.label() != "floating" {
        return Err("Floating window required".into());
    }
    let state = window.state::<FloatingLayout>();
    let mut state = state.0.lock().map_err(|_| "悬浮窗状态不可用。")?;
    let motion = state
        .motion
        .as_ref()
        .filter(|motion| motion.frame.id == id)
        .ok_or("悬浮窗移动已取消。")?;
    let target = motion.target;
    apply_placement(&window, target)?;
    state.cancel_motion();
    state.layout = target.layout;
    state.edge = target.edge;
    Ok(if target.layout == Layout::Compact {
        target.edge
    } else {
        None
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn motion_surface_preserves_both_endpoints_with_all_edges_and_scales() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let bounds = (-1920.0 * scale, -1080.0 * scale, 0.0, 0.0);
            for edge in [Edge::Left, Edge::Right, Edge::Top, Edge::Bottom] {
                let expanded = target_placement(
                    Layout::Wheel,
                    Some(edge),
                    -900.0 * scale,
                    -500.0 * scale,
                    scale,
                    bounds,
                );
                let compact = target_placement(
                    Layout::Compact,
                    Some(edge),
                    expanded.x + expanded.ax * scale,
                    expanded.y + expanded.ay * scale,
                    scale,
                    bounds,
                );
                for (from, target) in [(expanded, compact), (compact, expanded)] {
                    let plan = LayoutPlan {
                        target,
                        scale,
                        cx: from.x + from.ax * scale,
                        cy: from.y + from.ay * scale,
                        bounds,
                    };
                    let (stage, frame) = motion_frame(
                        &plan,
                        (from.x, from.y, from.width * scale, from.height * scale),
                        1,
                    );
                    assert!((stage.x + frame.from_x * scale - plan.cx).abs() < 0.01);
                    assert!((stage.y + frame.from_y * scale - plan.cy).abs() < 0.01);
                    assert!(
                        (stage.x + frame.to_x * scale - (target.x + target.ax * scale)).abs()
                            < 0.01
                    );
                    assert!(
                        (stage.y + frame.to_y * scale - (target.y + target.ay * scale)).abs()
                            < 0.01
                    );
                    assert!(stage.x >= bounds.0 && stage.y >= bounds.1);
                    assert!(stage.x + stage.width * scale <= bounds.2 + 0.01);
                    assert!(stage.y + stage.height * scale <= bounds.3 + 0.01);
                    assert!(frame.from_x >= 0.0 && frame.from_x <= stage.width);
                    assert!(frame.to_x >= 0.0 && frame.to_x <= stage.width);
                    assert!(frame.from_y >= 0.0 && frame.from_y <= stage.height);
                    assert!(frame.to_y >= 0.0 && frame.to_y <= stage.height);
                }
            }
        }
    }
    #[test]
    fn caption_coordinates_roundtrip_on_negative_monitors() {
        for (x, y) in [(-1820, -900), (-800, 200), (400, -900), (1200, 850)] {
            let packed = caption_position(x, y);
            assert_eq!(i32::from(packed as i16), x);
            assert_eq!(i32::from((packed >> 16) as i16), y);
        }
    }
    #[test]
    fn snapping_supports_all_edges_negative_monitors_and_dpi() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let bounds = (-1920.0 * scale, 0.0, 0.0, 1080.0 * scale);
            assert!(matches!(
                nearest_edge(-1900.0 * scale, 400.0 * scale, bounds, 70.0 * scale),
                Some(Edge::Left)
            ));
            assert!(matches!(
                nearest_edge(-20.0 * scale, 400.0 * scale, bounds, 70.0 * scale),
                Some(Edge::Right)
            ));
            assert!(matches!(
                nearest_edge(-900.0 * scale, 20.0 * scale, bounds, 70.0 * scale),
                Some(Edge::Top)
            ));
            assert!(matches!(
                nearest_edge(-900.0 * scale, 1060.0 * scale, bounds, 70.0 * scale),
                Some(Edge::Bottom)
            ));
            assert!(nearest_edge(-900.0 * scale, 400.0 * scale, bounds, 70.0 * scale).is_none());
        }
    }
    #[test]
    fn compact_clips_exactly_half_the_fruit_and_notice_has_separate_space() {
        for edge in [Edge::Left, Edge::Right, Edge::Top, Edge::Bottom] {
            let (w, h, x, y) = geometry(Layout::Compact, Some(edge));
            assert!(x == 0.0 || x == w || y == 0.0 || y == h);
            let (w, h, x, y) = geometry(Layout::Wheel, Some(edge));
            assert!(x > 31.0 && y > 31.0 && w - x > 31.0 && h - y > 31.0);
        }
        let (_, h, _, y) = geometry(Layout::Notice, None);
        assert!(y + 31.0 < 88.0 && h >= 200.0);
    }
}
