#[cfg(windows)]
mod platform;
#[cfg(windows)]
mod quickfill;

fn main() {
    // User explicitly authorized a manual retry. All other runtime modes stay held.
    #[cfg(windows)]
    if std::env::args().skip(1).collect::<Vec<_>>() == ["--manual-retry"] {
        if let Err(error) = quickfill::run(false) {
            eprintln!("Manual retry stopped: {:?}", error.code());
            std::process::exit(1);
        }
        return;
    }
    #[cfg(windows)]
    let _disabled_entrypoint: fn() -> windows::core::Result<()> = platform::run;
    eprintln!(
        "Execution suspended after a reported Windows bugcheck. See docs/incident-2026-09-10.md. No automation was started."
    );
    std::process::exit(2);
}
