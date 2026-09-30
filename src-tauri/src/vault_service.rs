use crate::{
    clipboard::ClipboardService,
    vault::{Metadata, Vault},
};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime},
};
use tauri::{Emitter, Manager};
use zeroize::Zeroizing;

struct State {
    vault: Option<Vault>,
    epoch: u64,
    busy: bool,
    last: SystemTime,
    minutes: u32,
    csv_import: Option<(
        String,
        Vec<crate::browser_csv::CsvEntry>,
        std::time::Instant,
    )>,
    import_file: Option<(String, PathBuf, std::time::Instant)>,
}
#[derive(Clone)]
pub struct VaultService {
    path: PathBuf,
    state: Arc<Mutex<State>>,
}
#[derive(serde::Serialize)]
pub struct Status {
    exists: bool,
    locked: bool,
    backup: bool,
}
impl VaultService {
    pub(crate) fn floating_entries(&self) -> Result<Vec<Metadata>, String> {
        self.access(|vault| Ok(vault.list()))
    }

    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            state: Arc::new(Mutex::new(State {
                vault: None,
                epoch: 0,
                busy: false,
                last: SystemTime::now(),
                minutes: 5,
                import_file: None,
                csv_import: None,
            })),
        }
    }
    pub fn lock(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.vault = None;
            state.import_file = None;
            state.csv_import = None;
            state.epoch = state.epoch.wrapping_add(1);
        }
    }
    fn expired(state: &State) -> bool {
        state.vault.is_some()
            && state.minutes != 0
            && state.last.elapsed().map_or(true, |elapsed| {
                elapsed >= Duration::from_secs(u64::from(state.minutes) * 60)
            })
    }
    pub fn check(&self) -> bool {
        let Ok(mut state) = self.state.lock() else {
            return true;
        };
        if state
            .csv_import
            .as_ref()
            .is_some_and(|v| std::time::Instant::now() >= v.2)
        {
            state.csv_import = None;
        }
        if let Some(vault) = state.vault.as_mut() {
            vault.expire_undo();
        }
        if Self::expired(&state) {
            state.vault = None;
            state.import_file = None;
            state.csv_import = None;
            state.epoch = state.epoch.wrapping_add(1);
            return true;
        }
        false
    }
    pub(crate) fn access<T>(
        &self,
        operation: impl FnOnce(&mut Vault) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut state = self.state.lock().map_err(|_| "密码库服务不可用。")?;
        if state.busy {
            return Err("密码库正在处理其他操作，请稍候。".into());
        }
        if Self::expired(&state) {
            state.vault = None;
            state.import_file = None;
            state.csv_import = None;
            state.epoch = state.epoch.wrapping_add(1);
        }
        let vault = state.vault.as_mut().ok_or("密码库已锁定。")?;
        let result = operation(vault);
        state.last = SystemTime::now();
        result
    }
    fn authenticate(
        &self,
        password: Zeroizing<String>,
        create: bool,
        restore: bool,
    ) -> Result<Vec<Metadata>, String> {
        let epoch = {
            let mut state = self.state.lock().map_err(|_| "密码库服务不可用。")?;
            if state.busy {
                return Err("正在处理主密码，请稍候。".into());
            }
            if state.vault.is_some() {
                return Err("密码库已经解锁。".into());
            }
            state.busy = true;
            state.epoch
        };
        let result = if restore {
            Vault::prepare_restore(self.path.clone(), &password)
        } else if create {
            Vault::prepare_create(self.path.clone(), &password)
        } else {
            Vault::open(self.path.clone(), &password)
        };
        let mut state = self.state.lock().map_err(|_| "密码库服务不可用。")?;
        state.busy = false;
        if state.epoch != epoch {
            return Err("解锁已取消，请重试。".into());
        }
        let prepared = result?;
        let vault = if restore {
            prepared.commit_restore()?
        } else if create {
            prepared.commit_create()?
        } else {
            prepared
        };
        let entries = vault.list();
        state.vault = Some(vault);
        state.last = SystemTime::now();
        Ok(entries)
    }
}

