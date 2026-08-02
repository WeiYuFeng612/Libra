use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use crate::error::AppError;
pub const APP_CONFIG_DIR_NAME: &str = ".libra";
pub const APP_DATABASE_FILE_NAME: &str = "libra.db";

const LEGACY_APP_CONFIG_DIR_NAME: &str = ".cc-switch";
const LEGACY_DATABASE_FILE_NAME: &str = "cc-switch.db";
const PORTABLE_MARKER_FILE_NAME: &str = "portable.ini";
const PORTABLE_DATA_DIR_NAME: &str = "LibraData";

/// 获取用户主目录，带回退和日志
///
/// ## Windows 注意事项
///
/// - `dirs::home_dir()` 在 Windows 上使用 `SHGetKnownFolderPath(FOLDERID_Profile)`，
///   返回的是真实用户目录（类似 `C:\\Users\\Alice`），与 v3.10.2 行为一致。
/// - 不要直接使用 `HOME` 环境变量：它可能由 Git/Cygwin/MSYS 等第三方工具注入，
///   且不一定等于用户目录；Libra 只把它用于发现旧数据的一次性迁移来源。
///
/// ## 测试隔离
///
/// 为了让 Windows CI/本地测试能稳定隔离真实用户数据，可通过 `LIBRA_TEST_HOME`
/// 显式覆盖 home dir（仅用于测试/调试场景）。
pub fn get_home_dir() -> PathBuf {
    if let Ok(home) = std::env::var("LIBRA_TEST_HOME") {
        let trimmed = home.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    // Backward-compatible test-only fallback for existing test suites.
    if let Ok(home) = std::env::var("CC_SWITCH_TEST_HOME") {
        let trimmed = home.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    dirs::home_dir().unwrap_or_else(|| {
        log::warn!("无法获取用户主目录，回退到当前目录");
        PathBuf::from(".")
    })
}

/// 获取 Claude Code 配置目录路径
pub fn get_claude_config_dir() -> PathBuf {
    if let Some(custom) = crate::settings::get_claude_override_dir() {
        return custom;
    }

    get_home_dir().join(".claude")
}

/// 默认 Claude MCP 配置文件路径 (~/.claude.json)
pub fn get_default_claude_mcp_path() -> PathBuf {
    get_home_dir().join(".claude.json")
}

fn normalize_path_lexically(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    normalized.push(component.as_os_str());
                }
            }
            Component::Normal(part) => normalized.push(part),
            Component::RootDir | Component::Prefix(_) => normalized.push(component.as_os_str()),
        }
    }

    normalized
}

fn comparable_path_key(path: &Path) -> String {
    let mut key = normalize_path_lexically(path).to_string_lossy().to_string();

    #[cfg(windows)]
    {
        key = key.replace('\\', "/");
    }

    while key.len() > 1 && key.ends_with('/') {
        key.pop();
    }

    #[cfg(windows)]
    {
        key.make_ascii_lowercase();
    }

    key
}

fn path_eq_lexical(left: &Path, right: &Path) -> bool {
    comparable_path_key(left) == comparable_path_key(right)
}

#[cfg(windows)]
fn derive_wsl_default_mcp_path(dir: &Path) -> Option<PathBuf> {
    use std::path::Prefix;

    let normalized = normalize_path_lexically(dir);
    let mut components = normalized.components();
    let prefix = match components.next()? {
        Component::Prefix(prefix) => prefix,
        _ => return None,
    };

    let server = match prefix.kind() {
        Prefix::UNC(server, _) | Prefix::VerbatimUNC(server, _) => server.to_string_lossy(),
        _ => return None,
    };

    if !server.eq_ignore_ascii_case("wsl$") && !server.eq_ignore_ascii_case("wsl.localhost") {
        return None;
    }

    let mut parts = Vec::new();
    for component in components {
        match component {
            Component::RootDir | Component::CurDir => {}
            Component::Normal(part) => parts.push(part.to_string_lossy().to_string()),
            Component::ParentDir | Component::Prefix(_) => return None,
        }
    }

    let is_wsl_home_default =
        parts.len() == 3 && parts[0] == "home" && !parts[1].is_empty() && parts[2] == ".claude";
    let is_wsl_root_default = parts.len() == 2 && parts[0] == "root" && parts[1] == ".claude";

    if is_wsl_home_default || is_wsl_root_default {
        return normalized
            .parent()
            .map(|parent| parent.join(".claude.json"));
    }

    None
}

