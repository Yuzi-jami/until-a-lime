use std::io::{Read, Write};
use zeroize::Zeroizing;

pub const HOST: &str = "dev.untilalime.browser";
pub const EXTENSION_ID: &str = include_str!("../../extension/extension-id.txt");
pub const MAX_MESSAGE: usize = 256 * 1024;

pub fn read_frame(reader: &mut impl Read) -> Result<Zeroizing<Vec<u8>>, String> {
    let mut length = [0; 4];
    reader.read_exact(&mut length).map_err(|_| "连接已关闭。")?;
    let size = u32::from_le_bytes(length) as usize;
    if size == 0 || size > MAX_MESSAGE {
        return Err("消息长度无效。".into());
    }
    let mut bytes = Zeroizing::new(vec![0; size]);
    reader
        .read_exact(&mut bytes)
        .map_err(|_| "消息未完整接收。")?;
    Ok(bytes)
}
pub fn write_frame(writer: &mut impl Write, bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() || bytes.len() > MAX_MESSAGE {
        return Err("消息长度无效。".into());
    }
    writer
        .write_all(&(bytes.len() as u32).to_le_bytes())
        .and_then(|_| writer.write_all(bytes))
        .and_then(|_| writer.flush())
        .map_err(|_| "消息发送失败。".into())
}
pub fn allowed_extension(origin: &str) -> bool {
    origin == format!("chrome-extension://{EXTENSION_ID}/")
}

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub operation: String,
    pub origin: String,
    pub id: Option<u32>,
}
#[derive(serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct Envelope {
    pub token: String,
    pub extension: String,
    pub request: Request,
}
#[derive(serde::Deserialize, serde::Serialize)]
pub struct Connection {
    pub port: u16,
    pub token: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn framing_rejects_oversized_truncated_and_wrong_extension() {
        assert!(read_frame(&mut &u32::MAX.to_le_bytes()[..]).is_err());
        assert!(read_frame(&mut &[3, 0, 0, 0, 1][..]).is_err());
        let mut buffer = vec![];
        write_frame(&mut buffer, b"test").unwrap();
        assert_eq!(&**read_frame(&mut &buffer[..]).unwrap(), b"test");
        assert!(allowed_extension(&format!(
            "chrome-extension://{EXTENSION_ID}/"
        )));
        assert!(!allowed_extension("https://example.invalid/"));
        assert!(!allowed_extension("chrome-extension://other/"));
        assert_eq!(HOST, "dev.untilalime.browser");
    }
}
