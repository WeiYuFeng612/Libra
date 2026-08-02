//! Libra's self-contained Codex enhancement bridge.
//!
//! The large renderer patch is embedded in the portable binary. Libra keeps
//! its settings outside the original database so existing CC Switch data is
//! never migrated or overwritten.

use anyhow::{anyhow, Context, Result};
use axum::{
    extract::{OriginalUri, State},
    http::{HeaderMap, Method, StatusCode},
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;
use tauri::command;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tower_http::cors::{Any, CorsLayer};
use uuid::Uuid;

const DEFAULT_DEBUG_PORTS: &[u16] = &[9229, 9333, 9222];
const LIBRA_BRIDGE_ADDRESS: &str = "127.0.0.1:57321";

#[derive(Clone)]
struct LibraBridgeState {
    token: String,
}

static LIBRA_BRIDGE_STATE: LazyLock<Mutex<Option<LibraBridgeState>>> =
    LazyLock::new(|| Mutex::new(None));

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraEnhancementSettings {
    pub enhancements_enabled: bool,
    pub plugin_marketplace_unlock: bool,
    pub plugin_auto_expand: bool,
    pub model_whitelist_unlock: bool,
    pub session_delete: bool,
    pub markdown_export: bool,
    pub project_move: bool,
    pub fast_button: bool,
    pub fast_startup: bool,
    pub force_install_plugin: bool,
    pub computer_use_guard: bool,
}

impl Default for LibraEnhancementSettings {
    fn default() -> Self {
        Self {
            enhancements_enabled: true,
            plugin_marketplace_unlock: true,
            plugin_auto_expand: true,
            model_whitelist_unlock: true,
            session_delete: true,
            markdown_export: true,
            project_move: true,
            fast_button: true,
            fast_startup: false,
            force_install_plugin: false,
            computer_use_guard: false,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraApplyResult {
    pub status: String,
    pub message: String,
    pub debug_port: Option<u16>,
    pub injected: bool,
    pub asset_path: String,
}

#[derive(Debug, Deserialize)]
struct CdpTarget {
    #[serde(rename = "type")]
    target_type: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    url: String,
    #[serde(rename = "webSocketDebuggerUrl")]
    websocket_url: Option<String>,
}

fn settings_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("Libra")
        .join("libra-enhancements.json")
}

fn codex_home() -> PathBuf {
    std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".codex")))
        .unwrap_or_else(|| PathBuf::from(".codex"))
}

fn load_settings() -> LibraEnhancementSettings {
    fs::read_to_string(settings_path())
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save_settings(settings: &LibraEnhancementSettings) -> Result<()> {
    let path = settings_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).context("failed to create Libra settings directory")?;
    }
    fs::write(path, serde_json::to_string_pretty(settings)?)
        .context("failed to save Libra enhancement settings")
}

fn set_flag(settings: &mut LibraEnhancementSettings, key: &str, value: bool) -> Result<()> {
    match key {
        "enhancementsEnabled" => settings.enhancements_enabled = value,
        "pluginMarketplaceUnlock" => settings.plugin_marketplace_unlock = value,
        "pluginAutoExpand" => settings.plugin_auto_expand = value,
        "modelWhitelistUnlock" => settings.model_whitelist_unlock = value,
        "sessionDelete" => settings.session_delete = value,
        "markdownExport" => settings.markdown_export = value,
        "projectMove" => settings.project_move = value,
        "fastButton" => settings.fast_button = value,
        "fastStartup" => settings.fast_startup = value,
        "forceInstallPlugin" => settings.force_install_plugin = value,
        "computerUseGuard" => settings.computer_use_guard = value,
        _ => return Err(anyhow!("unknown Libra enhancement: {key}")),
    }
    Ok(())
}