fn default_mcp_path_for_config_dir(dir: &Path) -> Option<PathBuf> {
    let default_config_dir = get_home_dir().join(".claude");
    if path_eq_lexical(dir, &default_config_dir) {
        return Some(get_default_claude_mcp_path());
    }

    #[cfg(windows)]
    {
        if let Some(path) = derive_wsl_default_mcp_path(dir) {
            return Some(path);
        }
    }

    None
}

fn derive_mcp_path_from_override(dir: &Path) -> PathBuf {
    dir.join(".claude.json")
}

/// 获取 Claude MCP 配置文件路径
pub fn get_claude_mcp_path() -> PathBuf {
    if let Some(custom_dir) = crate::settings::get_claude_override_dir() {
        if let Some(path) = default_mcp_path_for_config_dir(&custom_dir) {
            return path;
        }
        return derive_mcp_path_from_override(&custom_dir);
    }
    get_default_claude_mcp_path()
}

/// 获取 Claude Code 主配置文件路径
pub fn get_claude_settings_path() -> PathBuf {
    let dir = get_claude_config_dir();
    let settings = dir.join("settings.json");
    if settings.exists() {
        return settings;
    }
    // 兼容旧版命名：若存在旧文件则继续使用
    let legacy = dir.join("claude.json");
    if legacy.exists() {
        return legacy;
    }
    // 默认新建：回落到标准文件名 settings.json（不再生成 claude.json）
    settings
}

/// Returns the portable data directory when the executable is next to portable.ini.
pub fn get_portable_app_config_dir() -> Option<PathBuf> {
    let executable = std::env::current_exe().ok()?;
    let executable_dir = executable.parent()?;

    executable_dir
        .join(PORTABLE_MARKER_FILE_NAME)
        .is_file()
        .then(|| executable_dir.join(PORTABLE_DATA_DIR_NAME))
}

/// Returns the independent Libra application data directory.
///
/// The portable marker always takes precedence over a saved custom path so an extracted
/// portable build keeps its data next to Libra.exe.
pub fn get_app_config_dir() -> PathBuf {
    if let Some(portable_dir) = get_portable_app_config_dir() {
        return portable_dir;
    }

    if let Some(custom) = crate::app_store::get_app_config_dir_override() {
        return custom;
    }

    get_home_dir().join(APP_CONFIG_DIR_NAME)
}

/// Returns the SQLite database location used by Libra.
pub fn get_app_database_path() -> PathBuf {
    get_app_config_dir().join(APP_DATABASE_FILE_NAME)
}

fn directory_has_entries(path: &Path) -> Result<bool, AppError> {
    let mut entries = fs::read_dir(path).map_err(|e| AppError::io(path, e))?;
    match entries.next() {
        Some(Ok(_)) => Ok(true),
        Some(Err(error)) => Err(AppError::io(path, error)),
        None => Ok(false),
    }
}

fn legacy_app_config_dirs() -> Vec<PathBuf> {
    let mut candidates = vec![get_home_dir().join(LEGACY_APP_CONFIG_DIR_NAME)];

    #[cfg(windows)]
    {
        if let Ok(home_env) = std::env::var("HOME") {
            let trimmed = home_env.trim();
            if !trimmed.is_empty() {
                let legacy_dir = PathBuf::from(trimmed).join(LEGACY_APP_CONFIG_DIR_NAME);
                if !candidates
                    .iter()
                    .any(|path| path_eq_lexical(path, &legacy_dir))
                {
                    candidates.push(legacy_dir);
                }
            }
        }
    }

    candidates
}

