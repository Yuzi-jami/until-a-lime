// Browser launches this console executable with inherited, framed stdio pipes.
// Never print diagnostics to stdout or log credentials.
#[path = "../browser_protocol.rs"]
mod browser_protocol;
use browser_protocol::*;
use std::{
    io,
    net::{SocketAddr, TcpStream},
    time::Duration,
};
use zeroize::Zeroizing;

fn connect_bridge(directory: &std::path::Path) -> Result<(TcpStream, Connection), String> {
    if !directory.join("browser-enabled").is_file() {
        return Err("请先在酸橙设置中准备浏览器扩展。".into());
    }
    let mut started = false;
    for _ in 0..40 {
        if !directory.join("browser-enabled").is_file() {
            return Err("浏览器连接已关闭。".into());
        }
        let config = std::fs::read(directory.join("browser-bridge.json"))
            .ok()
            .map(Zeroizing::new)
            .and_then(|bytes| serde_json::from_slice::<Connection>(&bytes).ok());
        if let Some(config) = config.filter(|config| config.token.len() == 64) {
            if let Ok(stream) = TcpStream::connect_timeout(
                &SocketAddr::from(([127, 0, 0, 1], config.port)),
                Duration::from_millis(100),
            ) {
                return Ok((stream, config));
            }
        }
        if !started {
            let executable = std::env::current_exe().map_err(|_| "无法定位浏览器组件。")?;
            let app = executable
                .parent()
                .ok_or("无法定位酸橙程序。")?
                .join("until-a-lime.exe");
            let mut command = std::process::Command::new(app);
            command
                .arg("--browser-background")
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x08000000);
            }
            command
                .spawn()
                .map_err(|_| "无法启动酸橙，请手动打开一次。")?;
            started = true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err("酸橙正在启动，请稍后重新点选输入框。".into())
}

fn run() -> Result<(), String> {
    if !std::env::args()
        .nth(1)
        .as_deref()
        .is_some_and(allowed_extension)
    {
        return Err("扩展来源未获允许。".into());
    }
    let dir = std::env::var_os("APPDATA").ok_or("无法定位当前用户数据目录。")?;
    let directory = std::path::PathBuf::from(dir).join("dev.untilalime.desktop");
    let request: Request =
        serde_json::from_slice(&read_frame(&mut io::stdin())?).map_err(|_| "请求格式无效。")?;
    let (mut stream, config) = connect_bridge(&directory)?;
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|_| "连接失败。")?;
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .map_err(|_| "连接失败。")?;
    let message = Zeroizing::new(
        serde_json::to_vec(&Envelope {
            token: config.token,
            extension: std::env::args().nth(1).ok_or("扩展来源无效。")?,
            request,
        })
        .map_err(|_| "请求格式无效。")?,
    );
    write_frame(&mut stream, &message)?;
    let reply = read_frame(&mut stream)?;
    write_frame(&mut io::stdout(), &reply)
}
fn main() {
    let _host = HOST;
    if let Err(error) = run() {
        let response = serde_json::json!({"error": error});
        if let Ok(bytes) = serde_json::to_vec(&response) {
            let _ = write_frame(&mut io::stdout(), &bytes);
        }
    }
}

#[cfg(test)]
mod connection_tests {
    use super::*;
    #[test]
    fn an_existing_enabled_bridge_connects_without_launch_and_disabled_stays_off() {
        let directory = tempfile::tempdir().unwrap();
        assert!(connect_bridge(directory.path()).is_err());
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let config = Connection {
            port: listener.local_addr().unwrap().port(),
            token: "a".repeat(64),
        };
        std::fs::write(
            directory.path().join("browser-bridge.json"),
            serde_json::to_vec(&config).unwrap(),
        )
        .unwrap();
        // A stale config alone must not override an explicit disconnect.
        assert!(connect_bridge(directory.path()).is_err());
        std::fs::write(directory.path().join("browser-enabled"), b"enabled").unwrap();
        let (_, restored) = connect_bridge(directory.path()).unwrap();
        assert_eq!(restored.port, config.port);
        assert_eq!(restored.token, config.token);
    }
}
