//! Opt-in native-messaging bridge. Local raw TCP, per-launch 256-bit token;
//! no HTTP/CORS API, no vault key in files, no browser-origin wildcard.
use crate::{browser_protocol::*, vault_service::VaultService};
use rand_core::RngCore;
use std::{
    net::TcpListener,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::Manager;
use zeroize::{Zeroize, Zeroizing};

#[derive(Clone)]
pub struct BrowserBridge {
    enabled: Arc<AtomicBool>,
    directory: PathBuf,
    port: u16,
    token: String,
}
#[derive(serde::Serialize)]
pub struct BrowserEntry {
    pub id: u32,
    pub name: String,
    pub user: String,
}
#[derive(serde::Serialize)]
pub struct Credential {
    pub user: String,
    pub password: String,
}
impl Drop for Credential {
    fn drop(&mut self) {
        self.user.zeroize();
        self.password.zeroize();
    }
}
#[derive(serde::Serialize, Default)]
pub struct Reply {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entries: Option<Vec<BrowserEntry>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credential: Option<Credential>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub fn origin(value: &str) -> Result<String, String> {
    let url = url::Url::parse(value).map_err(|_| "网站地址无效。")?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.host_str().is_none()
    {
        return Err("只为 HTTPS 网站填写。".into());
    }
    Ok(url.origin().ascii_serialization())
}
pub fn matches_site(saved: &str, requested: &str) -> bool {
    let saved = if saved.contains("://") {
        saved.to_owned()
    } else {
        format!("https://{saved}")
    };
    origin(&saved).is_ok_and(|value| value == requested)
}
impl BrowserBridge {
    pub fn start(directory: PathBuf, service: VaultService) -> Result<Self, String> {
        let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|_| "浏览器连接不可用。")?;
        let mut random = [0; 32];
        rand_core::OsRng
            .try_fill_bytes(&mut random)
            .map_err(|_| "系统随机数不可用。")?;
        let bridge = Self {
            port: listener
                .local_addr()
                .map_err(|_| "浏览器连接不可用。")?
                .port(),
            token: random.iter().map(|b| format!("{b:02x}")).collect(),
            enabled: Arc::new(AtomicBool::new(directory.join("browser-enabled").exists())),
            directory,
        };
        if bridge.enabled.load(Ordering::Relaxed) {
            bridge.write_connection()?;
        }
        let worker = bridge.clone();
        std::thread::spawn(move || {
            // Serial, bounded frames/timeouts: no unbounded worker allocation.
            for mut stream in listener.incoming().flatten() {
                let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
                let result = (|| {
                    let data = read_frame(&mut stream)?;
                    let request: Envelope =
                        serde_json::from_slice(&data).map_err(|_| "请求无效。")?;
                    if !worker.enabled.load(Ordering::Relaxed)
                        || request.token != worker.token
                        || !allowed_extension(&request.extension)
                    {
                        return Err("浏览器连接未授权。".into());
                    }
                    service.browser_request(request.request)
                })();
                let reply = result.unwrap_or_else(|error| Reply {
                    error: Some(error),
                    ..Reply::default()
                });
                if let Ok(bytes) = serde_json::to_vec(&reply) {
                    let bytes = Zeroizing::new(bytes);
                    let _ = write_frame(&mut stream, &bytes);
                }
            }
        });
        Ok(bridge)
    }
    fn write_connection(&self) -> Result<(), String> {
        use std::io::Write;
        std::fs::create_dir_all(&self.directory).map_err(|_| "无法创建连接目录。")?;
        let data = Zeroizing::new(
            serde_json::to_vec(&Connection {
                port: self.port,
                token: self.token.clone(),
            })
            .map_err(|_| "连接配置失败。")?,
        );
        let mut temp =
            tempfile::NamedTempFile::new_in(&self.directory).map_err(|_| "连接配置失败。")?;
        temp.write_all(&data).map_err(|_| "连接配置失败。")?;
        temp.persist(self.directory.join("browser-bridge.json"))
            .map_err(|_| "连接配置失败。")?;
        Ok(())
    }
}

#[tauri::command]
pub fn browser_install(window: tauri::WebviewWindow) -> Result<String, String> {
    if window.label() != "main" {
        return Err("仅主窗口可准备扩展。".into());
    }
    let state = window.state::<Option<BrowserBridge>>();
    let bridge = state
        .as_ref()
        .ok_or("浏览器连接暂不可用，请重新启动应用；密码库仍可正常使用。")?;
    let executable = std::env::current_exe().map_err(|_| "无法定位程序。")?;
    let host = executable
        .parent()
        .ok_or("无法定位程序目录。")?
        .join("lime-browser-host.exe");
    if !host.is_file() {
        return Err("缺少浏览器组件。请使用包含浏览器组件的新安装包，开发环境请先运行 npm run browser:prepare。".into());
    }
    let folder = bridge.directory.join("extension");
    std::fs::create_dir_all(&folder).map_err(|_| "无法创建扩展目录。")?;
    for (name, bytes) in [
        (
            "manifest.json",
            include_bytes!("../../extension/manifest.json").as_slice(),
        ),
        (
            "popup.html",
            include_bytes!("../../extension/popup.html").as_slice(),
        ),
        (
            "popup.js",
            include_bytes!("../../extension/popup.js").as_slice(),
        ),
        (
            "popup.css",
            include_bytes!("../../extension/popup.css").as_slice(),
        ),
        (
            "fill.js",
            include_bytes!("../../extension/fill.js").as_slice(),
        ),
        (
            "icon.png",
            include_bytes!("../../extension/icon.png").as_slice(),
        ),
    ] {
        std::fs::write(folder.join(name), bytes).map_err(|_| "无法准备扩展文件。")?;
    }
    let manifest = bridge.directory.join("browser-host.json");
    let json = serde_json::json!({ "name": HOST, "description": "Lime local vault bridge", "path": host, "type": "stdio", "allowed_origins": [format!("chrome-extension://{EXTENSION_ID}/")] });
    std::fs::write(
        &manifest,
        serde_json::to_vec_pretty(&json).map_err(|_| "扩展配置失败。")?,
    )
    .map_err(|_| "扩展配置失败。")?;
    #[cfg(windows)]
    for browser in ["Google\\Chrome", "Microsoft\\Edge"] {
        use std::os::windows::process::CommandExt;
        let status = std::process::Command::new("reg.exe")
            .args([
                "ADD",
                &format!("HKCU\\Software\\{browser}\\NativeMessagingHosts\\{HOST}"),
                "/ve",
                "/t",
                "REG_SZ",
                "/d",
            ])
            .arg(&manifest)
            .arg("/f")
            .creation_flags(0x08000000)
            .output()
            .map_err(|_| "无法注册当前用户浏览器组件。")?;
        if !status.status.success() {
            return Err("注册失败，请检查当前用户权限。".into());
        }
    }
    bridge.write_connection()?;
    std::fs::write(bridge.directory.join("browser-enabled"), b"enabled")
        .map_err(|_| "无法保存连接偏好。")?;
    bridge.enabled.store(true, Ordering::Relaxed);
    Ok(format!(
        "已准备本机连接。请在浏览器加载此扩展文件夹：{}",
        folder.display()
    ))
}

#[tauri::command]
pub fn browser_disconnect(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("仅主窗口可断开扩展。".into());
    }
    let state = window.state::<Option<BrowserBridge>>();
    let bridge = state
        .as_ref()
        .ok_or("浏览器连接暂不可用，请重新启动应用；密码库仍可正常使用。")?;
    bridge.enabled.store(false, Ordering::Relaxed);
    for name in ["browser-enabled", "browser-bridge.json"] {
        match std::fs::remove_file(bridge.directory.join(name)) {
            Ok(()) => (),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(_) => return Err("已停止本次连接，但无法清除偏好，请检查数据目录权限。".into()),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn live_bridge_requires_token_extension_enablement_and_unlocked_session() {
        use std::net::TcpStream;
        let dir = tempfile::tempdir().unwrap();
        let vault = VaultService::new(dir.path().join("fictional.lime"));
        let bridge = BrowserBridge::start(dir.path().into(), vault).unwrap();
        let send = |token: &str, extension: &str| {
            let mut stream = TcpStream::connect(("127.0.0.1", bridge.port)).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let message = serde_json::to_vec(&Envelope {
                token: token.into(),
                extension: extension.into(),
                request: Request {
                    operation: "list".into(),
                    origin: "https://example.invalid".into(),
                    id: None,
                },
            })
            .unwrap();
            write_frame(&mut stream, &message).unwrap();
            serde_json::from_slice::<serde_json::Value>(&read_frame(&mut stream).unwrap()).unwrap()
        };
        let origin = format!("chrome-extension://{EXTENSION_ID}/");
        assert_eq!(send(&bridge.token, &origin)["error"], "浏览器连接未授权。");
        bridge.enabled.store(true, Ordering::Relaxed);
        assert_eq!(send("wrong-token", &origin)["error"], "浏览器连接未授权。");
        assert_eq!(
            send(&bridge.token, "chrome-extension://wrong/")["error"],
            "浏览器连接未授权。"
        );
        let reply = send(&bridge.token, &origin);
        assert_eq!(reply["error"], "密码库已锁定。");
        assert!(reply.get("credential").is_none());
        bridge.enabled.store(false, Ordering::Relaxed);
        assert_eq!(send(&bridge.token, &origin)["error"], "浏览器连接未授权。");
    }
    #[test]
    fn matching_requires_exact_https_origin() {
        assert!(matches_site(
            "example.invalid/login",
            "https://example.invalid"
        ));
        for saved in [
            "http://example.invalid",
            "https://example.invalid.evil.invalid",
            "https://sub.example.invalid",
            "https://example.invalid:444",
            "https://user@example.invalid",
            "javascript:alert(1)",
        ] {
            assert!(!matches_site(saved, "https://example.invalid"));
        }
        assert!(origin("http://example.invalid").is_err());
        assert_eq!(
            origin("https://EXAMPLE.invalid:443/login").unwrap(),
            "https://example.invalid"
        );
    }
}