fn is_legacy_database_artifact(file_name: &str) -> bool {
    let file_name = file_name.to_ascii_lowercase();
    file_name == LEGACY_DATABASE_FILE_NAME
        || file_name.starts_with(&format!("{LEGACY_DATABASE_FILE_NAME}-"))
}

fn copy_legacy_tree(source: &Path, destination: &Path) -> Result<(), AppError> {
    copy_legacy_tree_inner(source, destination, true)
}

fn copy_legacy_tree_inner(
    source: &Path,
    destination: &Path,
    is_legacy_root: bool,
) -> Result<(), AppError> {
    fs::create_dir_all(destination).map_err(|e| AppError::io(destination, e))?;

    for entry in fs::read_dir(source).map_err(|e| AppError::io(source, e))? {
        let entry = entry.map_err(|e| AppError::io(source, e))?;
        let source_path = entry.path();
        let target_path = destination.join(entry.file_name());
        let file_type = entry
            .file_type()
            .map_err(|e| AppError::io(&source_path, e))?;

        if file_type.is_dir() {
            copy_legacy_tree_inner(&source_path, &target_path, false)?;
        } else if file_type.is_file() {
            let file_name = entry.file_name().to_string_lossy().to_string();
            if is_legacy_root && is_legacy_database_artifact(&file_name) {
                continue;
            }
            fs::copy(&source_path, &target_path).map_err(|e| AppError::IoContext {
                context: format!(
                    "Copy legacy Libra data failed ({} -> {})",
                    source_path.display(),
                    target_path.display()
                ),
                source: e,
            })?;
        } else {
            log::warn!(
                "Skipping non-regular legacy data file: {}",
                source_path.display()
            );
        }
    }

    Ok(())
}

fn snapshot_legacy_database(source: &Path, destination: &Path) -> Result<(), AppError> {
    use rusqlite::{backup::Backup, Connection, OpenFlags};

    let source_connection =
        Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| AppError::Database(format!("Open legacy database failed: {e}")))?;
    let mut destination_connection = Connection::open(destination)
        .map_err(|e| AppError::Database(format!("Create Libra database snapshot failed: {e}")))?;
    let backup = Backup::new(&source_connection, &mut destination_connection).map_err(|e| {
        AppError::Database(format!("Create database migration snapshot failed: {e}"))
    })?;
    backup
        .run_to_completion(64, std::time::Duration::from_millis(25), None)
        .map_err(|e| AppError::Database(format!("Copy legacy database snapshot failed: {e}")))?;

    Ok(())
}

fn create_migration_staging_dir(destination: &Path) -> Result<PathBuf, AppError> {
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::Config("Invalid Libra data directory".to_string()))?;
    fs::create_dir_all(parent).map_err(|e| AppError::io(parent, e))?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let prefix = format!(".libra-migration-{}-{timestamp}", std::process::id());

    for attempt in 0..32_u32 {
        let candidate = parent.join(format!("{prefix}-{attempt}"));
        match fs::create_dir(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(AppError::io(&candidate, error)),
        }
    }

    Err(AppError::Config(
        "Unable to create a Libra data migration staging directory".to_string(),
    ))
}

