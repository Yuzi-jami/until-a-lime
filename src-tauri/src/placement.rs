use serde::{Deserialize, Serialize};
use std::{fs, io, path::Path};

/// Only a window preference; never account data. Physical screen coordinates
/// preserve monitor selection, including displays left of the primary display.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
pub struct Placement {
    version: u8,
    pub center_x: f64,
    pub center_y: f64,
}

impl Placement {
    pub fn new(center_x: f64, center_y: f64) -> Self {
        Self {
            version: 1,
            center_x,
            center_y,
        }
    }

    fn valid(self) -> bool {
        self.version == 1
            && [self.center_x, self.center_y]
                .iter()
                .all(|n| n.is_finite() && *n >= f64::from(i32::MIN) && *n <= f64::from(i32::MAX))
    }
}

pub fn read(path: &Path) -> Option<Placement> {
    // A malformed preference must not prevent the application from starting.
    if fs::metadata(path).ok()?.len() > 1024 {
        return None;
    }
    let placement: Placement = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    placement.valid().then_some(placement)
}

pub fn write(path: &Path, placement: Placement) -> io::Result<()> {
    if !placement.valid() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Invalid placement",
        ));
    }
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Missing directory"))?;
    fs::create_dir_all(parent)?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, serde_json::to_vec(&placement)?)?;
    fs::rename(temp, path)
}

pub fn contains(center: Placement, x: i32, y: i32, width: u32, height: u32) -> bool {
    center.center_x >= f64::from(x)
        && center.center_y >= f64::from(y)
        && center.center_x < f64::from(x) + f64::from(width)
        && center.center_y < f64::from(y) + f64::from(height)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unsupported_and_invalid_coordinates() {
        assert!(!Placement::new(f64::NAN, 0.0).valid());
        assert!(!Placement::new(f64::INFINITY, 0.0).valid());
        assert!(!Placement::new(f64::MAX, 0.0).valid());
        assert!(!Placement {
            version: 2,
            center_x: 10.0,
            center_y: 10.0
        }
        .valid());
        assert!(Placement::new(-1800.0, 150.0).valid());
    }

    #[test]
    fn monitor_selection_handles_negative_origins_and_exclusive_edges() {
        assert!(contains(Placement::new(-100.0, 50.0), -1920, 0, 1920, 1080));
        assert!(!contains(Placement::new(0.0, 50.0), -1920, 0, 1920, 1080));
        assert!(!contains(
            Placement::new(-100.0, -1.0),
            -1920,
            0,
            1920,
            1080
        ));
    }

    #[test]
    fn persistence_replaces_previous_preference_and_recovers_from_corruption() {
        let dir = std::env::temp_dir().join(format!("lime-placement-test-{}", std::process::id()));
        let path = dir.join("floating-position.json");
        assert_eq!(read(&path), None);
        write(&path, Placement::new(200.0, 300.0)).unwrap();
        let second = Placement::new(-150.0, 250.0);
        write(&path, second).unwrap();
        assert_eq!(read(&path), Some(second));
        fs::write(&path, b"broken json").unwrap();
        assert_eq!(read(&path), None);
        fs::remove_file(path).unwrap();
        fs::remove_dir(dir).unwrap();
    }
}
