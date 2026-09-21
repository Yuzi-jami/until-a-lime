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

fn run() -> Result<(), String> {
    if !std::env::args()
        .nth(1)
        .as_deref()
        .is_some_and(allowed_extension)
    {
        return Err("扩展来源未获允许。".into());
    }
    let dir = std::env::var_os("APPDATA").ok_or("无法定位当前用户数据目录。")?;
    let path = std::path::PathBuf::from(dir)
        .join("dev.untilalime.desktop")
        .join("browser-bridge.json");
    let data = Zeroizing::new(
        std::fs::read(path).map_err(|_| "请在酸橙软件中准备浏览器扩展，并保持软件运行。")?,
    );
    let config: Connection = serde_json::from_slice(&data).map_err(|_| "浏览器连接配置无效。")?;
    let request: Request =
        serde_json::from_slice(&read_frame(&mut io::stdin())?).map_err(|_| "请求格式无效。")?;
    if config.token.len() != 64 {
        return Err("浏览器连接配置无效。".into());
    }
    let mut stream = TcpStream::connect_timeout(
        &SocketAddr::from(([127, 0, 0, 1], config.port)),
        Duration::from_secs(2),
    )
    .map_err(|_| "请先打开酸橙软件。")?;
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