/// Copies legacy CCSwitch data once, without changing the original directory.
///
/// Database data is migrated with SQLite's backup API; all other regular files are copied into
/// a sibling staging directory. The staging directory is atomically renamed only after success.
pub fn migrate_legacy_app_data_if_needed() -> Result<bool, AppError> {
    let destination = get_app_config_dir();

    if destination.exists() {
        if !destination.is_dir() {
            return Err(AppError::Config(format!(
                "Libra data path is not a directory: {}",
                destination.display()
            )));
        }

        // Never overwrite or merge old data into an existing Libra profile.
        if directory_has_entries(&destination)? {
            return Ok(false);
        }

        // The directory is proven empty, so removing it makes the final rename atomic.
        fs::remove_dir(&destination).map_err(|e| AppError::io(&destination, e))?;
    }

    let mut source = None;
    for candidate in legacy_app_config_dirs() {
        if !candidate.is_dir() || path_eq_lexical(&candidate, &destination) {
            continue;
        }
        if directory_has_entries(&candidate)? {
            source = Some(candidate);
            break;
        }
    }

    let Some(source) = source else {
        return Ok(false);
    };

    let staging = create_migration_staging_dir(&destination)?;
    let migration_result = (|| {
        copy_legacy_tree(&source, &staging)?;

        let legacy_database = source.join(LEGACY_DATABASE_FILE_NAME);
        if legacy_database.is_file() {
            snapshot_legacy_database(&legacy_database, &staging.join(APP_DATABASE_FILE_NAME))?;
        }

        fs::rename(&staging, &destination).map_err(|e| AppError::IoContext {
            context: format!(
                "Commit Libra data migration failed ({} -> {})",
                staging.display(),
                destination.display()
            ),
            source: e,
        })?;
        Ok(())
    })();

    if let Err(error) = migration_result {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }

    log::info!(
        "Migrated legacy app data into the independent Libra directory: {} -> {}",
        source.display(),
        destination.display()
    );
    Ok(true)
}

/// 获取应用配置文件路径
pub fn get_app_config_path() -> PathBuf {
    get_app_config_dir().join("config.json")
}

/// 清理供应商名称，确保文件名安全
#[allow(dead_code)]
pub fn sanitize_provider_name(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '-',
            _ => c,
        })
        .collect::<String>()
        .to_lowercase()
}

/// 获取供应商配置文件路径
#[allow(dead_code)]
pub fn get_provider_config_path(provider_id: &str, provider_name: Option<&str>) -> PathBuf {
    let base_name = provider_name
        .map(sanitize_provider_name)
        .unwrap_or_else(|| sanitize_provider_name(provider_id));

    get_claude_config_dir().join(format!("settings-{base_name}.json"))
}

/// 读取 JSON 配置文件
pub fn read_json_file<T: for<'a> Deserialize<'a>>(path: &Path) -> Result<T, AppError> {
    if !path.exists() {
        return Err(AppError::Config(format!("文件不存在: {}", path.display())));
    }

    let content = fs::read_to_string(path).map_err(|e| AppError::io(path, e))?;

    serde_json::from_str(&content).map_err(|e| AppError::json(path, e))
}

/// 递归排序 JSON 对象的键（按字母顺序），确保序列化输出是确定性的
fn sort_json_keys(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut sorted_map = Map::new();
            let mut keys: Vec<_> = map.keys().collect();
            keys.sort();
            for key in keys {
                sorted_map.insert(key.clone(), sort_json_keys(&map[key]));
            }
            Value::Object(sorted_map)
        }
        Value::Array(arr) => Value::Array(arr.iter().map(sort_json_keys).collect()),
        other => other.clone(),
    }
}

/// 写入 JSON 配置文件（键按字母排序，确保确定性输出）
pub fn write_json_file<T: Serialize>(path: &Path, data: &T) -> Result<(), AppError> {
    // 确保目录存在
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::io(parent, e))?;
    }

    let value = serde_json::to_value(data).map_err(|e| AppError::JsonSerialize { source: e })?;
    let sorted_value = sort_json_keys(&value);
    let json = serde_json::to_string_pretty(&sorted_value)
        .map_err(|e| AppError::JsonSerialize { source: e })?;

    atomic_write(path, json.as_bytes())
}

/// 原子写入文本文件（用于 TOML/纯文本）
pub fn write_text_file(path: &Path, data: &str) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::io(parent, e))?;
    }
    atomic_write(path, data.as_bytes())
}

