//! Version 1 local vault. Header: magic/version (8), salt (16), nonce (24).
//! Fixed Argon2id parameters prevent attacker-controlled KDF resource use.
use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use zeroize::{Zeroize, Zeroizing};

const MAGIC: &[u8; 8] = b"LIMEV001";
const HEADER: usize = 48;
const MAX_FILE: usize = 8 * 1024 * 1024;
const MAX_ENTRIES: usize = 2000;
pub type Result<T> = std::result::Result<T, String>;

#[derive(Serialize)]
pub struct Strength {
    pub id: u32,
    pub score: u8,
}

// A bounded visual estimate, not entropy, breach detection or a safety verdict.
fn strength_score(password: &str) -> u8 {
    let length = password.chars().count();
    if length == 0 {
        return 0;
    }
    let unique = password.chars().collect::<HashSet<_>>().len();
    let kinds = [
        password.chars().any(|c| c.is_lowercase()),
        password.chars().any(|c| c.is_uppercase()),
        password.chars().any(|c| c.is_numeric()),
        password.chars().any(|c| !c.is_alphanumeric()),
    ]
    .into_iter()
    .filter(|present| *present)
    .count();
    let mut score = (length / 4 + kinds.saturating_sub(1)).clamp(1, 8) as u8;
    if length < 8 {
        score = score.min(2);
    }
    if unique < 5 || unique * 3 < length {
        score = score.min(2);
    }
    // Common sequences and dictionary samples should not appear as full fruit.
    let lower = Zeroizing::new(password.to_lowercase());
    if ["password", "qwerty", "123456", "abcdef", "letmein"]
        .iter()
        .any(|word| lower.contains(word))
    {
        score = score.min(2);
    }
    score
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Metadata {
    pub id: u32,
    pub name: String,
    pub user: String,
    pub category: String,
    pub icon: String,
    pub url: String,
    pub favorite: bool,
    pub note: String,
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CategoryChange {
    pub id: u32,
    pub from: String,
    pub category: String,
}
impl Drop for Metadata {
    fn drop(&mut self) {
        self.name.zeroize();
        self.user.zeroize();
        self.category.zeroize();
        self.icon.zeroize();
        self.url.zeroize();
        self.note.zeroize();
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Record {
    meta: Metadata,
    password: String,
}
impl Drop for Record {
    fn drop(&mut self) {
        self.password.zeroize();
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Data {
    next_id: u32,
    records: Vec<Record>,
    #[serde(default)]
    category_rules: HashMap<String, String>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    browser_preferences: HashMap<String, u32>,
}

pub struct Vault {
    path: PathBuf,
    key: Zeroizing<[u8; 32]>,
    salt: [u8; 16],
    data: Data,
    disk: Vec<u8>,
    undo: Option<(Record, usize, std::time::Instant)>,
}
fn derive(password: &str, salt: &[u8]) -> Result<Zeroizing<[u8; 32]>> {
    if password.is_empty() || password.len() > 1024 {
        return Err("主密码长度无效。".into());
    }
    let mut key = Zeroizing::new([0; 32]);
    let params = Params::new(65536, 3, 1, Some(32)).map_err(|_| "密钥参数错误。")?;
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), salt, key.as_mut())
        .map_err(|_| "密钥派生失败。")?;
    Ok(key)
}
fn random<const N: usize>() -> Result<[u8; N]> {
    let mut bytes = [0; N];
    OsRng
        .try_fill_bytes(&mut bytes)
        .map_err(|_| "系统随机数不可用。")?;
    Ok(bytes)
}
fn read_limited(path: &Path) -> Result<Vec<u8>> {
    let file = fs::File::open(path).map_err(|_| "无法读取密码库文件。")?;
    let mut bytes = Vec::new();
    file.take((MAX_FILE + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "密码库读取失败。")?;
    if bytes.len() > MAX_FILE {
        return Err("密码库文件超过 8 MiB 限制。".into());
    }
    Ok(bytes)
}
fn atomic_write(path: &Path, bytes: &[u8], create: bool) -> Result<()> {
    let parent = path.parent().ok_or("密码库路径无效。")?;
    fs::create_dir_all(parent).map_err(|_| "无法创建密码库目录。")?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|_| "无法创建加密临时文件。")?;
    temp.write_all(bytes)
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|_| "密码库写入失败，原文件未修改。")?;
    if create {
        temp.persist_noclobber(path)
            .map_err(|_| "密码库已存在或无法创建，未覆盖原文件。")?;
    } else {
        temp.persist(path)
            .map_err(|_| "无法替换密码库，原文件仍保留。")?;
    }
    Ok(())
}
pub(crate) fn validate(meta: &Metadata, password: Option<&str>) -> Result<()> {
    if meta.name.trim().is_empty()
        || meta.icon.chars().count() > 8
        || !valid_category(&meta.category)
    {
        return Err("账号字段无效或超出长度限制。".into());
    }
    for (label, value, limit) in [
        ("名称", meta.name.as_str(), 8192),
        ("用户名", meta.user.as_str(), 1024),
        ("网址", meta.url.as_str(), 8192),
        ("备注", meta.note.as_str(), 16384),
    ] {
        if value.chars().count() > limit {
            return Err(format!("{label}超过 {limit} 字符限制。"));
        }
    }
    if let Some(password) = password {
        if password.is_empty() || password.len() > 4096 {
            return Err("账号密码应为 1–4096 字节。".into());
        }
    }
    Ok(())
}
pub(crate) fn valid_category(value: &str) -> bool {
    !value.trim().is_empty()
        && value == value.trim()
        && value.chars().count() <= 24
        && !value.chars().any(char::is_control)
}

pub(crate) fn site_key(value: &str) -> String {
    let value = value.trim();
    let candidate = if value.contains("://") {
        value.to_string()
    } else {
        format!("https://{value}")
    };
    if let Ok(url) = url::Url::parse(&candidate) {
        if matches!(url.scheme(), "http" | "https") {
            if let Some(host) = url.host_str() {
                return host.trim_start_matches("www.").to_lowercase();
            }
        }
    }
    value.to_lowercase()
}
impl Vault {
    pub fn prepare_password_change(path: PathBuf, old: &str, new: &str) -> Result<Self> {
        if new.chars().count() < 12 || new.len() > 1024 {
            return Err("新主密码至少 12 个字符，最多 1024 字节。".into());
        }
        if old == new {
            return Err("新主密码不能与当前主密码相同。".into());
        }
        let mut candidate = Self::open(path, old)?;
        candidate.salt = random()?;
        candidate.key = derive(new, &candidate.salt)?;
        Ok(candidate)
    }
    pub fn apply_password_change(&mut self, mut candidate: Self) -> Result<()> {
        if candidate.path != self.path
            || candidate.disk != self.disk
            || read_limited(&self.path)? != self.disk
        {
            return Err("密码库已变化，请重新验证主密码。".into());
        }
        let bytes = candidate.encrypt(&candidate.data)?;
        atomic_write(&self.path.with_extension("lime.bak"), &self.disk, false)?;
        atomic_write(&self.path, &bytes, false)?;
        candidate.disk = bytes;
        *self = candidate;
        Ok(())
    }
    pub fn export(&self, path: &Path) -> Result<()> {
        if read_limited(&self.path)? != self.disk {
            return Err("磁盘密码库已变化，请重新解锁后导出。".into());
        }
        // Never overwrite an existing file, including the live vault or backup.
        atomic_write(path, &self.disk, true)
    }
    pub fn import_new(mut source: Self, path: PathBuf) -> Result<Self> {
        atomic_write(&path, &source.disk, true)?;
        source.path = path;
        source.undo = None;
        Ok(source)
    }
    pub fn merge(&mut self, source: &Self) -> Result<usize> {
        if self.data.records.len() + source.data.records.len() > MAX_ENTRIES {
            return Err("导入后超过 2000 条记录上限。".into());
        }
        let mut next = self.data.clone();
        for record in &source.data.records {
            if next.next_id >= i32::MAX as u32 {
                return Err("账号编号达到上限。".into());
            }
            let mut added = record.clone();
            added.meta.id = next.next_id;
            next.next_id += 1;
            next.records.push(added);
        }
        self.commit(next)?;
        self.undo = None;
        Ok(source.data.records.len())
    }
    #[cfg(test)]
    pub fn restore(path: PathBuf, password: &str) -> Result<Self> {
        Self::prepare_restore(path, password)?.commit_restore()
    }
    pub fn prepare_restore(path: PathBuf, password: &str) -> Result<Self> {
        let mut backup = Self::open(path.with_extension("lime.bak"), password)?;
        backup.path = path;
        Ok(backup)
    }
    pub fn commit_restore(self) -> Result<Self> {
        let path = self.path.clone();
        let exists = path.try_exists().map_err(|_| "无法检查密码库路径。")?;
        if exists {
            let previous = read_limited(&path)?;
            let suffix = random::<8>()?
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>();
            let archive = path.with_extension(format!("before-restore-{suffix}.lime"));
            atomic_write(&archive, &previous, true)?;
        }
        atomic_write(&path, &self.disk, !exists)?;
        Ok(self)
    }
    #[cfg(test)]
    pub fn create(path: PathBuf, password: &str) -> Result<Self> {
        Self::prepare_create(path, password)?.commit_create()
    }
    pub fn prepare_create(path: PathBuf, password: &str) -> Result<Self> {
        if password.chars().count() < 12 {
            return Err("主密码至少需要 12 个字符。".into());
        }
        if path.try_exists().map_err(|_| "无法检查密码库路径。")? {
            return Err("密码库已存在，不可覆盖。".into());
        }
        let salt = random()?;
        let key = derive(password, &salt)?;
        let mut vault = Self {
            path,
            key,
            salt,
            data: Data {
                next_id: 1,
                records: vec![],
                category_rules: HashMap::new(),
                browser_preferences: HashMap::new(),
            },
            disk: vec![],
            undo: None,
        };
        let bytes = vault.encrypt(&vault.data)?;
        vault.disk = bytes;
        Ok(vault)
    }
    pub fn commit_create(self) -> Result<Self> {
        atomic_write(&self.path, &self.disk, true)?;
        Ok(self)
    }
    pub fn open(path: PathBuf, password: &str) -> Result<Self> {
        let bytes = read_limited(&path)?;
        if bytes.len() < HEADER + 16 || &bytes[..8] != MAGIC {
            return Err("密码库格式不支持或文件已损坏。".into());
        }
        let salt: [u8; 16] = bytes[8..24].try_into().map_err(|_| "密码库头部损坏。")?;
        let key = derive(password, &salt)?;
        let cipher = XChaCha20Poly1305::new_from_slice(key.as_ref()).map_err(|_| "密钥无效。")?;
        let plain = Zeroizing::new(
            cipher
                .decrypt(
                    XNonce::from_slice(&bytes[24..48]),
                    Payload {
                        msg: &bytes[HEADER..],
                        aad: &bytes[..HEADER],
                    },
                )
                .map_err(|_| "主密码错误，或密码库已损坏。")?,
        );
        let data: Data = serde_json::from_slice(&plain).map_err(|_| "密码库内容格式无效。")?;
        if data.records.len() > MAX_ENTRIES || data.next_id == 0 || data.next_id > i32::MAX as u32 {
            return Err("密码库记录数量或编号无效。".into());
        }
        if data.category_rules.iter().any(|(site, category)| {
            site.is_empty() || site.len() > 32768 || !valid_category(category)
        }) {
            return Err("密码库分类规则无效。".into());
        }
        if data.browser_preferences.len() > MAX_ENTRIES
            || data
                .browser_preferences
                .iter()
                .any(|(page, id)| page.len() > 8192 || *id == 0)
        {
            return Err("密码库网站偏好无效。".into());
        }
        let mut ids = HashSet::new();
        for record in &data.records {
            validate(&record.meta, Some(&record.password))?;
            if record.meta.id == 0 || record.meta.id >= data.next_id || !ids.insert(record.meta.id)
            {
                return Err("密码库记录编号无效。".into());
            }
        }
        Ok(Self {
            path,
            key,
            salt,
            data,
            disk: bytes,
            undo: None,
        })
    }
    fn encrypt(&self, data: &Data) -> Result<Vec<u8>> {
        let plain = Zeroizing::new(serde_json::to_vec(data).map_err(|_| "无法编码密码库。")?);
        if plain.len() + HEADER + 16 > MAX_FILE {
            return Err("密码库已达到大小限制。".into());
        }
        let mut header = Vec::from(MAGIC.as_slice());
        header.extend(self.salt);
        header.extend(random::<24>()?);
        let cipher =
            XChaCha20Poly1305::new_from_slice(self.key.as_ref()).map_err(|_| "密钥无效。")?;
        let encrypted = cipher
            .encrypt(
                XNonce::from_slice(&header[24..48]),
                Payload {
                    msg: &plain,
                    aad: &header,
                },
            )
            .map_err(|_| "密码库加密失败。")?;
        header.extend(encrypted);
        Ok(header)
    }
    fn commit(&mut self, data: Data) -> Result<()> {
        if read_limited(&self.path)? != self.disk {
            return Err("磁盘密码库已被其他操作修改，请锁定后重新解锁。".into());
        }
        let bytes = self.encrypt(&data)?;
        // The backup is the previous encrypted revision, never plaintext.
        atomic_write(&self.path.with_extension("lime.bak"), &self.disk, false)?;
        atomic_write(&self.path, &bytes, false)?;
        self.disk = bytes;
        self.data = data;
        Ok(())
    }
    pub fn csv_counts(&self, rows: &[crate::browser_csv::CsvEntry]) -> (usize, usize) {
        let mut seen: HashSet<(&str, &str, &str)> = self
            .data
            .records
            .iter()
            .map(|r| {
                (
                    r.meta.url.as_str(),
                    r.meta.user.as_str(),
                    r.password.as_str(),
                )
            })
            .collect();
        let added = rows
            .iter()
            .filter(|r| seen.insert((&r.meta.url, &r.meta.user, &r.password)))
            .count();
        (added, rows.len() - added)
    }
    pub fn import_csv(&mut self, rows: &[crate::browser_csv::CsvEntry]) -> Result<(usize, usize)> {
        let (added, skipped) = self.csv_counts(rows);
        if self.data.records.len() + added > MAX_ENTRIES
            || u64::from(self.data.next_id) + added as u64 >= i32::MAX as u64
        {
            return Err("导入后超过密码库记录上限。".into());
        }
        let mut next = self.data.clone();
        for row in rows {
            validate(&row.meta, Some(&row.password))?;
            if next.records.iter().any(|r| {
                r.meta.url == row.meta.url
                    && r.meta.user == row.meta.user
                    && r.password == *row.password
            }) {
                continue;
            }
            let mut meta = row.meta.clone();
            meta.id = next.next_id;
            next.next_id += 1;
            next.records.push(Record {
                meta,
                password: row.password.to_string(),
            });
        }
        if added > 0 {
            self.commit(next)?;
            self.undo = None;
        }
        Ok((added, skipped))
    }
    pub fn list(&self) -> Vec<Metadata> {
        self.data
            .records
            .iter()
            .map(|record| record.meta.clone())
            .collect()
    }
    pub fn category_rules(&self) -> HashMap<String, String> {
        self.data.category_rules.clone()
    }
    pub fn categorize(&mut self, ids: &[u32], category: &str) -> Result<()> {
        if ids.is_empty() || ids.len() > MAX_ENTRIES || !valid_category(category) {
            return Err("请选择账号，并填写 1–24 字的分类。".into());
        }
        let mut next = self.data.clone();
        for id in ids {
            let record = next
                .records
                .iter_mut()
                .find(|r| r.meta.id == *id)
                .ok_or("账号已变化，请刷新后重试。")?;
            record.meta.category = category.to_string();
            let key = site_key(&record.meta.url);
            if !key.is_empty() {
                next.category_rules.insert(key, category.to_string());
            }
        }
        self.commit(next)?;
        self.undo = None;
        Ok(())
    }
    pub fn regroup(&mut self, changes: &[CategoryChange], remember: bool) -> Result<()> {
        if changes.is_empty() || changes.len() > MAX_ENTRIES {
            return Err("请选择需要更换分组的账号。".into());
        }
        let mut seen = HashSet::new();
        let mut next = self.data.clone();
        let mut learned = HashMap::new();
        for change in changes {
            if !valid_category(&change.category) || !seen.insert(change.id) {
                return Err("分组无效或账号重复。".into());
            }
            let record = next
                .records
                .iter_mut()
                .find(|r| r.meta.id == change.id)
                .ok_or("账号已变化，请重新预览。")?;
            if record.meta.category != change.from {
                return Err("分组已被其他操作修改，请重新预览。".into());
            }
            let key = site_key(&record.meta.url);
            if remember && !key.is_empty() {
                if learned.get(&key).is_some_and(|old| old != &change.category) {
                    return Err("同一网站选择了不同分组，请取消记住规则后重试。".into());
                }
                learned.insert(key.clone(), change.category.clone());
            }
            // A corrected grouping must not leave its previously learned mistake active.
            if change.from != change.category && next.category_rules.get(&key) == Some(&change.from)
            {
                next.category_rules.remove(&key);
            }
            record.meta.category = change.category.clone();
        }
        next.category_rules.extend(learned);
        self.commit(next)?;
        self.undo = None;
        Ok(())
    }
    pub fn quick_save(
        &mut self,
        mut meta: Metadata,
        password: &str,
        update_id: Option<u32>,
        separate: bool,
    ) -> Result<()> {
        let matches: Vec<_> = self
            .list()
            .into_iter()
            .filter(|e| site_key(&e.url) == site_key(&meta.url) && e.user == meta.user)
            .collect();
        if let Some(id) = update_id {
            // Update only the password: never overwrite metadata from a stale floating snapshot.
            meta = matches
                .into_iter()
                .find(|e| e.id == id)
                .ok_or("账号已变化，请重新打开保存面板。")?;
        } else {
            if !matches.is_empty() && !separate {
                return Err("已有相同网站和账号，请选择更新或另存。".into());
            }
            meta.id = 0;
        }
        self.upsert(meta, Some(password))?;
        Ok(())
    }
    pub fn strengths(&self) -> Vec<Strength> {
        self.data
            .records
            .iter()
            .map(|record| Strength {
                id: record.meta.id,
                score: strength_score(&record.password),
            })
            .collect()
    }
    pub fn secret(&self, id: u32) -> Result<Zeroizing<String>> {
        self.data
            .records
            .iter()
            .find(|record| record.meta.id == id)
            .map(|record| Zeroizing::new(record.password.clone()))
            .ok_or("账号不存在。".into())
    }
    pub fn browser_preference(&self, page: &str) -> Option<u32> {
        self.data.browser_preferences.get(page).copied()
    }
    pub fn remember_browser_account(&mut self, page: &str, id: u32) -> Result<()> {
        if self.browser_preference(page) == Some(id) {
            return Ok(());
        }
        let mut next = self.data.clone();
        if next.browser_preferences.len() >= MAX_ENTRIES {
            next.browser_preferences.clear();
        }
        next.browser_preferences.insert(page.into(), id);
        self.commit(next)
    }
    pub fn upsert(&mut self, mut meta: Metadata, password: Option<&str>) -> Result<Metadata> {
        validate(&meta, password)?;
        let mut next = self.data.clone();
        let key = site_key(&meta.url);
        let category_changed = meta.id == 0
            || self
                .data
                .records
                .iter()
                .any(|r| r.meta.id == meta.id && r.meta.category != meta.category);
        if !key.is_empty() && meta.category != "未分类" && category_changed {
            next.category_rules.insert(key, meta.category.clone());
        }
        if meta.id == 0 {
            if next.records.len() >= MAX_ENTRIES || next.next_id >= i32::MAX as u32 {
                return Err("密码库已达到记录上限。".into());
            }
            let password = password.ok_or("新账号需要密码。")?;
            meta.id = next.next_id;
            next.next_id += 1;
            next.records.push(Record {
                meta: meta.clone(),
                password: password.into(),
            });
        } else {
            let record = next
                .records
                .iter_mut()
                .find(|record| record.meta.id == meta.id)
                .ok_or("账号不存在。")?;
            record.meta = meta.clone();
            if let Some(password) = password {
                record.password.zeroize();
                record.password = password.into();
            }
        }
        self.commit(next)?;
        Ok(meta)
    }
    pub fn delete(&mut self, id: u32) -> Result<()> {
        let mut next = self.data.clone();
        let index = next
            .records
            .iter()
            .position(|record| record.meta.id == id)
            .ok_or("账号不存在。")?;
        let record = next.records.remove(index);
        self.commit(next)?;
        self.undo = Some((
            record,
            index,
            std::time::Instant::now() + std::time::Duration::from_secs(10),
        ));
        Ok(())
    }
    pub fn expire_undo(&mut self) {
        if self
            .undo
            .as_ref()
            .is_some_and(|item| std::time::Instant::now() >= item.2)
        {
            self.undo = None;
        }
    }
    pub fn undo(&mut self) -> Result<()> {
        self.expire_undo();
        let (record, index, _) = self.undo.as_ref().ok_or("撤销时间已过。")?;
        let mut next = self.data.clone();
        next.records
            .insert((*index).min(next.records.len()), record.clone());
        self.commit(next)?;
        self.undo = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strength_score_is_bounded_and_never_exposes_password_content() {
        assert_eq!(strength_score(""), 0);
        assert!(strength_score("123456") <= 2);
        assert!(strength_score("password-123") <= 2);
        assert!(strength_score("X7!kP2#vN9@q") >= 6);
        assert!(strength_score("这是一个很长的中文密码🙂安全") <= 8);
    }
    fn meta() -> Metadata {
        Metadata {
            id: 0,
            name: "私密站点".into(),
            user: "private-user".into(),
            category: "工作".into(),
            icon: "L".into(),
            url: "secret.invalid".into(),
            favorite: true,
            note: "private note".into(),
        }
    }
    #[test]
    fn csv_import_deduplicates_reassigns_ids_and_commits_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("csv-vault.lime");
        let mut vault = Vault::create(path.clone(), "fictional-master-only").unwrap();
        let rows = crate::browser_csv::parse(b"name,url,username,password\nSite,https://example.invalid,u,p\nSite,https://example.invalid,u,p\nSite,https://example.invalid,u,new-password\n").unwrap();
        assert_eq!(vault.csv_counts(&rows), (2, 1));
        assert_eq!(vault.import_csv(&rows).unwrap(), (2, 1));
        assert_eq!(
            vault.list().iter().map(|e| e.id).collect::<Vec<_>>(),
            vec![1, 2]
        );
        assert_eq!(
            Vault::open(path.clone(), "fictional-master-only")
                .unwrap()
                .list()
                .len(),
            2
        );
        assert_eq!(vault.import_csv(&rows).unwrap(), (0, 3));
        let original = std::fs::read(&path).unwrap();
        std::fs::write(&path, b"externally changed").unwrap();
        let more = crate::browser_csv::parse(
            b"url,username,password\nhttps://new.invalid,new-user,test\n",
        )
        .unwrap();
        assert!(vault.import_csv(&more).is_err());
        assert_eq!(vault.list().len(), 2);
        assert_eq!(std::fs::read(&path).unwrap(), b"externally changed");
        assert!(!original.windows(12).any(|w| w == b"new-password"));
    }
    #[test]
    fn categories_and_quick_save_preserve_secrets_and_commit_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("categories.lime");
        let master = "fictional-master-only";
        let mut vault = Vault::create(path.clone(), master).unwrap();
        let first = vault.upsert(meta(), Some("fictional-original")).unwrap();
        let mut other = meta();
        other.url = "https://other.invalid".into();
        let second = vault.upsert(other, Some("fictional-other")).unwrap();
        let bytes = fs::read(&path).unwrap();
        assert!(vault.categorize(&[first.id, 9999], "自定义").is_err());
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(vault.list()[0].category, "工作");
        vault
            .categorize(&[first.id, second.id], "个人项目")
            .unwrap();
        assert_eq!(
            vault.secret(first.id).unwrap().as_str(),
            "fictional-original"
        );
        assert_eq!(vault.category_rules()["secret.invalid"], "个人项目");
        assert!(vault
            .quick_save(meta(), "fictional-new", None, false)
            .is_err());
        assert!(vault
            .quick_save(meta(), "fictional-new", Some(second.id), false)
            .is_err());
        vault
            .quick_save(meta(), "fictional-new", Some(first.id), false)
            .unwrap();
        assert_eq!(vault.list()[0].category, "个人项目");
        assert_eq!(vault.list()[0].note, "private note");
        assert_eq!(vault.secret(first.id).unwrap().as_str(), "fictional-new");
        vault
            .quick_save(meta(), "fictional-separate", None, true)
            .unwrap();
        assert_eq!(vault.list().len(), 3);
        let reopened = Vault::open(path.clone(), master).unwrap();
        assert_eq!(reopened.list()[0].category, "个人项目");
        assert_eq!(reopened.category_rules()["other.invalid"], "个人项目");
        let before = fs::read(&path).unwrap();
        for invalid in ["", "  ", " padded", "line\nbreak"] {
            assert!(vault.categorize(&[first.id], invalid).is_err());
        }
        assert_eq!(fs::read(&path).unwrap(), before);
        fs::write(&path, b"external change").unwrap();
        assert!(vault.categorize(&[first.id, second.id], "学习").is_err());
        assert_eq!(vault.list()[0].category, "个人项目");
        assert_eq!(vault.category_rules()["other.invalid"], "个人项目");
    }
    #[test]
    fn legacy_data_defaults_category_rules_without_reclassifying_records() {
        let value = serde_json::json!({ "next_id": 2, "records": [{ "meta": meta(), "password": "fictional-only" }] });
        let data: Data = serde_json::from_value(value).unwrap();
        assert!(data.category_rules.is_empty());
        assert_eq!(data.records[0].meta.category, "工作");
        assert_eq!(
            site_key("HTTPS://WWW.Example.invalid/login?q=1"),
            "example.invalid"
        );
        assert_eq!(site_key("Steam"), "steam");
    }
    #[test]
    fn mixed_regroup_is_atomic_and_clears_only_obsolete_rules() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("regroup.lime");
        let master = "fictional-master-only";
        let mut vault = Vault::create(path.clone(), master).unwrap();
        let first = vault.upsert(meta(), Some("fictional-one")).unwrap();
        let mut second_meta = meta();
        second_meta.url = "https://second.invalid".into();
        let second = vault.upsert(second_meta, Some("fictional-two")).unwrap();
        let changes = || {
            vec![
                CategoryChange {
                    id: first.id,
                    from: "工作".into(),
                    category: "游戏".into(),
                },
                CategoryChange {
                    id: second.id,
                    from: "工作".into(),
                    category: "学习".into(),
                },
            ]
        };
        let before = fs::read(&path).unwrap();
        let mut bad = changes();
        bad[1].from = "生活".into();
        assert!(vault.regroup(&bad, false).is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        assert_eq!(vault.list()[0].category, "工作");
        vault.regroup(&changes(), false).unwrap();
        assert!(!vault.category_rules().contains_key("secret.invalid"));
        assert!(!vault.category_rules().contains_key("second.invalid"));
        assert_eq!(vault.secret(first.id).unwrap().as_str(), "fictional-one");
        assert_eq!(vault.list()[0].note, "private note");
        assert!(vault.list()[0].favorite);
        assert!(vault.regroup(&changes(), false).is_err());
        let next = [CategoryChange {
            id: first.id,
            from: "游戏".into(),
            category: "个人项目".into(),
        }];
        vault.regroup(&next, true).unwrap();
        let reopened = Vault::open(path.clone(), master).unwrap();
        assert_eq!(reopened.list()[1].category, "学习");
        assert_eq!(reopened.category_rules()["secret.invalid"], "个人项目");
        fs::write(&path, b"external-change").unwrap();
        assert!(vault
            .regroup(
                &[CategoryChange {
                    id: first.id,
                    from: "个人项目".into(),
                    category: "娱乐".into()
                }],
                true
            )
            .is_err());
        assert_eq!(vault.list()[0].category, "个人项目");
        assert_eq!(vault.category_rules()["secret.invalid"], "个人项目");
    }
    #[test]
    fn browser_optional_users_and_long_fields_survive_encryption_and_editing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("browser-compatibility.lime");
        let master = "fictional-master-only";
        let mut vault = Vault::create(path.clone(), master).unwrap();
        let address = format!("http://example.invalid/login?return={}", "x".repeat(400));
        let note = "测试备注".repeat(200);
        let mut writer = csv::Writer::from_writer(Vec::new());
        writer
            .write_record(["name", "url", "username", "password", "note"])
            .unwrap();
        writer
            .write_record(["测试导入", &address, "", " fictional-password ", &note])
            .unwrap();
        let rows = crate::browser_csv::parse(&writer.into_inner().unwrap()).unwrap();
        assert_eq!(vault.import_csv(&rows).unwrap(), (1, 0));
        drop(vault);
        let mut reopened = Vault::open(path, master).unwrap();
        let entry = reopened.list().remove(0);
        assert!(entry.user.is_empty());
        assert_eq!(entry.url, address);
        assert_eq!(entry.note, note);
        assert_eq!(&*reopened.secret(entry.id).unwrap(), " fictional-password ");
        reopened.upsert(entry, None).unwrap();
        assert_eq!(reopened.import_csv(&rows).unwrap(), (0, 1));
    }
    #[test]
    fn encrypted_lifecycle_and_recovery() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("vault.lime");
        let master = "test-master-password-only";
        let mut vault = Vault::create(path.clone(), master).unwrap();
        let first = vault.upsert(meta(), Some("private-password-测试")).unwrap();
        let original = fs::read(&path).unwrap();
        for text in [
            "private-user",
            "private-password",
            "secret.invalid",
            "private note",
            master,
        ] {
            assert!(!original
                .windows(text.len())
                .any(|part| part == text.as_bytes()));
        }
        assert!(Vault::create(path.clone(), master).is_err());
        assert!(Vault::open(path.clone(), "wrong-password").is_err());
        drop(vault);
        let mut vault = Vault::open(path.clone(), master).unwrap();
        assert_eq!(
            vault.secret(first.id).unwrap().as_str(),
            "private-password-测试"
        );
        let mut edited = first.clone();
        edited.name = "Edited".into();
        vault.upsert(edited, None).unwrap();
        assert_ne!(original, fs::read(&path).unwrap());
        let backup = Vault::open(path.with_extension("lime.bak"), master).unwrap();
        assert_eq!(backup.list()[0].name, "私密站点");
        vault.delete(first.id).unwrap();
        assert!(vault.list().is_empty());
        vault.undo().unwrap();
        assert_eq!(vault.list().len(), 1);
        assert_eq!(
            vault.secret(first.id).unwrap().as_str(),
            "private-password-测试"
        );
        let bytes = fs::read(&path).unwrap();
        for index in [0, 8, 24, 48, bytes.len() - 1] {
            let mut bad = bytes.clone();
            bad[index] ^= 1;
            fs::write(&path, &bad).unwrap();
            assert!(Vault::open(path.clone(), master).is_err());
        }
        fs::write(&path, &bytes[..30]).unwrap();
        assert!(Vault::open(path.clone(), master).is_err());
        assert!(vault.upsert(meta(), Some("never-written")).is_err());
        assert_eq!(vault.list().len(), 1);
        let damaged = fs::read(&path).unwrap();
        assert!(Vault::restore(path.clone(), "wrong-password").is_err());
        assert_eq!(fs::read(&path).unwrap(), damaged);
        let recovered = Vault::restore(path.clone(), master).unwrap();
        // Undo's previous revision was empty; recovery restores that exact version.
        assert!(recovered.list().is_empty());
        let archived = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|item| item.ok())
            .find(|item| {
                item.file_name()
                    .to_string_lossy()
                    .contains("before-restore")
            })
            .unwrap();
        assert_eq!(fs::read(archived.path()).unwrap(), damaged);
    }
    #[test]
    fn failed_commit_preserves_memory_and_original() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("vault.lime");
        let mut vault = Vault::create(path.clone(), "test-master-password-only").unwrap();
        let before = fs::read(&path).unwrap();
        fs::create_dir(path.with_extension("lime.bak")).unwrap();
        assert!(vault.upsert(meta(), Some("not-saved")).is_err());
        assert!(vault.list().is_empty());
        assert_eq!(before, fs::read(path).unwrap());
    }

    #[test]
    fn oversized_and_unknown_formats_are_rejected_before_key_derivation() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("vault.lime");
        let file = fs::File::create(&path).unwrap();
        file.set_len((MAX_FILE + 1) as u64).unwrap();
        assert!(Vault::open(path.clone(), "test-password")
            .err()
            .unwrap()
            .contains("8 MiB"));
        fs::write(
            &path,
            b"LIMEV999abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdef",
        )
        .unwrap();
        assert!(Vault::open(path, "test-password")
            .err()
            .unwrap()
            .contains("格式"));
    }

    #[test]
    fn password_rotation_export_import_full_lifecycle() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("vault.lime");
        let old = "test-old-master-password";
        let new = "test-new-master-password";
        let mut vault = Vault::create(path.clone(), old).unwrap();
        let row = vault.upsert(meta(), Some("account-secret-测试")).unwrap();
        let export = dir.path().join("export.lime");
        vault.export(&export).unwrap();
        let bytes = fs::read(&path).unwrap();
        assert_eq!(fs::read(&export).unwrap(), bytes);
        assert!(vault.export(&export).is_err());
        assert!(vault.export(&path).is_err());
        assert!(Vault::prepare_password_change(path.clone(), "wrong-old-password", new).is_err());
        assert_eq!(fs::read(&path).unwrap(), bytes);
        let candidate = Vault::prepare_password_change(path.clone(), old, new).unwrap();
        vault.apply_password_change(candidate).unwrap();
        assert!(Vault::open(path.clone(), old).is_err());
        let reopened = Vault::open(path.clone(), new).unwrap();
        assert_eq!(
            reopened.secret(row.id).unwrap().as_str(),
            "account-secret-测试"
        );
        assert!(Vault::open(export.clone(), new).is_err());
        let source = Vault::open(export, old).unwrap();
        assert!(Vault::open(path.with_extension("lime.bak"), old).is_ok());
        vault.merge(&source).unwrap();
        assert_eq!(vault.list().len(), 2);
        assert_ne!(vault.list()[0].id, vault.list()[1].id);
        assert_eq!(
            vault.secret(vault.list()[1].id).unwrap().as_str(),
            "account-secret-测试"
        );
        assert!(Vault::open(path.clone(), new).is_ok());
        let imported_path = dir.path().join("new-device.lime");
        Vault::import_new(source, imported_path.clone()).unwrap();
        assert!(Vault::open(imported_path, old).is_ok());
    }

    #[test]
    fn rotation_detects_concurrent_edits_and_failed_write_preserves_old_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("vault.lime");
        let old = "test-old-master-password";
        let new = "test-new-master-password";
        let mut vault = Vault::create(path.clone(), old).unwrap();
        let stale = Vault::prepare_password_change(path.clone(), old, new).unwrap();
        vault.upsert(meta(), Some("account-secret")).unwrap();
        assert!(vault.apply_password_change(stale).is_err());
        let candidate = Vault::prepare_password_change(path.clone(), old, new).unwrap();
        let bytes = fs::read(&path).unwrap();
        fs::remove_file(path.with_extension("lime.bak")).unwrap();
        fs::create_dir(path.with_extension("lime.bak")).unwrap();
        assert!(vault.apply_password_change(candidate).is_err());
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(vault.list().len(), 1);
        assert!(Vault::open(path, old).is_ok());
    }
}
