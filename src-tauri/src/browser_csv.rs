//! Browser CSV is plaintext. Only counts leave Rust during preview.
use crate::vault::Metadata;
use std::{io::Read, path::Path};
use zeroize::Zeroizing;

pub struct CsvEntry {
    pub meta: Metadata,
    pub password: Zeroizing<String>,
}

pub fn read(path: &Path) -> Result<Vec<CsvEntry>, String> {
    let file = std::fs::File::open(path).map_err(|_| "无法读取 CSV 文件。")?;
    let mut bytes = Zeroizing::new(Vec::new());
    file.take(8 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "CSV 读取失败。")?;
    parse(&bytes)
}

pub fn parse(bytes: &[u8]) -> Result<Vec<CsvEntry>, String> {
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("CSV 超过 8 MiB 限制。".into());
    }
    let decoded = decode(bytes)?;
    let mut text = decoded.trim_start_matches('\u{feff}');
    // Excel may add a delimiter hint when saving a CSV in another locale.
    let first_line = text.lines().next().unwrap_or("");
    let hinted = match first_line.trim_matches(' ').to_ascii_lowercase().as_str() {
        "sep=," => Some(b','),
        "sep=;" => Some(b';'),
        "sep=\t" => Some(b'\t'),
        _ => None,
    };
    if hinted.is_some() {
        text = text.split_once('\n').map(|(_, rest)| rest).unwrap_or("");
    }
    let delimiter = hinted.unwrap_or_else(|| detect_delimiter(text));
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(delimiter)
        .flexible(true)
        .from_reader(text.as_bytes());
    let headers = reader.headers().map_err(|_| "CSV 表头无效。")?.clone();
    let column = |aliases: &[&str], required: bool| -> Result<Option<usize>, String> {
        let found: Vec<_> = headers
            .iter()
            .enumerate()
            .filter(|(_, value)| aliases.contains(&value.trim().to_ascii_lowercase().as_str()))
            .map(|(i, _)| i)
            .collect();
        if found.len() > 1 {
            return Err("CSV 包含重复表头。".into());
        }
        if required && found.is_empty() {
            return Err(
                "CSV 缺少 url、username 或 password 列，请直接使用 Edge / Chrome 导出文件。".into(),
            );
        }
        Ok(found.first().copied())
    };
    let url = column(URL_HEADERS, true)?.unwrap();
    let user = column(USER_HEADERS, true)?.unwrap();
    let password = column(PASSWORD_HEADERS, true)?.unwrap();
    let name = column(&["name", "名称"], false)?;
    let note = column(&["note", "notes", "备注", "便笺"], false)?;
    let required_end = url.max(user).max(password);
    let mut rows = Vec::new();
    for (index, row) in reader.records().enumerate() {
        let row =
            row.map_err(|_| format!("CSV 第 {} 条记录格式无效，未导入任何账号。", index + 1))?;
        if row.iter().all(str::is_empty) {
            continue;
        }
        if rows.len() >= 2000 {
            return Err("CSV 超过 2000 条记录限制。".into());
        }
        // Missing optional trailing notes are common. Missing required cells or
        // extra cells are ambiguous and must never shift or truncate secrets.
        if row.len() <= required_end || row.len() > headers.len() {
            return Err(format!(
                "CSV 第 {} 条记录的列数与表头不匹配，未导入任何账号。",
                index + 1
            ));
        }
        let address = row.get(url).unwrap_or("");
        let title = name
            .and_then(|i| row.get(i))
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(if address.trim().is_empty() {
                "未命名账号"
            } else {
                address
            });
        let meta = Metadata {
            id: 0,
            name: title.into(),
            user: row.get(user).unwrap_or("").into(),
            url: address.into(),
            category: "生活".into(),
            icon: "◇".into(),
            note: note.and_then(|i| row.get(i)).unwrap_or("").into(),
            favorite: false,
        };
        let secret = Zeroizing::new(row.get(password).unwrap_or("").to_owned());
        crate::vault::validate(&meta, Some(&secret)).map_err(|reason| {
            format!("CSV 第 {} 条记录：{} 未导入任何账号。", index + 1, reason)
        })?;
        rows.push(CsvEntry {
            meta,
            password: secret,
        });
    }
    if rows.is_empty() {
        return Err("CSV 没有可导入的账号。".into());
    }
    Ok(rows)
}

const URL_HEADERS: &[&str] = &["url", "网址", "网站"];
const USER_HEADERS: &[&str] = &["username", "用户名"];
const PASSWORD_HEADERS: &[&str] = &["password", "密码"];

fn detect_delimiter(text: &str) -> u8 {
    b",;\t"
        .iter()
        .copied()
        .find(|delimiter| {
            let mut reader = csv::ReaderBuilder::new()
                .delimiter(*delimiter)
                .from_reader(text.as_bytes());
            reader.headers().is_ok_and(|headers| {
                [URL_HEADERS, USER_HEADERS, PASSWORD_HEADERS]
                    .iter()
                    .all(|aliases| {
                        headers.iter().any(|header| {
                            aliases.contains(&header.trim().to_ascii_lowercase().as_str())
                        })
                    })
            })
        })
        .unwrap_or(b',')
}