impl VaultService {
    pub(crate) fn floating_epoch(&self, id: u32) -> Result<u64, String> {
        let state = self.state.lock().map_err(|_| "密码库服务不可用。")?;
        if state.busy || Self::expired(&state) {
            return Err("请先验证密码库。".into());
        }
        let vault = state.vault.as_ref().ok_or("请先验证密码库。")?;
        if !vault.list().iter().any(|e| e.id == id) {
            return Err("账号不存在。".into());
        }
        Ok(state.epoch)
    }
    pub(crate) fn with_floating_field<T>(
        &self,
        epoch: u64,
        id: u32,
        field: &str,
        action: impl FnOnce(&str) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut state = self.state.lock().map_err(|_| "密码库服务不可用。")?;
        if state.epoch != epoch || state.busy || Self::expired(&state) {
            return Err("填写授权已失效，请重新准备。".into());
        }
        let vault = state.vault.as_ref().ok_or("密码库已锁定。")?;
        let value = match field {
            "password" => vault.secret(id)?,
            "user" => Zeroizing::new(
                vault
                    .list()
                    .iter()
                    .find(|e| e.id == id)
                    .ok_or("账号不存在。")?
                    .user
                    .clone(),
            ),
            _ => return Err("只支持单项填写。".into()),
        };
        let result = action(&value);
        if result.is_ok() {
            state.last = SystemTime::now();
        }
        result
    }
    pub fn browser_request(
        &self,
        request: crate::browser_protocol::Request,
    ) -> Result<crate::browser_bridge::Reply, String> {
        use crate::browser_bridge::{matches_site, origin, BrowserEntry, Credential, Reply};
        let site = origin(&request.origin)?;
        self.access(|vault| {
            let entries = vault.list();
            match request.operation.as_str() {
                "list" => Ok(Reply {
                    entries: Some(
                        entries
                            .iter()
                            .filter(|e| matches_site(&e.url, &site))
                            .map(|e| BrowserEntry {
                                id: e.id,
                                name: e.name.clone(),
                                user: e.user.clone(),
                                site: crate::browser_bridge::site_label(&e.url),
                            })
                            .collect(),
                    ),
                    ..Reply::default()
                }),
                "fill" => {
                    let entry = entries
                        .iter()
                        .find(|e| Some(e.id) == request.id && matches_site(&e.url, &site))
                        .ok_or("此账号与当前网站不匹配。")?;
                    Ok(Reply {
                        credential: Some(Credential {
                            user: entry.user.clone(),
                            password: vault.secret(entry.id)?.to_string(),
                        }),
                        ..Reply::default()
                    })
                }
                _ => Err("不支持的浏览器请求。".into()),
            }
        })
    }
    fn begin_sensitive(&self, allow_new: bool) -> Result<u64, String> {
        let mut state = self.state.lock().map_err(|_| "密码库服务不可用。")?;
        if Self::expired(&state) {
            state.vault = None;
            state.import_file = None;
            state.csv_import = None;
            state.epoch = state.epoch.wrapping_add(1);
        }
        if state.busy {
            return Err("密码库正在处理其他操作，请稍候。".into());
        }
        if state.vault.is_none()
            && (!allow_new || self.path.try_exists().map_err(|_| "无法检查密码库。")?)
        {
            return Err("请先解锁密码库。".into());
        }
        state.busy = true;
        Ok(state.epoch)
    }
    fn change_password(
        &self,
        old: Zeroizing<String>,
        new: Zeroizing<String>,
    ) -> Result<(), String> {
        let epoch = self.begin_sensitive(false)?;
        let prepared = Vault::prepare_password_change(self.path.clone(), &old, &new);
        let mut state = self.state.lock().map_err(|_| "密码库服务不可用。")?;
        state.busy = false;
        if epoch != state.epoch || Self::expired(&state) {
            return Err("操作期间密码库已锁定，请重试。".into());
        }
        state
            .vault
            .as_mut()
            .ok_or("密码库已锁定。")?
            .apply_password_change(prepared?)?;
        state.last = SystemTime::now();
        Ok(())
    }
    fn import(&self, ticket: &str, password: Zeroizing<String>) -> Result<Vec<Metadata>, String> {
        let source = {
            let state = self.state.lock().map_err(|_| "密码库服务不可用。")?;
            let (expected, path, expires) =
                state.import_file.as_ref().ok_or("请重新选择备份文件。")?;
            if ticket != expected || std::time::Instant::now() >= *expires {
                return Err("文件选择已过期，请重新选择。".into());
            }
            path.clone()
        };
        let epoch = self.begin_sensitive(true)?;
        let prepared = Vault::open(source, &password);
        let mut state = self.state.lock().map_err(|_| "密码库服务不可用。")?;
        state.busy = false;
        if epoch != state.epoch || Self::expired(&state) {
            return Err("操作期间密码库已锁定，请重试。".into());
        }
        let source = prepared?;
        if let Some(vault) = state.vault.as_mut() {
            vault.merge(&source)?;
        } else {
            state.vault = Some(Vault::import_new(source, self.path.clone())?);
        }
        state.import_file = None;
        state.last = SystemTime::now();
        Ok(state.vault.as_ref().ok_or("密码库已锁定。")?.list())
    }
}