fn bridge_session_id(payload: &Value) -> Option<String> {
    ["session_id", "sessionId", "id"]
        .iter()
        .find_map(|key| payload.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn find_codex_session(session_id: &str) -> Option<crate::session_manager::SessionMeta> {
    crate::session_manager::scan_sessions()
        .into_iter()
        .find(|session| session.provider_id == "codex" && session.session_id == session_id)
}

fn session_backup(
    meta: &crate::session_manager::SessionMeta,
    action: &str,
) -> Result<PathBuf, String> {
    let source_path = meta
        .source_path
        .as_deref()
        .filter(|path| !path.trim().is_empty())
        .ok_or_else(|| "Codex session source path is unavailable".to_string())?;
    let source = Path::new(source_path);
    let backup_dir = dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("Libra")
        .join("session-backups")
        .join(action);
    fs::create_dir_all(&backup_dir).map_err(|error| error.to_string())?;
    let filename = format!(
        "{}-{}.jsonl",
        meta.session_id,
        chrono::Utc::now().format("%Y%m%d-%H%M%S-%3f")
    );
    let destination = backup_dir.join(filename);
    fs::copy(source, &destination).map_err(|error| error.to_string())?;
    Ok(destination)
}

fn bridge_export_markdown(session_id: &str, title: &str) -> Value {
    let Some(meta) = find_codex_session(session_id) else {
        return json!({
            "status": "failed",
            "session_id": session_id,
            "message": "Codex session was not found locally",
            "filename": null,
            "markdown": null,
        });
    };
    let Some(source_path) = meta.source_path.as_deref() else {
        return json!({
            "status": "failed",
            "session_id": session_id,
            "message": "Codex session source path is unavailable",
            "filename": null,
            "markdown": null,
        });
    };
    let messages = match crate::session_manager::load_messages("codex", source_path) {
        Ok(messages) => messages,
        Err(error) => {
            return json!({
                "status": "failed",
                "session_id": session_id,
                "message": error,
                "filename": null,
                "markdown": null,
            });
        }
    };
    let display_title = if title.trim().is_empty() {
        meta.title.unwrap_or_else(|| session_id.to_string())
    } else {
        title.trim().to_string()
    };
    let mut markdown = format!("# {display_title}\n\n");
    for message in messages {
        let role = match message.role.as_str() {
            "user" => "User",
            "assistant" => "Assistant",
            "tool" => "Tool",
            _ => "Message",
        };
        markdown.push_str(&format!("## {role}\n\n{}\n\n", message.content.trim()));
    }
    let safe_title = display_title
        .chars()
        .map(|character| {
            if matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            ) {
                '_'
            } else {
                character
            }
        })
        .collect::<String>();
    let safe_title = safe_title.trim().trim_matches('.');
    let filename = if safe_title.is_empty() {
        format!("codex-{session_id}.md")
    } else {
        format!("{safe_title}.md")
    };
    json!({
        "status": "exported",
        "session_id": session_id,
        "message": "Markdown exported",
        "filename": filename,
        "markdown": markdown,
    })
}

fn bridge_delete_session(session_id: &str) -> Value {
    let Some(meta) = find_codex_session(session_id) else {
        return json!({
            "status": "failed",
            "session_id": session_id,
            "message": "Codex session was not found locally",
        });
    };
    let backup_path = match session_backup(&meta, "delete") {
        Ok(path) => path,
        Err(error) => {
            return json!({
                "status": "failed",
                "session_id": session_id,
                "message": format!("Could not back up Codex session: {error}"),
            });
        }
    };
    let Some(source_path) = meta.source_path.as_deref() else {
        return json!({
            "status": "failed",
            "session_id": session_id,
            "message": "Codex session source path is unavailable",
        });
    };
    match crate::session_manager::delete_session("codex", session_id, source_path) {
        Ok(true) => json!({
            "status": "local_deleted",
            "session_id": session_id,
            "message": "Codex session deleted. A Libra backup was created.",
            "backup_path": backup_path,
        }),
        Ok(false) => json!({
            "status": "failed",
            "session_id": session_id,
            "message": "Codex session was not deleted",
        }),
        Err(error) => json!({
            "status": "failed",
            "session_id": session_id,
            "message": error,
        }),
    }
}

fn bridge_move_session(session_id: &str, target_cwd: &str) -> Value {
    let target = Path::new(target_cwd);
    if !target.is_dir() {
        return json!({
            "status": "failed",
            "session_id": session_id,
            "message": "The destination Codex project directory does not exist",
        });
    }
    let Some(meta) = find_codex_session(session_id) else {
        return json!({
            "status": "failed",
            "session_id": session_id,
            "message": "Codex session was not found locally",
        });
    };
    let Some(source_path) = meta.source_path.as_deref() else {
        return json!({
            "status": "failed",
            "session_id": session_id,
            "message": "Codex session source path is unavailable",
        });
    };
    let backup_path = match session_backup(&meta, "move") {
        Ok(path) => path,
        Err(error) => {
            return json!({
                "status": "failed",
                "session_id": session_id,
                "message": format!("Could not back up Codex session: {error}"),
            });
        }
    };
    let source = Path::new(source_path);
    let contents = match fs::read_to_string(source) {
        Ok(contents) => contents,
        Err(error) => {
            return json!({
                "status": "failed",
                "session_id": session_id,
                "message": format!("Could not read Codex session: {error}"),
            });
        }
    };
    let mut changed = false;
    let mut lines = Vec::new();
    for line in contents.lines() {
        let mut value = match serde_json::from_str::<Value>(line) {
            Ok(value) => value,
            Err(_) => {
                lines.push(line.to_string());
                continue;
            }
        };
        let is_matching_meta = value.get("type").and_then(Value::as_str) == Some("session_meta")
            && value
                .get("payload")
                .and_then(|payload| payload.get("id"))
                .and_then(Value::as_str)
                == Some(session_id);
        if is_matching_meta {
            if let Some(payload) = value.get_mut("payload").and_then(Value::as_object_mut) {
                payload.insert("cwd".to_string(), Value::String(target_cwd.to_string()));
                changed = true;
            }
        }
        lines.push(serde_json::to_string(&value).unwrap_or_else(|_| line.to_string()));
    }
    if !changed {
        return json!({
            "status": "failed",
            "session_id": session_id,
            "message": "Codex session metadata could not be updated",
        });
    }
    let mut updated = lines.join("\n");
    if contents.ends_with('\n') {
        updated.push('\n');
    }
    if let Err(error) = crate::config::atomic_write(source, updated.as_bytes()) {
        return json!({
            "status": "failed",
            "session_id": session_id,
            "message": format!("Could not update Codex session: {error}"),
        });
    }
    let updated_at = meta.last_active_at.or(meta.created_at).unwrap_or_default();
    json!({
        "status": "moved",
        "session_id": session_id,
        "message": "Codex session moved to the selected project.",
        "updated_at_ms": updated_at,
        "backup_path": backup_path,
    })
}

fn bridge_sort_key(session_id: &str) -> Value {
    let Some(meta) = find_codex_session(session_id) else {
        return json!({ "status": "failed", "session_id": session_id });
    };
    json!({
        "status": "ok",
        "session_id": session_id,
        "updated_at_ms": meta.last_active_at.or(meta.created_at).unwrap_or_default(),
        "created_at_ms": meta.created_at.unwrap_or_default(),
    })
}

fn bridge_model_catalog() -> Value {
    let configured_model = fs::read_to_string(codex_home().join("config.toml"))
        .ok()
        .and_then(|contents| contents.parse::<toml::Value>().ok())
        .and_then(|config| {
            config
                .get("model")
                .and_then(toml::Value::as_str)
                .map(str::to_string)
        });
    let mut models = std::env::var("LIBRA_CODEX_MODELS")
        .ok()
        .map(|value| {
            value
                .split([',', '\n', '\r'])
                .map(str::trim)
                .filter(|model| !model.is_empty())
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if let Some(model) = configured_model.as_ref() {
        if !models.contains(model) {
            models.insert(0, model.clone());
        }
    }
    json!({
        "status": "ok",
        "model": configured_model.clone().unwrap_or_default(),
        "default_model": configured_model.unwrap_or_default(),
        "model_provider": "",
        "provider_name": "",
        "models": models,
        "sources": ["Libra portable"],
    })
}

fn bridge_settings_response() -> Value {
    serde_json::to_value(load_settings()).unwrap_or_else(|_| {
        json!({
            "enhancementsEnabled": false,
        })
    })
}

fn bridge_update_settings(payload: Value) -> Value {
    let mut settings = load_settings();
    let mut changed = false;
    if let Some(values) = payload.as_object() {
        for (key, value) in values {
            if let Some(value) = value.as_bool() {
                if set_flag(&mut settings, key, value).is_ok() {
                    changed = true;
                }
            }
        }
    }
    if changed {
        if let Err(error) = save_settings(&settings) {
            return json!({ "status": "failed", "message": error.to_string() });
        }
    }
    serde_json::to_value(settings).unwrap_or_else(|_| json!({ "status": "failed" }))
}

fn libra_bridge_response(path: &str, payload: Value) -> Value {
    match path {
        "/settings/get" => bridge_settings_response(),
        "/settings/set" => bridge_update_settings(payload),
        "/backend/status" => json!({
            "status": "ok",
            "message": "Libra portable bridge connected",
            "version": "Libra",
        }),
        "/codex-model-catalog" | "/codex-config-model" => bridge_model_catalog(),
        "/delete" => bridge_session_id(&payload)
            .map(|session_id| bridge_delete_session(&session_id))
            .unwrap_or_else(
                || json!({ "status": "failed", "message": "Missing Codex session ID" }),
            ),
        "/export-markdown" => bridge_session_id(&payload)
            .map(|session_id| {
                let title = payload
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                bridge_export_markdown(&session_id, title)
            })
            .unwrap_or_else(
                || json!({ "status": "failed", "message": "Missing Codex session ID" }),
            ),
        "/move-thread-workspace" => bridge_session_id(&payload)
            .map(|session_id| {
                let target = payload
                    .get("target_cwd")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                bridge_move_session(&session_id, target)
            })
            .unwrap_or_else(
                || json!({ "status": "failed", "message": "Missing Codex session ID" }),
            ),
        "/thread-sort-key" => bridge_session_id(&payload)
            .map(|session_id| bridge_sort_key(&session_id))
            .unwrap_or_else(
                || json!({ "status": "failed", "message": "Missing Codex session ID" }),
            ),
        "/thread-sort-keys" => {
            let sort_keys = payload
                .get("sessions")
                .and_then(Value::as_array)
                .map(|sessions| {
                    sessions
                        .iter()
                        .filter_map(bridge_session_id)
                        .map(|session_id| bridge_sort_key(&session_id))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            json!({ "status": "ok", "sort_keys": sort_keys })
        }
        "/diagnostics/log" => json!({ "status": "ok" }),
        "/ads" => json!({ "status": "ok", "ads": [] }),
        "/user-scripts/list" => json!({
            "status": "ok",
            "enabled": false,
            "builtin_dir": "",
            "user_dir": "",
            "scripts": [],
        }),
        _ => json!({
            "status": "failed",
            "message": "This Codex++ route is not included in Libra portable.",
        }),
    }
}

async fn handle_libra_bridge_request(
    State(state): State<LibraBridgeState>,
    headers: HeaderMap,
    OriginalUri(uri): OriginalUri,
    Json(payload): Json<Value>,
) -> impl IntoResponse {
    let token = headers
        .get("x-libra-bridge-token")
        .and_then(|value| value.to_str().ok());
    if token != Some(state.token.as_str()) {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "status": "failed", "message": "Unauthorized Libra bridge request" })),
        );
    }
    let path = uri.path().to_string();
    let result = tokio::task::spawn_blocking(move || libra_bridge_response(&path, payload))
        .await
        .unwrap_or_else(|error| json!({ "status": "failed", "message": error.to_string() }));
    (StatusCode::OK, Json(result))
}

async fn ensure_libra_bridge() -> Result<String> {
    if let Some(state) = LIBRA_BRIDGE_STATE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .as_ref()
        .cloned()
    {
        return Ok(state.token);
    }
    let listener = tokio::net::TcpListener::bind(LIBRA_BRIDGE_ADDRESS)
        .await
        .with_context(|| format!("failed to bind Libra bridge at {LIBRA_BRIDGE_ADDRESS}"))?;
    let state = LibraBridgeState {
        token: Uuid::new_v4().simple().to_string(),
    };
    let app = Router::new()
        .fallback(post(handle_libra_bridge_request))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods([Method::POST])
                .allow_headers(Any),
        )
        .with_state(state.clone());
    tokio::spawn(async move {
        if let Err(error) = axum::serve(listener, app).await {
            log::warn!("Libra bridge stopped: {error}");
        }
    });
    let mut bridge = LIBRA_BRIDGE_STATE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *bridge = Some(state.clone());
    Ok(state.token)
}

