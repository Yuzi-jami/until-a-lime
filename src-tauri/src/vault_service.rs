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
            })),
        }
    }
    pub fn lock(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.vault = None;
            state.import_file = None;
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
        if let Some(vault) = state.vault.as_mut() {
            vault.expire_undo();
        }
        if Self::expired(&state) {
            state.vault = None;
            state.import_file = None;
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
    fn begin_sensitive(&self, allow_new: bool) -> Result<u64, String> {
        let mut state = self.state.lock().map_err(|_| "密码库服务不可用。")?;
        if Self::expired(&state) {
            state.vault = None;
            state.import_file = None;
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
    app.state::<VaultService>().lock();
    app.state::<ClipboardService>().clear(app, true);
    let _ = app.emit_to("main", "lime-action", "lock");
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
    if !matches!(minutes, 0 | 1 | 5 | 15) {
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