/// 原子写入：写入临时文件后 rename 替换，避免半写状态
pub fn atomic_write(path: &Path, data: &[u8]) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::io(parent, e))?;
    }

    let parent = path
        .parent()
        .ok_or_else(|| AppError::Config("无效的路径".to_string()))?;
    let mut tmp = parent.to_path_buf();
    let file_name = path
        .file_name()
        .ok_or_else(|| AppError::Config("无效的文件名".to_string()))?
        .to_string_lossy()
        .to_string();
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    tmp.push(format!("{file_name}.tmp.{ts}"));

    {
        let mut f = fs::File::create(&tmp).map_err(|e| AppError::io(&tmp, e))?;
        f.write_all(data).map_err(|e| AppError::io(&tmp, e))?;
        f.flush().map_err(|e| AppError::io(&tmp, e))?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = fs::metadata(path) {
            let perm = meta.permissions().mode();
            let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(perm));
        }
    }

    #[cfg(windows)]
    {
        // Windows 上 rename 目标存在会失败，先移除再重命名（尽量接近原子性）
        if path.exists() {
            let _ = fs::remove_file(path);
        }
        fs::rename(&tmp, path).map_err(|e| AppError::IoContext {
            context: format!("原子替换失败: {} -> {}", tmp.display(), path.display()),
            source: e,
        })?;
    }

    #[cfg(not(windows))]
    {
        fs::rename(&tmp, path).map_err(|e| AppError::IoContext {
            context: format!("原子替换失败: {} -> {}", tmp.display(), path.display()),
            source: e,
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derive_mcp_path_from_override_uses_config_dir_for_custom_path() {
        let override_dir = PathBuf::from("/tmp/profile/.claude");
        let derived = derive_mcp_path_from_override(&override_dir);
        assert_eq!(derived, PathBuf::from("/tmp/profile/.claude/.claude.json"));
    }

    #[test]
    fn derive_mcp_path_from_override_uses_config_dir_for_non_hidden_folder() {
        let override_dir = PathBuf::from("/data/claude-config");
        let derived = derive_mcp_path_from_override(&override_dir);
        assert_eq!(derived, PathBuf::from("/data/claude-config/.claude.json"));
    }

    #[test]
    fn derive_mcp_path_from_override_supports_relative_rootless_dir() {
        let override_dir = PathBuf::from("claude");
        let derived = derive_mcp_path_from_override(&override_dir);
        assert_eq!(derived, PathBuf::from("claude/.claude.json"));
    }

    #[test]
    fn derive_mcp_path_from_root_like_dir_uses_root_file() {
        let override_dir = PathBuf::from("/");
        let derived = derive_mcp_path_from_override(&override_dir);
        assert_eq!(derived, PathBuf::from("/.claude.json"));
    }

    #[test]
    fn derive_mcp_path_from_override_preserves_leading_parent_dirs() {
        let override_dir = PathBuf::from("../../profiles/work/.claude");
        let derived = derive_mcp_path_from_override(&override_dir);
        assert_eq!(derived, override_dir.join(".claude.json"));
    }

    #[cfg(windows)]
    #[test]
    fn wsl_unc_home_default_uses_split_mcp_path() {
        let override_dir = PathBuf::from(r"\\wsl$\Ubuntu\home\travis\.claude");
        let derived = default_mcp_path_for_config_dir(&override_dir)
            .expect("WSL home default should use split MCP path");
        assert_eq!(
            derived,
            PathBuf::from(r"\\wsl$\Ubuntu\home\travis\.claude.json")
        );
    }

    #[cfg(windows)]
    #[test]
    fn wsl_unc_root_default_uses_split_mcp_path() {
        let override_dir = PathBuf::from(r"\\wsl.localhost\Ubuntu\root\.claude");
        let derived = default_mcp_path_for_config_dir(&override_dir)
            .expect("WSL root default should use split MCP path");
        assert_eq!(
            derived,
            PathBuf::from(r"\\wsl.localhost\Ubuntu\root\.claude.json")
        );
    }

    #[cfg(windows)]
    #[test]
    fn wsl_unc_custom_dir_uses_nested_mcp_path() {
        let override_dir = PathBuf::from(r"\\wsl$\Ubuntu\opt\claude\.claude");
        assert!(default_mcp_path_for_config_dir(&override_dir).is_none());
        assert_eq!(
            derive_mcp_path_from_override(&override_dir),
            PathBuf::from(r"\\wsl$\Ubuntu\opt\claude\.claude\.claude.json")
        );
    }

    #[test]
    fn sort_json_keys_sorts_top_level_object() {
        let input = serde_json::json!({
            "z": 1,
            "a": 2,
            "m": 3,
        });
        let sorted = sort_json_keys(&input);
        let serialized = serde_json::to_string(&sorted).unwrap();
        assert_eq!(serialized, r#"{"a":2,"m":3,"z":1}"#);
    }

    #[test]
    fn sort_json_keys_recurses_into_nested_objects() {
        let input = serde_json::json!({
            "outer_b": {"z": 1, "a": 2},
            "outer_a": {"y": 3, "b": 4},
        });
        let sorted = sort_json_keys(&input);
        let serialized = serde_json::to_string(&sorted).unwrap();
        assert_eq!(
            serialized,
            r#"{"outer_a":{"b":4,"y":3},"outer_b":{"a":2,"z":1}}"#
        );
    }

    #[test]
    fn sort_json_keys_preserves_array_order() {
        let input = serde_json::json!([3, 1, 2]);
        let sorted = sort_json_keys(&input);
        let serialized = serde_json::to_string(&sorted).unwrap();
        assert_eq!(serialized, "[3,1,2]");
    }

    #[test]
    fn sort_json_keys_sorts_objects_inside_arrays_but_keeps_array_order() {
        let input = serde_json::json!([
            {"z": 1, "a": 2},
            {"y": 3, "b": 4},
        ]);
        let sorted = sort_json_keys(&input);
        let serialized = serde_json::to_string(&sorted).unwrap();
        assert_eq!(serialized, r#"[{"a":2,"z":1},{"b":4,"y":3}]"#);
    }

    #[test]
    fn sort_json_keys_passes_through_primitives() {
        let cases = vec![
            serde_json::json!("hello"),
            serde_json::json!(42),
            serde_json::json!(3.5),
            serde_json::json!(true),
            serde_json::json!(null),
        ];
        for value in cases {
            let sorted = sort_json_keys(&value);
            assert_eq!(sorted, value);
        }
    }

    #[test]
    fn sort_json_keys_handles_empty_collections() {
        let empty_obj = serde_json::json!({});
        assert_eq!(
            serde_json::to_string(&sort_json_keys(&empty_obj)).unwrap(),
            "{}"
        );

        let empty_arr = serde_json::json!([]);
        assert_eq!(
            serde_json::to_string(&sort_json_keys(&empty_arr)).unwrap(),
            "[]"
        );
    }

    #[test]
    fn sort_json_keys_produces_identical_output_for_different_insertion_orders() {
        // 核心保证：同一逻辑配置无论键的插入顺序如何，写出的字节序列必须一致。
        let mut a = Map::new();
        a.insert("env".to_string(), serde_json::json!({"PATH": "/usr/bin"}));
        a.insert("model".to_string(), serde_json::json!("claude-sonnet-4-5"));
        a.insert("permissions".to_string(), serde_json::json!({"allow": []}));

        let mut b = Map::new();
        b.insert("permissions".to_string(), serde_json::json!({"allow": []}));
        b.insert("model".to_string(), serde_json::json!("claude-sonnet-4-5"));
        b.insert("env".to_string(), serde_json::json!({"PATH": "/usr/bin"}));

        let sorted_a = sort_json_keys(&Value::Object(a));
        let sorted_b = sort_json_keys(&Value::Object(b));

        assert_eq!(
            serde_json::to_string(&sorted_a).unwrap(),
            serde_json::to_string(&sorted_b).unwrap(),
        );
    }

    #[test]
    #[serial_test::serial]
    fn migrates_legacy_data_with_a_read_only_database_snapshot() {
        struct TestHomeGuard(Option<std::ffi::OsString>);

        impl Drop for TestHomeGuard {
            fn drop(&mut self) {
                match self.0.take() {
                    Some(previous) => std::env::set_var("LIBRA_TEST_HOME", previous),
                    None => std::env::remove_var("LIBRA_TEST_HOME"),
                }
            }
        }

        let temp = tempfile::tempdir().expect("create isolated test home");
        let _guard = TestHomeGuard(std::env::var_os("LIBRA_TEST_HOME"));
        std::env::set_var("LIBRA_TEST_HOME", temp.path());

        let legacy_dir = temp.path().join(LEGACY_APP_CONFIG_DIR_NAME);
        let legacy_skills_dir = legacy_dir.join("skills");
        let legacy_backups_dir = legacy_dir.join("backups");
        fs::create_dir_all(&legacy_skills_dir).expect("create legacy skills directory");
        fs::create_dir_all(&legacy_backups_dir).expect("create legacy backups directory");
        fs::write(legacy_dir.join("config.json"), br#"{"version":2}"#)
            .expect("write legacy config");
        fs::write(legacy_skills_dir.join("sample.md"), b"legacy skill")
            .expect("write legacy skill");
        fs::write(
            legacy_backups_dir.join(LEGACY_DATABASE_FILE_NAME),
            b"archived database copy",
        )
        .expect("write nested backup fixture");

        let legacy_database = legacy_dir.join(LEGACY_DATABASE_FILE_NAME);
        let source_connection =
            rusqlite::Connection::open(&legacy_database).expect("create legacy database fixture");
        source_connection
            .execute_batch(
                "CREATE TABLE migration_probe (value TEXT NOT NULL);\
                 INSERT INTO migration_probe(value) VALUES ('preserved');",
            )
            .expect("seed legacy database fixture");
        drop(source_connection);
        let original_database_bytes = fs::read(&legacy_database).expect("read legacy database");

        assert!(migrate_legacy_app_data_if_needed().expect("migrate legacy data"));

        let libra_dir = temp.path().join(APP_CONFIG_DIR_NAME);
        assert_eq!(
            fs::read(libra_dir.join("config.json")).expect("read migrated config"),
            br#"{"version":2}"#
        );
        assert_eq!(
            fs::read(libra_dir.join("skills").join("sample.md")).expect("read migrated skill"),
            b"legacy skill"
        );
        assert_eq!(
            fs::read(libra_dir.join("backups").join(LEGACY_DATABASE_FILE_NAME))
                .expect("read nested backup"),
            b"archived database copy"
        );

        let migrated_connection =
            rusqlite::Connection::open(libra_dir.join(APP_DATABASE_FILE_NAME))
                .expect("open migrated Libra database");
        let value: String = migrated_connection
            .query_row("SELECT value FROM migration_probe", [], |row| row.get(0))
            .expect("query migrated database");
        assert_eq!(value, "preserved");
        assert_eq!(fs::read(&legacy_database).unwrap(), original_database_bytes);
        assert!(legacy_dir.is_dir());
    }
}

/// 复制文件
pub fn copy_file(from: &Path, to: &Path) -> Result<(), AppError> {
    fs::copy(from, to).map_err(|e| AppError::IoContext {
        context: format!("复制文件失败 ({} -> {})", from.display(), to.display()),
        source: e,
    })?;
    Ok(())
}

/// 删除文件
pub fn delete_file(path: &Path) -> Result<(), AppError> {
    if path.exists() {
        fs::remove_file(path).map_err(|e| AppError::io(path, e))?;
    }
    Ok(())
}

/// 检查 Claude Code 配置状态
#[derive(Serialize, Deserialize)]
pub struct ConfigStatus {
    pub exists: bool,
    pub path: String,
}

/// 获取 Claude Code 配置状态
pub fn get_claude_config_status() -> ConfigStatus {
    let path = get_claude_settings_path();
    ConfigStatus {
        exists: path.exists(),
        path: path.to_string_lossy().to_string(),
    }
}