#[derive(serde::Serialize)]
pub struct ImportChoice {
    ticket: String,
    name: String,
}

#[derive(serde::Serialize)]
pub struct CsvPreview {
    ticket: String,
    name: String,
    added: usize,
    skipped: usize,
    without_username: usize,
}
#[derive(serde::Serialize)]
pub struct CsvResult {
    entries: Vec<Metadata>,
    added: usize,
    skipped: usize,
}
#[tauri::command]
pub async fn vault_choose_csv(window: tauri::WebviewWindow) -> Result<Option<CsvPreview>, String> {
    use rand_core::RngCore;
    require_main(&window)?;
    let service = window.state::<VaultService>().inner().clone();
    service.access(|_| Ok(()))?;
    let epoch = service
        .state
        .lock()
        .map_err(|_| "密码库服务不可用。")?
        .epoch;
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_title("选择 Edge / Chrome 导出的 CSV")
        .add_filter("浏览器密码 CSV", &["csv"])
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    let path = file.path().to_path_buf();
    let name = path
        .file_name()
        .ok_or("文件名无效。")?
        .to_string_lossy()
        .into_owned();
    let rows = tauri::async_runtime::spawn_blocking(move || crate::browser_csv::read(&path))
        .await
        .map_err(|_| "CSV 读取未完成。")??;
    let mut state = service.state.lock().map_err(|_| "密码库服务不可用。")?;
    if state.epoch != epoch || state.busy || VaultService::expired(&state) {
        return Err("选择期间密码库已锁定或变化，请重新选择。".into());
    }
    let (added, skipped) = state
        .vault
        .as_ref()
        .ok_or("请先验证主密码。")?
        .csv_counts(&rows);
    let without_username = rows.iter().filter(|row| row.meta.user.is_empty()).count();
    let mut random = [0; 16];
    rand_core::OsRng
        .try_fill_bytes(&mut random)
        .map_err(|_| "系统随机数不可用。")?;
    let ticket: String = random.iter().map(|b| format!("{b:02x}")).collect();
    state.csv_import = Some((
        ticket.clone(),
        rows,
        std::time::Instant::now() + Duration::from_secs(600),
    ));
    Ok(Some(CsvPreview {
        ticket,
        name,
        added,
        skipped,
        without_username,
    }))
}
#[tauri::command]
pub fn vault_cancel_csv(window: tauri::WebviewWindow) -> Result<(), String> {
    require_main(&window)?;
    window
        .state::<VaultService>()
        .state
        .lock()
        .map_err(|_| "密码库服务不可用。")?
        .csv_import = None;
    Ok(())
}
impl VaultService {
    fn commit_csv(&self, ticket: &str) -> Result<CsvResult, String> {
        let mut state = self.state.lock().map_err(|_| "密码库服务不可用。")?;
        if state.busy || Self::expired(&state) {
            state.csv_import = None;
            return Err("密码库忙碌或验证已过期。".into());
        }
        let (expected, _, deadline) = state.csv_import.as_ref().ok_or("请重新选择 CSV 文件。")?;
        if expected != ticket || std::time::Instant::now() >= *deadline {
            return Err("CSV 选择已过期。".into());
        }
        let (_, rows, _) = state.csv_import.take().ok_or("请重新选择 CSV 文件。")?;
        let vault = state.vault.as_mut().ok_or("请先验证主密码。")?;
        let (added, skipped) = vault.import_csv(&rows)?;
        let entries = vault.list();
        state.last = SystemTime::now();
        Ok(CsvResult {
            entries,
            added,
            skipped,
        })
    }
}
#[tauri::command]
pub fn vault_commit_csv(window: tauri::WebviewWindow, ticket: String) -> Result<CsvResult, String> {
    require_main(&window)?;
    let result = window.state::<VaultService>().commit_csv(&ticket)?;
    let _ = window.emit("lime-vault-changed", ());
    Ok(result)
}
#[tauri::command]
pub async fn vault_choose_import(
    window: tauri::WebviewWindow,
) -> Result<Option<ImportChoice>, String> {
    use rand_core::RngCore;
    require_main(&window)?;
    let service = window.state::<VaultService>().inner().clone();
    let epoch = {
        let state = service.state.lock().map_err(|_| "密码库服务不可用。")?;
        state.epoch
    };
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_title("选择酸橙加密备份")
        .add_filter("酸橙加密密码库", &["lime", "bak"])
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    let mut state = service.state.lock().map_err(|_| "密码库服务不可用。")?;
    if state.busy || state.epoch != epoch {
        return Err("文件选择已取消，请重试。".into());
    }
    let path = file.path().to_path_buf();
    let name = path
        .file_name()
        .ok_or("文件名无效。")?
        .to_string_lossy()
        .into_owned();
    let mut random = [0; 16];
    rand_core::OsRng
        .try_fill_bytes(&mut random)
        .map_err(|_| "系统随机数不可用。")?;
    let ticket = random
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    state.import_file = Some((
        ticket.clone(),
        path,
        std::time::Instant::now() + Duration::from_secs(600),
    ));
    Ok(Some(ImportChoice { ticket, name }))
}
#[tauri::command]
pub async fn vault_import(
    window: tauri::WebviewWindow,
    ticket: String,
    password: String,
) -> Result<Vec<Metadata>, String> {
    let password = Zeroizing::new(password);
    require_main(&window)?;
    let service = window.state::<VaultService>().inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || service.import(&ticket, password))
        .await
        .map_err(|_| "导入未完成。")?;
    if result.is_ok() {
        let _ = window.emit("lime-vault-changed", ());
    }
    result
}
#[tauri::command]
pub async fn vault_change_password(
    window: tauri::WebviewWindow,
    old_password: String,
    new_password: String,
) -> Result<(), String> {
    let old = Zeroizing::new(old_password);
    let new = Zeroizing::new(new_password);
    require_main(&window)?;
    let service = window.state::<VaultService>().inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || service.change_password(old, new))
        .await
        .map_err(|_| "修改主密码未完成。")?;
    if result.is_ok() {
        let _ = window.emit("lime-vault-changed", ());
    }
    result
}
#[tauri::command]
pub async fn vault_export(window: tauri::WebviewWindow) -> Result<bool, String> {
    require_main(&window)?;
    let service = window.state::<VaultService>().inner().clone();
    service.access(|_| Ok(()))?;
    let epoch = service
        .state
        .lock()
        .map_err(|_| "密码库服务不可用。")?
        .epoch;
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_title("导出加密备份（请选择新文件名）")
        .set_file_name("lime-backup.lime")
        .add_filter("酸橙加密密码库", &["lime"])
        .save_file()
        .await
    else {
        return Ok(false);
    };
    let state = service.state.lock().map_err(|_| "密码库服务不可用。")?;
    if state.epoch != epoch || state.busy || VaultService::expired(&state) {
        return Err("文件选择期间密码库已锁定或变化，请重试。".into());
    }
    state
        .vault
        .as_ref()
        .ok_or("密码库已锁定。")?
        .export(file.path())?;
    Ok(true)
}
fn require_main(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("仅主窗口可访问密码库。".into())
    }
}
pub fn lock_all(app: &tauri::AppHandle) {
    app.state::<crate::quick_paste::QuickPaste>().cancel();
    app.state::<VaultService>().lock();
    app.state::<ClipboardService>().clear(app, true);
    let _ = app.emit_to("main", "lime-action", "lock");
    let _ = app.emit_to("floating", "lime-action", "lock");
}
#[tauri::command]
pub fn vault_status(window: tauri::WebviewWindow) -> Result<Status, String> {
    require_main(&window)?;
    let service = window.state::<VaultService>();
    service.check();
    let exists = service
        .path
        .try_exists()
        .map_err(|_| "无法访问密码库目录。")?;
    let locked = service
        .state
        .lock()
        .map_err(|_| "密码库服务不可用。")?
        .vault
        .is_none();
    let backup = service
        .path
        .with_extension("lime.bak")
        .try_exists()
        .unwrap_or(false);
    Ok(Status {
        exists,
        locked,
        backup,
    })
}
#[tauri::command]
pub async fn vault_auth(
    window: tauri::WebviewWindow,
    password: String,
    create: bool,
    restore: bool,
) -> Result<Vec<Metadata>, String> {
    let password = Zeroizing::new(password);
    require_main(&window)?;
    let service = window.state::<VaultService>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.authenticate(password, create, restore))
        .await
        .map_err(|_| "主密码处理未完成。")?
}
#[tauri::command]
pub fn vault_lock(window: tauri::WebviewWindow) -> Result<(), String> {
    require_main(&window)?;
    lock_all(window.app_handle());
    Ok(())
}
#[tauri::command]
pub fn vault_touch(window: tauri::WebviewWindow, minutes: u32) -> Result<(), String> {
    require_main(&window)?;
    if minutes > 1440 {
        return Err("锁定时间无效。".into());
    }
    let service = window.state::<VaultService>();
    if service.check() {
        lock_all(window.app_handle());
        return Err("密码库已锁定。".into());
    }
    let mut state = service.state.lock().map_err(|_| "密码库服务不可用。")?;
    if state.vault.is_none() {
        return Err("密码库已锁定。".into());
    }
    state.last = SystemTime::now();
    state.minutes = minutes;
    Ok(())
}
#[tauri::command]
pub fn vault_list(window: tauri::WebviewWindow) -> Result<Vec<Metadata>, String> {
    require_main(&window)?;
    window
        .state::<VaultService>()
        .access(|vault| Ok(vault.list()))
}
#[tauri::command]
pub fn vault_strengths(
    window: tauri::WebviewWindow,
) -> Result<Vec<crate::vault::Strength>, String> {
    require_main(&window)?;
    window
        .state::<VaultService>()
        .access(|vault| Ok(vault.strengths()))
}
#[tauri::command]
pub fn vault_save(
    window: tauri::WebviewWindow,
    entry: Metadata,
    password: Option<String>,
) -> Result<Vec<Metadata>, String> {
    let password = password.map(Zeroizing::new);
    require_main(&window)?;
    window.state::<VaultService>().access(|vault| {
        vault.upsert(entry, password.as_deref().map(|value| value.as_str()))?;
        Ok(vault.list())
    })
}
#[tauri::command]
pub fn vault_delete(window: tauri::WebviewWindow, id: u32) -> Result<Vec<Metadata>, String> {
    require_main(&window)?;
    window.state::<VaultService>().access(|vault| {
        vault.delete(id)?;
        Ok(vault.list())
    })
}
#[tauri::command]
pub fn vault_undo(window: tauri::WebviewWindow) -> Result<Vec<Metadata>, String> {
    require_main(&window)?;
    window.state::<VaultService>().access(|vault| {
        vault.undo()?;
        Ok(vault.list())
    })
}
#[tauri::command]
pub fn vault_reveal(window: tauri::WebviewWindow, id: u32) -> Result<String, String> {
    require_main(&window)?;
    window
        .state::<VaultService>()
        .access(|vault| Ok(vault.secret(id)?.to_string()))
}
#[tauri::command]
pub fn vault_copy(window: tauri::WebviewWindow, id: u32, field: String) -> Result<u32, String> {
    require_main(&window)?;
    window.state::<VaultService>().access(|vault| {
        let value = match field.as_str() {
            "password" => vault.secret(id)?,
            "user" => Zeroizing::new(
                vault
                    .list()
                    .into_iter()
                    .find(|entry| entry.id == id)
                    .ok_or("账号不存在。")?
                    .user
                    .clone(),
            ),
            _ => return Err("不支持的复制字段。".into()),
        };
        window.state::<ClipboardService>().copy_text(&value)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn browser_access_requires_valid_session_and_same_site_and_csv_ticket_dies_on_lock() {
        use crate::browser_protocol::Request;
        let dir = tempfile::tempdir().unwrap();
        let service = VaultService::new(dir.path().join("vault.lime"));
        let request = |operation: &str, origin: &str, id| Request {
            operation: operation.into(),
            origin: origin.into(),
            id,
        };
        assert!(service
            .browser_request(request("list", "https://example.invalid", None))
            .is_err());
        service
            .authenticate(Zeroizing::new("fictional-master-only".into()), true, false)
            .unwrap();
        let rows = crate::browser_csv::parse(
            b"url,username,password\nhttps://example.invalid,u,test-value\n",
        )
        .unwrap();
        service.access(|v| v.import_csv(&rows)).unwrap();
        assert_eq!(
            service
                .browser_request(request("list", "https://login.example.invalid", None))
                .unwrap()
                .entries
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            service
                .browser_request(request("fill", "https://login.example.invalid", Some(1)))
                .unwrap()
                .credential
                .unwrap()
                .password,
            "test-value"
        );
        assert_eq!(
            service
                .browser_request(request("list", "https://example.invalid", None))
                .unwrap()
                .entries
                .unwrap()
                .len(),
            1
        );
        assert!(service
            .browser_request(request("fill", "https://evil.invalid", Some(1)))
            .is_err());
        assert!(service
            .browser_request(request("export", "https://example.invalid", None))
            .is_err());
        assert_eq!(
            service
                .browser_request(request("fill", "https://example.invalid", Some(1)))
                .unwrap()
                .credential
                .unwrap()
                .password,
            "test-value"
        );
        service.state.lock().unwrap().csv_import = Some((
            "csv-ticket".into(),
            rows,
            std::time::Instant::now() + Duration::from_secs(600),
        ));
        service.lock();
        assert!(service.commit_csv("csv-ticket").is_err());
        assert!(service
            .browser_request(request("fill", "https://example.invalid", Some(1)))
            .is_err());
    }
    #[test]
    fn steam_request_never_executes_after_lock_or_with_invalid_field() {
        let dir = tempfile::tempdir().unwrap();
        let service = VaultService::new(dir.path().join("vault.lime"));
        assert!(service.floating_epoch(1).is_err());
        service
            .authenticate(Zeroizing::new("fictional-master-only".into()), true, false)
            .unwrap();
        let rows = crate::browser_csv::parse(b"url,username,password\nhttps://store.steampowered.com,fictional-user,fictional-password\n").unwrap();
        service.access(|v| v.import_csv(&rows)).unwrap();
        let epoch = service.floating_epoch(1).unwrap();
        assert!(service
            .with_floating_field::<()>(epoch, 1, "both", |_| panic!("must not execute"))
            .is_err());
        assert_eq!(
            service
                .with_floating_field(epoch, 1, "user", |s| Ok(s.to_string()))
                .unwrap(),
            "fictional-user"
        );
        service.lock();
        assert!(service
            .with_floating_field::<()>(epoch, 1, "password", |_| panic!("must not execute"))
            .is_err());
        service
            .authenticate(Zeroizing::new("fictional-master-only".into()), false, false)
            .unwrap();
        assert!(service
            .with_floating_field::<()>(epoch, 1, "password", |_| panic!(
                "old request must not execute"
            ))
            .is_err());
    }
    #[test]
    fn lock_cancels_an_inflight_authentication() {
        let dir = tempfile::tempdir().unwrap();
        let service = VaultService::new(dir.path().join("vault.lime"));
        let worker = service.clone();
        let thread = std::thread::spawn(move || {
            worker.authenticate(
                Zeroizing::new("test-master-password-only".into()),
                true,
                false,
            )
        });
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while !service.state.lock().unwrap().busy {
            assert!(std::time::Instant::now() < deadline);
            std::thread::yield_now();
        }
        service.lock();
        assert!(thread.join().unwrap().is_err());
        assert!(
            !service.path.exists(),
            "cancelled creation must not write a vault"
        );
        assert!(service.access(|vault| Ok(vault.list())).is_err());
    }
    #[test]
    fn lock_cancels_restore_without_changing_disk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("vault.lime");
        Vault::create(path.clone(), "test-master-password-only").unwrap();
        std::fs::copy(&path, path.with_extension("lime.bak")).unwrap();
        let before = std::fs::read(&path).unwrap();
        let service = VaultService::new(path.clone());
        let worker = service.clone();
        let thread = std::thread::spawn(move || {
            worker.authenticate(
                Zeroizing::new("test-master-password-only".into()),
                false,
                true,
            )
        });
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while !service.state.lock().unwrap().busy {
            assert!(std::time::Instant::now() < deadline);
            std::thread::yield_now();
        }
        service.lock();
        assert!(thread.join().unwrap().is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);
    }
    #[test]
    fn lock_cancels_password_change_and_import_without_disk_commit() {
        for import in [false, true] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("vault.lime");
            let service = VaultService::new(path.clone());
            service
                .authenticate(
                    Zeroizing::new("test-master-password-only".into()),
                    true,
                    false,
                )
                .unwrap();
            let before = std::fs::read(&path).unwrap();
            let source = dir.path().join("source.lime");
            std::fs::copy(&path, &source).unwrap();
            service.state.lock().unwrap().import_file = Some((
                "mock-ticket".into(),
                source,
                std::time::Instant::now() + Duration::from_secs(60),
            ));
            let worker = service.clone();
            let thread = std::thread::spawn(move || {
                if import {
                    worker
                        .import(
                            "mock-ticket",
                            Zeroizing::new("test-master-password-only".into()),
                        )
                        .map(|_| ())
                } else {
                    worker.change_password(
                        Zeroizing::new("test-master-password-only".into()),
                        Zeroizing::new("different-test-password".into()),
                    )
                }
            });
            let deadline = std::time::Instant::now() + Duration::from_secs(5);
            while !service.state.lock().unwrap().busy {
                assert!(std::time::Instant::now() < deadline);
                std::thread::yield_now();
            }
            service.lock();
            assert!(thread.join().unwrap().is_err());
            assert_eq!(std::fs::read(&path).unwrap(), before);
            assert!(service.state.lock().unwrap().import_file.is_none());
            assert!(service.access(|vault| Ok(vault.list())).is_err());
        }
    }
    #[test]
    fn locked_service_rejects_reads_and_idle_expiry_drops_key() {
        let dir = tempfile::tempdir().unwrap();
        let service = VaultService::new(dir.path().join("vault.lime"));
        assert!(service.access(|vault| Ok(vault.list())).is_err());
        service
            .authenticate(
                Zeroizing::new("test-master-password-only".into()),
                true,
                false,
            )
            .unwrap();
        assert!(service.access(|vault| Ok(vault.list())).is_ok());
        {
            let mut state = service.state.lock().unwrap();
            for minutes in [90, 120, 480, 1440] {
                state.minutes = minutes;
                state.last = SystemTime::now() - Duration::from_secs(u64::from(minutes) * 60 - 2);
                assert!(!VaultService::expired(&state));
                state.last = SystemTime::now() - Duration::from_secs(u64::from(minutes) * 60);
                assert!(VaultService::expired(&state));
            }
            state.minutes = 5;
            state.import_file = Some((
                "stale-ticket".into(),
                dir.path().join("unused.lime"),
                std::time::Instant::now() + Duration::from_secs(600),
            ));
            state.last = SystemTime::now() - Duration::from_secs(301);
        }
        assert!(service.check());
        assert!(service.state.lock().unwrap().import_file.is_none());
        assert!(service.access(|vault| Ok(vault.list())).is_err());
    }
}
