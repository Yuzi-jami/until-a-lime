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
    let text = std::str::from_utf8(bytes)
        .map_err(|_| "请使用浏览器导出的 UTF-8 CSV 文件。")?
        .trim_start_matches('\u{feff}');
    let mut reader = csv::ReaderBuilder::new().from_reader(text.as_bytes());
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
    let url = column(&["url", "网址"], true)?.unwrap();
    let user = column(&["username", "用户名"], true)?.unwrap();
    let password = column(&["password", "密码"], true)?.unwrap();
    let name = column(&["name", "名称"], false)?;
    let note = column(&["note", "notes", "备注"], false)?;
    let mut rows = Vec::new();
    for (index, row) in reader.records().enumerate() {
        if index >= 2000 {
            return Err("CSV 超过 2000 条记录限制。".into());
        }
        let row =
            row.map_err(|_| format!("CSV 第 {} 条记录格式无效，未导入任何账号。", index + 1))?;
        let address = row.get(url).unwrap_or("");
        let title = name
            .and_then(|i| row.get(i))
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(address);
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
        crate::vault::validate(&meta, Some(&secret)).map_err(|_| {
            format!(
                "CSV 第 {} 条记录为空或超出字段长度限制，未导入任何账号。",
                index + 1
            )
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
            "url,username,password\nx,,secret\n",
            "url,username,password\nx,u,secret,extra\n",
        ] {
            let error = parse(text.as_bytes()).err().unwrap();
            assert!(!error.contains("secret"));
        }
        assert!(parse(&[0xff]).is_err());
        assert!(parse(&vec![b'a'; 8 * 1024 * 1024 + 1]).is_err());
    }
}