#[command]
pub fn get_libra_enhancements() -> LibraEnhancementSettings {
    load_settings()
}

#[command]
pub fn set_libra_enhancement(key: String, value: bool) -> Result<LibraEnhancementSettings, String> {
    let mut settings = load_settings();
    set_flag(&mut settings, &key, value).map_err(|error| error.to_string())?;
    save_settings(&settings).map_err(|error| error.to_string())?;
    Ok(settings)
}

#[command]
pub fn force_install_codex_plugin() -> Result<String, String> {
    let plugin_dir = codex_home().join("plugins").join("libra-enhancements");
    fs::create_dir_all(&plugin_dir).map_err(|error| error.to_string())?;
    let manifest = json!({
        "id": "libra-enhancements",
        "name": "Libra Codex Enhancements",
        "version": "1.0.0",
        "managedBy": "Libra",
        "features": ["fast", "markdown-export", "session-delete", "project-move", "plugin-marketplace", "model-whitelist"]
    });
    fs::write(
        plugin_dir.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    let mut settings = load_settings();
    settings.force_install_plugin = true;
    save_settings(&settings).map_err(|error| error.to_string())?;
    Ok(plugin_dir.display().to_string())
}

#[command]
pub fn set_computer_use_guard(enabled: bool) -> Result<bool, String> {
    let guard_path = codex_home().join("computer_use_guard.json");
    if let Some(parent) = guard_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let policy = json!({
        "enabled": enabled,
        "managedBy": "Libra",
        "policy": "deny-unsafe-native-actions"
    });
    fs::write(
        guard_path,
        serde_json::to_string_pretty(&policy).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    let mut settings = load_settings();
    settings.computer_use_guard = enabled;
    save_settings(&settings).map_err(|error| error.to_string())?;
    Ok(enabled)
}

async fn find_target() -> Result<(u16, CdpTarget)> {
    let ports = std::env::var("LIBRA_CODEX_DEBUG_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .map(|port| vec![port])
        .unwrap_or_else(|| DEFAULT_DEBUG_PORTS.to_vec());
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_millis(700))
        .build()?;
    for port in ports {
        let url = format!("http://127.0.0.1:{port}/json");
        let Ok(response) = client.get(url).send().await else {
            continue;
        };
        let Ok(targets) = response.json::<Vec<CdpTarget>>().await else {
            continue;
        };
        if let Some(target) = targets.into_iter().find(|target| {
            target.target_type == "page"
                && target
                    .websocket_url
                    .as_deref()
                    .is_some_and(|url| !url.is_empty())
                && format!("{} {}", target.title, target.url)
                    .to_ascii_lowercase()
                    .contains("codex")
        }) {
            return Ok((port, target));
        }
    }
    Err(anyhow!("Codex debugging port is unavailable"))
}

async fn send_cdp_command(
    websocket_url: &str,
    id: u64,
    method: &str,
    params: Value,
) -> Result<Value> {
    let (mut socket, _) =
        tokio::time::timeout(Duration::from_secs(4), connect_async(websocket_url))
            .await
            .context("connecting to Codex debugging port timed out")??;
    socket
        .send(Message::Text(
            json!({ "id": id, "method": method, "params": params })
                .to_string()
                .into(),
        ))
        .await
        .context("sending Codex debugging command failed")?;
    while let Some(message) = socket.next().await {
        let Message::Text(text) = message.context("reading Codex debugging response failed")?
        else {
            continue;
        };
        let value: Value =
            serde_json::from_str(&text).context("invalid Codex debugging response")?;
        if value.get("id").and_then(Value::as_u64) == Some(id) {
            if let Some(error) = value.get("error") {
                return Err(anyhow!("Codex debugging command failed: {error}"));
            }
            return Ok(value);
        }
    }
    Err(anyhow!("Codex debugging connection closed"))
}

fn injection_prelude(settings: &LibraEnhancementSettings, bridge_token: &str) -> String {
    let local_settings = json!({
        "enhancementsEnabled": settings.enhancements_enabled,
        "pluginMarketplaceUnlock": settings.plugin_marketplace_unlock,
        "pluginAutoExpand": settings.plugin_auto_expand,
        "modelWhitelistUnlock": settings.model_whitelist_unlock,
        "sessionDelete": settings.session_delete,
        "markdownExport": settings.markdown_export,
        "projectMove": settings.project_move,
        "serviceTierControls": settings.fast_button,
        "fastStartup": settings.fast_startup,
    });
    format!(
        "(() => {{ window.__LIBRA_ENHANCEMENTS_ENABLED__ = {}; window.__LIBRA_BRIDGE_TOKEN__ = {}; window.__CODEX_PLUS_VERSION__ = 'Libra'; window.__CODEX_PLUS_BUILD__ = 'portable'; window.__CODEX_PLUS_FAST_STARTUP__ = {{ enabled: {}, statsigTimeoutMs: 800 }}; try {{ localStorage.setItem('codexPlusSettings', {}); }} catch {{}} }})();",
        settings.enhancements_enabled,
        serde_json::to_string(bridge_token).unwrap_or_else(|_| "''".to_string()),
        settings.fast_startup,
        serde_json::to_string(&local_settings).unwrap_or_else(|_| "{}".to_string())
    )
}

#[command]
pub async fn apply_libra_enhancements() -> Result<LibraApplyResult, String> {
    let settings = load_settings();
    let asset_path = "assets/inject/renderer-inject.js".to_string();
    let asset_destination = codex_home().join("libra").join("renderer-inject.js");
    if let Some(parent) = asset_destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(
        &asset_destination,
        include_str!("../assets/renderer-inject.js"),
    )
    .map_err(|error| error.to_string())?;

    if !settings.enhancements_enabled {
        return Ok(LibraApplyResult {
            status: "disabled".to_string(),
            message: "Libra enhancements are disabled. Refresh or reopen Codex to return to its original page.".to_string(),
            debug_port: None,
            injected: false,
            asset_path,
        });
    }

    let bridge_token = ensure_libra_bridge()
        .await
        .map_err(|error| error.to_string())?;

    let (port, target) = match find_target().await {
        Ok(value) => value,
        Err(error) => {
            return Ok(LibraApplyResult {
                status: "unavailable".to_string(),
                message: format!("Enhancement asset is ready, but {}", error),
                debug_port: None,
                injected: false,
                asset_path,
            });
        }
    };
    let websocket_url = target
        .websocket_url
        .ok_or_else(|| "Codex page has no debugging websocket".to_string())?;
    let source = format!(
        "{}\n{}",
        injection_prelude(&settings, &bridge_token),
        include_str!("../assets/renderer-inject.js")
    );
    send_cdp_command(
        &websocket_url,
        1,
        "Page.addScriptToEvaluateOnNewDocument",
        json!({ "source": source }),
    )
    .await
    .map_err(|error| error.to_string())?;
    send_cdp_command(
        &websocket_url,
        2,
        "Runtime.evaluate",
        json!({ "expression": source, "allowUnsafeEvalBlockedByCSP": true }),
    )
    .await
    .map_err(|error| error.to_string())?;
    Ok(LibraApplyResult {
        status: "ok".to_string(),
        message: format!("Libra enhancements were injected into Codex on port {port}"),
        debug_port: Some(port),
        injected: true,
        asset_path,
    })
}

#[command]
pub fn libra_injection_asset_path() -> String {
    Path::new("assets/inject/renderer-inject.js")
        .display()
        .to_string()
}