fn decode(bytes: &[u8]) -> Result<Zeroizing<String>, String> {
    if bytes.starts_with(b"PK\x03\x04") || bytes.starts_with(&[0xd0, 0xcf, 0x11, 0xe0]) {
        return Err(
            "这是 Excel 工作簿，请选择浏览器直接导出的 CSV 文件，无需用 Excel 转换。".into(),
        );
    }
    if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        let data = &bytes[2..];
        let (pairs, remainder) = data.as_chunks::<2>();
        if !remainder.is_empty() {
            return Err("CSV 的 UTF-16 编码不完整，请重新导出。".into());
        }
        let little = bytes[0] == 0xff;
        let words = Zeroizing::new(
            pairs
                .iter()
                .map(|pair| {
                    if little {
                        u16::from_le_bytes([pair[0], pair[1]])
                    } else {
                        u16::from_be_bytes([pair[0], pair[1]])
                    }
                })
                .collect::<Vec<_>>(),
        );
        return String::from_utf16(&words)
            .map(Zeroizing::new)
            .map_err(|_| "CSV 的 UTF-16 编码无效，请重新导出。".into());
    }
    std::str::from_utf8(bytes)
        .map(|text| Zeroizing::new(text.to_owned()))
        .map_err(|_| {
            "文件编码无法识别，请直接使用浏览器导出的 UTF-8 CSV，或另存为 CSV UTF-8。".into()
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn browser_exports_support_bom_quotes_commas_and_multiline_notes() {
        let rows = parse("\u{feff}name,url,username,password,note\r\n\"Demo, site\",https://example.invalid,test,\"a\"\"b,c\",\"line1\nline2\"\r\n".as_bytes()).unwrap();
        assert_eq!(rows[0].meta.name, "Demo, site");
        assert_eq!(&*rows[0].password, "a\"b,c");
        assert_eq!(rows[0].meta.note, "line1\nline2");
        assert_eq!(
            parse(b"url,username,password\nhttps://example.invalid,u,p\n")
                .unwrap()
                .len(),
            1
        );
    }
    #[test]
    fn malformed_or_invalid_import_rejects_all_without_echoing_secrets() {
        for text in [
            "name,url,password\nX,x,secret\n",
            "url,username,password,password\nx,u,secret,p\n",
            "url,username,password\nx,u,\n",
            "url,username,password\nx,u,secret,extra\n",
            "url,username,password\nx,u,secret,\n",
        ] {
            let error = parse(text.as_bytes()).err().unwrap();
            assert!(!error.contains("secret"));
        }
        assert!(parse(&[0xff]).is_err());
        assert!(parse(&vec![b'a'; 8 * 1024 * 1024 + 1]).is_err());
    }

    #[test]
    fn browser_columns_preserve_empty_users_long_urls_and_secret_whitespace() {
        let address = format!("http://example.invalid/login?return={}", "a".repeat(400));
        let note = "中文便笺".repeat(100);
        let mut writer = csv::Writer::from_writer(Vec::new());
        writer
            .write_record(["name", "url", "username", "password", "note"])
            .unwrap();
        writer
            .write_record([
                "演示账号",
                address.as_str(),
                "",
                "  fictional,\"密码\"  ",
                note.as_str(),
            ])
            .unwrap();
        let rows = parse(&writer.into_inner().unwrap()).unwrap();
        assert_eq!(rows[0].meta.user, "");
        assert_eq!(rows[0].meta.url, address);
        assert_eq!(rows[0].meta.note, note);
        assert_eq!(&*rows[0].password, "  fictional,\"密码\"  ");
    }

    #[test]
    fn detects_reordered_localized_headers_and_optional_trailing_note() {
        for text in [
            "password;username;url;name;note\nfictional;;https://example.invalid;示例\n",
            "sep=;\r\n密码;用户名;网址;名称;备注\r\nfictional;;http://example.invalid;示例;第一行\r\n",
            "sep=\t\npassword\tusername\turl\tnotes\nfictional\t0000123\thttps://example.invalid\t\n",
            "\u{feff} NAME , URL , USERNAME , PASSWORD , NOTES\r\n示例,https://example.invalid,0000123,fictional,\r\n,,,,\r\n",
        ] {
            let rows = parse(text.as_bytes()).unwrap();
            assert_eq!(rows.len(), 1);
            assert_eq!(&*rows[0].password, "fictional");
        }
        let rows =
            parse(b"url,username,password,note\nhttps://example.invalid,0000123,fictional\n")
                .unwrap();
        assert_eq!(rows[0].meta.user, "0000123");
        assert_eq!(rows[0].meta.note, "");
        assert!(parse(b"url,password,username\nhttps://example.invalid,fictional\n").is_err());
    }

    #[test]
    fn supports_explicit_utf16_without_lossy_encoding_guesses() {
        let sample = "名称\t网址\t用户名\t密码\t备注\r\n示例\thttps://example.invalid\t\t虚构密码😀\t中文\r\n";
        for little in [true, false] {
            let mut bytes = if little {
                vec![0xff, 0xfe]
            } else {
                vec![0xfe, 0xff]
            };
            for word in sample.encode_utf16() {
                bytes.extend(if little {
                    word.to_le_bytes()
                } else {
                    word.to_be_bytes()
                });
            }
            let rows = parse(&bytes).unwrap();
            assert_eq!(&*rows[0].password, "虚构密码😀");
            assert_eq!(rows[0].meta.note, "中文");
        }
        assert!(parse(&[0xff, 0xfe, 0]).is_err());
        assert!(parse(&[0xff, 0xfe, 0, 0xd8]).is_err());
        assert!(parse(b"PK\x03\x04fictional-workbook")
            .err()
            .unwrap()
            .contains("Excel"));
    }

    #[test]
    fn field_errors_identify_row_and_field_without_disclosing_values() {
        let sample = format!(
            "url,username,password,note\nhttps://example.invalid,,fictional-secret,{}\n",
            "x".repeat(16385)
        );
        let error = parse(sample.as_bytes()).err().unwrap();
        assert!(error.contains("第 1 条") && error.contains("备注"));
        assert!(!error.contains("fictional-secret") && !error.contains("example.invalid"));
    }
}
