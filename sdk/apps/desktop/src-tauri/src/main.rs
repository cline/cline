#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use futures_util::{SinkExt, StreamExt};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::ffi::CStr;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};
use tokio_tungstenite::{accept_async, tungstenite::Message, WebSocketStream};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamChunkEvent {
    session_id: String,
    stream: String,
    chunk: String,
    ts: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionEndedEvent {
    session_id: String,
    reason: String,
    ts: u64,
}

#[derive(Debug)]
struct SessionProcess {
    child: Child,
    stdin: Option<ChildStdin>,
}

#[derive(Default)]
struct SessionStore {
    counter: AtomicU64,
    sessions: Mutex<HashMap<String, SessionProcess>>,
}

#[derive(Default)]
struct ChatWsBridgeState {
    endpoint: Mutex<Option<String>>,
    clients: Mutex<HashMap<u64, UnboundedSender<String>>>,
    next_client_id: AtomicU64,
}

#[derive(Clone)]
struct AppContext {
    launch_cwd: String,
    workspace_root: String,
}

const DEFAULT_RPC_ADDRESS: &str = "127.0.0.1:4317";
const DEFAULT_RPC_CLIENT_ID: &str = "desktop-tauri";
const DEFAULT_RPC_CLIENT_TYPE: &str = "desktop";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionStorageOptions {
    home_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartSessionRequest {
    workspace_root: String,
    cwd: Option<String>,
    provider: String,
    model: String,
    #[serde(default = "default_agent_mode")]
    mode: String,
    api_key: String,
    prompt: Option<String>,
    system_prompt: Option<String>,
    max_iterations: Option<u32>,
    enable_tools: bool,
    enable_spawn: bool,
    enable_teams: bool,
    auto_approve_tools: Option<bool>,
    team_name: String,
    mission_step_interval: u32,
    mission_time_interval_ms: u64,
    #[serde(default)]
    sessions: Option<SessionStorageOptions>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatRunTurnRequest {
    config: StartSessionRequest,
    #[serde(default)]
    messages: Vec<Value>,
    prompt: String,
    #[serde(default)]
    attachments: Option<ChatTurnAttachments>,
}

fn default_agent_mode() -> String {
    "act".to_string()
}

fn resolve_home_dir() -> Option<String> {
    for key in ["HOME", "USERPROFILE"] {
        if let Ok(value) = std::env::var(key) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }

    #[cfg(unix)]
    unsafe {
        let passwd = libc::getpwuid(libc::geteuid());
        if !passwd.is_null() {
            let dir_ptr = (*passwd).pw_dir;
            if !dir_ptr.is_null() {
                if let Ok(dir) = CStr::from_ptr(dir_ptr).to_str() {
                    let trimmed = dir.trim();
                    if !trimmed.is_empty() {
                        return Some(trimmed.to_string());
                    }
                }
            }
        }
    }

    None
}

fn ensure_start_session_home_dir(config: &mut StartSessionRequest) {
    let already_set = config
        .sessions
        .as_ref()
        .and_then(|sessions| sessions.home_dir.as_ref())
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    if already_set {
        return;
    }

    let home_dir = resolve_home_dir();
    if home_dir.is_none() {
        return;
    }

    match config.sessions.as_mut() {
        Some(sessions) => {
            sessions.home_dir = home_dir;
        }
        None => {
            config.sessions = Some(SessionStorageOptions { home_dir });
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatTurnAttachments {
    #[serde(default)]
    user_images: Vec<String>,
    #[serde(default)]
    user_files: Vec<ChatTurnAttachmentFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatTurnAttachmentFile {
    name: String,
    content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatUsage {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    cache_read_tokens: Option<u64>,
    cache_write_tokens: Option<u64>,
    total_cost: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatTurnResult {
    text: String,
    usage: Option<ChatUsage>,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    total_cost: Option<f64>,
    iterations: Option<u64>,
    finish_reason: Option<String>,
    #[serde(default)]
    messages: Vec<Value>,
    #[serde(default)]
    tool_calls: Vec<ChatToolCallResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatToolCallResult {
    name: String,
    input: Option<Value>,
    output: Option<Value>,
    error: Option<String>,
    duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatRuntimeBridgeLine {
    #[serde(rename = "type")]
    line_type: String,
    request_id: Option<String>,
    response: Option<Value>,
    result: Option<ChatTurnResult>,
    session_id: Option<String>,
    chunk: Option<String>,
    tool_call_id: Option<String>,
    tool_name: Option<String>,
    input: Option<Value>,
    output: Option<Value>,
    error: Option<String>,
    duration_ms: Option<u64>,
    message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatRuntimeBridgeCommandEnvelope {
    #[serde(rename = "type")]
    message_type: String,
    request_id: String,
    command: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderOauthLoginResponse {
    provider: String,
    access_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatSessionCommandRequest {
    action: String,
    session_id: Option<String>,
    prompt: Option<String>,
    config: Option<StartSessionRequest>,
    #[serde(default)]
    attachments: Option<ChatTurnAttachments>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatSessionCommandResponse {
    session_id: Option<String>,
    result: Option<ChatTurnResult>,
    ok: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatWsCommandEnvelope {
    request_id: String,
    request: ChatSessionCommandRequest,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatWsResponseEnvelope {
    #[serde(rename = "type")]
    message_type: String,
    request_id: String,
    response: Option<ChatSessionCommandResponse>,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatWsEventEnvelope {
    #[serde(rename = "type")]
    message_type: String,
    event: StreamChunkEvent,
}

impl ChatWsBridgeState {
    fn set_endpoint(&self, endpoint: String) {
        if let Ok(mut guard) = self.endpoint.lock() {
            *guard = Some(endpoint);
        }
    }

    fn endpoint(&self) -> Option<String> {
        self.endpoint
            .lock()
            .ok()
            .and_then(|value| value.as_ref().cloned())
    }

    fn register_client(&self, sender: UnboundedSender<String>) -> u64 {
        let client_id = self.next_client_id.fetch_add(1, Ordering::Relaxed) + 1;
        if let Ok(mut clients) = self.clients.lock() {
            clients.insert(client_id, sender);
        }
        client_id
    }

    fn unregister_client(&self, client_id: u64) {
        if let Ok(mut clients) = self.clients.lock() {
            clients.remove(&client_id);
        }
    }

    fn broadcast_text(&self, payload: String) {
        let mut stale_clients: Vec<u64> = Vec::new();
        if let Ok(clients) = self.clients.lock() {
            for (client_id, sender) in clients.iter() {
                if sender.send(payload.clone()).is_err() {
                    stale_clients.push(*client_id);
                }
            }
        }
        if stale_clients.is_empty() {
            return;
        }
        if let Ok(mut clients) = self.clients.lock() {
            for client_id in stale_clients {
                clients.remove(&client_id);
            }
        }
    }

    fn broadcast_chunk_event(&self, event: StreamChunkEvent) {
        let envelope = ChatWsEventEnvelope {
            message_type: "chat_event".to_string(),
            event,
        };
        if let Ok(encoded) = serde_json::to_string(&envelope) {
            self.broadcast_text(encoded);
        }
    }
}

#[derive(Debug, Clone)]
struct ChatRuntimeSession {
    config: StartSessionRequest,
    messages: Vec<Value>,
    busy: bool,
    started_at: u64,
    ended_at: Option<u64>,
    status: String,
    prompt: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpServerRecord {
    name: String,
    transport_type: String,
    disabled: bool,
    command: Option<String>,
    args: Option<Vec<String>>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    url: Option<String>,
    headers: Option<HashMap<String, String>>,
    metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpServersResponse {
    settings_path: String,
    has_settings_file: bool,
    servers: Vec<McpServerRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpServerUpsertInput {
    name: String,
    transport_type: String,
    command: Option<String>,
    args: Option<Vec<String>>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    url: Option<String>,
    headers: Option<HashMap<String, String>>,
    disabled: Option<bool>,
    metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuleListItem {
    name: String,
    instructions: String,
    path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkflowListItem {
    id: String,
    name: String,
    instructions: String,
    path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillListItem {
    name: String,
    description: Option<String>,
    instructions: String,
    path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentListItem {
    name: String,
    path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HookListItem {
    file_name: String,
    hook_event_name: Option<String>,
    path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UserInstructionListsResponse {
    workspace_root: String,
    rules: Vec<RuleListItem>,
    workflows: Vec<WorkflowListItem>,
    skills: Vec<SkillListItem>,
    agents: Vec<AgentListItem>,
    hooks: Vec<HookListItem>,
    warnings: Vec<String>,
}

#[derive(Default)]
struct ChatSessionStore {
    sessions: Mutex<HashMap<String, ChatRuntimeSession>>,
    runtime_bridge: Mutex<Option<ChatRuntimeBridge>>,
    stream_subscriptions: Mutex<HashSet<String>>,
}

struct ChatRuntimeBridge {
    child: Child,
    stdin: ChildStdin,
    next_request_id: u64,
    pending: Arc<Mutex<HashMap<String, std::sync::mpsc::Sender<Result<Value, String>>>>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TeamHistoryItem {
    ts: String,
    #[serde(rename = "type")]
    item_type: String,
    task: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessContext {
    workspace_root: String,
    cwd: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitBranchContext {
    branch: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitBranchesContext {
    current: String,
    branches: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionHookEvent {
    ts: String,
    hook_name: String,
    agent_id: Option<String>,
    task_id: Option<String>,
    parent_agent_id: Option<String>,
    iteration: Option<u64>,
    tool_name: Option<String>,
    tool_input: Option<Value>,
    tool_output: Option<Value>,
    tool_error: Option<String>,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    total_cost: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToolApprovalRequestItem {
    request_id: String,
    session_id: String,
    created_at: String,
    tool_call_id: String,
    tool_name: String,
    input: Option<Value>,
    iteration: Option<u64>,
    agent_id: Option<String>,
    conversation_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CliDiscoveredSession {
    session_id: String,
    title: String,
    status: String,
    provider: String,
    model: String,
    cwd: String,
    workspace_root: String,
    team_name: Option<String>,
    parent_session_id: Option<String>,
    parent_agent_id: Option<String>,
    agent_id: Option<String>,
    conversation_id: Option<String>,
    is_subagent: bool,
    prompt: Option<String>,
    started_at: String,
    ended_at: Option<String>,
    interactive: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HydratedChatMessage {
    id: String,
    session_id: Option<String>,
    role: String,
    content: String,
    created_at: u64,
    meta: Option<HydratedChatMessageMeta>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HydratedChatMessageMeta {
    tool_name: Option<String>,
    hook_event_name: Option<String>,
}

fn resolve_api_key(provider: &str, explicit_api_key: &str) -> Option<String> {
    if !explicit_api_key.trim().is_empty() {
        return Some(explicit_api_key.to_string());
    }

    match provider {
        "anthropic" => std::env::var("ANTHROPIC_API_KEY").ok(),
        "cline" => std::env::var("CLINE_API_KEY").ok(),
        "gemini" => std::env::var("GOOGLE_GENERATIVE_AI_API_KEY")
            .ok()
            .or_else(|| std::env::var("GEMINI_API_KEY").ok()),
        "openrouter" => std::env::var("OPENROUTER_API_KEY").ok(),
        "openai" => std::env::var("OPENAI_API_KEY").ok(),
        _ => std::env::var("ANTHROPIC_API_KEY")
            .ok()
            .or_else(|| std::env::var("OPENAI_API_KEY").ok()),
    }
}

fn is_oauth_managed_provider(provider: &str) -> bool {
    matches!(
        provider.trim().to_ascii_lowercase().as_str(),
        "cline" | "oca" | "openai-codex"
    )
}

fn resolve_chat_config_api_key(config: &mut StartSessionRequest) -> Result<(), String> {
    let provider_id = config.provider.trim();
    let explicit_api_key = config.api_key.trim();
    if !explicit_api_key.is_empty() {
        config.api_key = explicit_api_key.to_string();
    } else if let Some(effective_api_key) = resolve_api_key(provider_id, explicit_api_key) {
        config.api_key = effective_api_key;
    } else if is_oauth_managed_provider(provider_id) {
        // OAuth providers read credentials from persisted provider settings.
        config.api_key = String::new();
    } else {
        return Err(format!(
            "Missing API key for provider '{}'. Provide one in the UI or set the required env var before launching Tauri.",
            config.provider
        ));
    }
    config.mode = if config.mode.trim().eq_ignore_ascii_case("plan") {
        "plan".to_string()
    } else {
        "act".to_string()
    };
    Ok(())
}

fn resolve_workspace_root(launch_cwd: &str) -> String {
    let output = Command::new("git")
        .arg("-C")
        .arg(launch_cwd)
        .arg("rev-parse")
        .arg("--show-toplevel")
        .output();

    match output {
        Ok(result) if result.status.success() => {
            let value = String::from_utf8_lossy(&result.stdout).trim().to_string();
            if value.is_empty() {
                launch_cwd.to_string()
            } else {
                value
            }
        }
        _ => launch_cwd.to_string(),
    }
}

fn resolve_git_branch(cwd: &str) -> String {
    let branch_output = Command::new("git")
        .arg("-C")
        .arg(cwd)
        .arg("branch")
        .arg("--show-current")
        .output();

    if let Ok(result) = branch_output {
        if result.status.success() {
            let branch = String::from_utf8_lossy(&result.stdout).trim().to_string();
            if !branch.is_empty() {
                return branch;
            }
        }
    }

    let detached_output = Command::new("git")
        .arg("-C")
        .arg(cwd)
        .arg("rev-parse")
        .arg("--short")
        .arg("HEAD")
        .output();

    if let Ok(result) = detached_output {
        if result.status.success() {
            let short_sha = String::from_utf8_lossy(&result.stdout).trim().to_string();
            if !short_sha.is_empty() {
                return format!("detached@{short_sha}");
            }
        }
    }

    "no-git".to_string()
}

fn resolve_git_branches(cwd: &str) -> GitBranchesContext {
    let output = Command::new("git")
        .arg("-C")
        .arg(cwd)
        .arg("branch")
        .arg("--format=%(refname:short)")
        .output();

    let mut branches: Vec<String> = Vec::new();
    if let Ok(result) = output {
        if result.status.success() {
            branches = String::from_utf8_lossy(&result.stdout)
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(ToString::to_string)
                .collect();
        }
    }
    branches.sort();
    branches.dedup();

    GitBranchesContext {
        current: resolve_git_branch(cwd),
        branches,
    }
}

fn run_checkout_git_branch(cwd: &str, branch: &str) -> Result<(), String> {
    let trimmed = branch.trim();
    if trimmed.is_empty() {
        return Err("branch is required".to_string());
    }

    let output = Command::new("git")
        .arg("-C")
        .arg(cwd)
        .arg("checkout")
        .arg(trimmed)
        .output()
        .map_err(|e| format!("failed to run git checkout: {e}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        Err("git checkout failed".to_string())
    } else {
        Err(stderr)
    }
}

fn send_abort_signal(child: &mut Child) -> Result<(), String> {
    #[cfg(unix)]
    {
        let pid = child.id() as i32;
        let rc = unsafe { libc::kill(pid, libc::SIGINT) };
        if rc == 0 {
            return Ok(());
        }
        return Err(format!(
            "failed to send SIGINT: {}",
            std::io::Error::last_os_error()
        ));
    }

    #[cfg(not(unix))]
    {
        child
            .kill()
            .map_err(|e| format!("failed to abort process: {e}"))?;
        Ok(())
    }
}

fn send_terminate_signal(child: &mut Child) -> Result<(), String> {
    #[cfg(unix)]
    {
        let pid = child.id() as i32;
        let rc = unsafe { libc::kill(pid, libc::SIGTERM) };
        if rc == 0 {
            return Ok(());
        }
        return Err(format!(
            "failed to send SIGTERM: {}",
            std::io::Error::last_os_error()
        ));
    }

    #[cfg(not(unix))]
    {
        child
            .kill()
            .map_err(|e| format!("failed to terminate process: {e}"))?;
        Ok(())
    }
}

fn wait_for_exit(child: &mut Child, attempts: usize, sleep_ms: u64) -> Result<bool, String> {
    for _ in 0..attempts {
        if child
            .try_wait()
            .map_err(|e| format!("failed checking session status: {e}"))?
            .is_some()
        {
            return Ok(true);
        }
        thread::sleep(std::time::Duration::from_millis(sleep_ms));
    }
    Ok(false)
}

fn now_ms() -> u64 {
    let now = std::time::SystemTime::now();
    now.duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}

fn value_as_string(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(if *flag { "true" } else { "false" }.to_string()),
        _ => None,
    }
}

fn json_string_field(value: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(found) = value.get(key).and_then(value_as_string) {
            return Some(found);
        }
    }
    None
}

fn normalize_chat_finish_status(status: Option<&str>) -> String {
    let Some(raw) = status else {
        return "completed".to_string();
    };
    let normalized = raw.trim().to_lowercase();
    if normalized.is_empty() {
        return "completed".to_string();
    }
    if normalized.contains("cancel")
        || normalized.contains("abort")
        || normalized.contains("interrupt")
    {
        return "cancelled".to_string();
    }
    if normalized.contains("fail") || normalized.contains("error") {
        return "failed".to_string();
    }
    if normalized.contains("run") || normalized.contains("start") {
        return "running".to_string();
    }
    if normalized.contains("complete")
        || normalized.contains("done")
        || normalized.contains("stop")
        || normalized.contains("max_iteration")
        || normalized.contains("max-iteration")
    {
        return "completed".to_string();
    }
    "idle".to_string()
}

fn kanban_data_root() -> Option<PathBuf> {
    if let Ok(value) = std::env::var("CLINE_KANBAN_DATA_DIR") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }

    let home = resolve_home_dir()?;
    Some(
        PathBuf::from(home)
            .join(".cline")
            .join("apps")
            .join("kanban"),
    )
}

fn session_log_path(session_id: &str) -> Option<PathBuf> {
    let base = kanban_data_root()?;
    Some(base.join("sessions").join(format!("{session_id}.jsonl")))
}

fn session_hook_log_path(session_id: &str) -> Option<PathBuf> {
    let base = kanban_data_root()?;
    Some(base.join("hooks").join(format!("{session_id}.jsonl")))
}

fn shared_session_data_dir() -> Option<PathBuf> {
    if let Ok(value) = std::env::var("CLINE_SESSION_DATA_DIR") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    let home = resolve_home_dir()?;
    Some(
        PathBuf::from(home)
            .join(".cline")
            .join("data")
            .join("sessions"),
    )
}

fn root_session_db_path() -> Option<PathBuf> {
    let home = resolve_home_dir()?;
    Some(
        PathBuf::from(home)
            .join(".cline")
            .join("data")
            .join("sessions")
            .join("sessions.db"),
    )
}

fn shared_session_log_path(session_id: &str) -> Option<PathBuf> {
    shared_session_artifact_path(session_id, "log")
}

fn shared_session_hook_path(session_id: &str) -> Option<PathBuf> {
    shared_session_artifact_path(session_id, "hooks.jsonl")
}

fn shared_session_messages_path(session_id: &str) -> Option<PathBuf> {
    shared_session_artifact_path(session_id, "messages.json")
}

fn shared_session_artifact_write_path(session_id: &str, suffix: &str) -> Option<PathBuf> {
    let base = shared_session_data_dir()?;
    let file_name = format!("{session_id}.{suffix}");
    Some(base.join(session_id).join(file_name))
}

fn shared_session_messages_write_path(session_id: &str) -> Option<PathBuf> {
    shared_session_artifact_write_path(session_id, "messages.json")
}

fn append_chat_usage_hook_event(session_id: &str, result: &ChatTurnResult) {
    let Some(path) = shared_session_artifact_write_path(session_id, "hooks.jsonl") else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let input_tokens = result
        .usage
        .as_ref()
        .and_then(|usage| usage.input_tokens)
        .or(result.input_tokens);
    let output_tokens = result
        .usage
        .as_ref()
        .and_then(|usage| usage.output_tokens)
        .or(result.output_tokens);
    let total_cost = result
        .usage
        .as_ref()
        .and_then(|usage| usage.total_cost)
        .or(result.total_cost)
        .filter(|value| value.is_finite() && *value >= 0.0);

    let payload = serde_json::json!({
        "ts": now_ms().to_string(),
        "hookName": "agent_end",
        "taskId": session_id,
        "usage": {
            "inputTokens": input_tokens.unwrap_or(0),
            "outputTokens": output_tokens.unwrap_or(0),
            "totalCost": total_cost,
        }
    });

    if let Ok(line) = serde_json::to_string(&payload) {
        if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = file.write_all(format!("{line}\n").as_bytes());
        }
    }
}

fn read_persisted_chat_messages(session_id: &str) -> Result<Option<Vec<Value>>, String> {
    let Some(path) = shared_session_messages_path(session_id) else {
        return Ok(None);
    };
    if !path.exists() {
        return Ok(None);
    }

    let raw =
        fs::read_to_string(path).map_err(|e| format!("failed reading session messages: {e}"))?;
    let parsed = serde_json::from_str::<Value>(&raw)
        .map_err(|e| format!("failed parsing session messages: {e}"))?;

    let messages = parsed
        .get("messages")
        .and_then(|v| v.as_array())
        .or_else(|| parsed.as_array())
        .cloned()
        .unwrap_or_default();

    Ok(Some(messages))
}

fn session_has_messages(messages: &[Value]) -> bool {
    !messages.is_empty()
}

fn derive_prompt_from_messages(messages: &[Value]) -> Option<String> {
    for message in messages {
        let role = message
            .get("role")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        if role != "user" {
            continue;
        }
        let content = stringify_message_content(message.get("content").unwrap_or(&Value::Null));
        let normalized = normalize_user_input_text(&content);
        let trimmed = normalized.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    None
}

fn normalize_user_input_text(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if let Some(open_idx) = trimmed.find("<user_input") {
        if let Some(open_end_rel) = trimmed[open_idx..].find('>') {
            let content_start = open_idx + open_end_rel + 1;
            if let Some(close_idx) = trimmed[content_start..].find("</user_input>") {
                return trimmed[content_start..content_start + close_idx]
                    .trim()
                    .to_string();
            }
        }
    }

    trimmed.to_string()
}

fn first_prompt_line(value: &str) -> Option<String> {
    let normalized = normalize_user_input_text(value);
    let line = normalized.lines().next().unwrap_or("").trim();
    if line.is_empty() {
        None
    } else {
        Some(line.to_string())
    }
}

fn derive_prompt_from_hook_file(path: &str) -> Option<String> {
    if path.trim().is_empty() || !Path::new(path).exists() {
        return None;
    }
    let raw = fs::read_to_string(path).ok()?;
    for line in raw.lines().rev() {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let hook_name = value
            .get("hookName")
            .or_else(|| value.get("hook_event_name"))
            .or_else(|| value.get("event"))
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if hook_name != "prompt_submit" {
            continue;
        }
        if let Some(prompt) = value
            .get("data")
            .and_then(|v| v.get("prompt"))
            .and_then(|v| v.as_str())
            .or_else(|| value.get("prompt").and_then(|v| v.as_str()))
        {
            if let Some(line) = first_prompt_line(prompt) {
                return Some(line);
            }
        }
    }
    None
}

fn derive_prompt_from_transcript_file(path: &str) -> Option<String> {
    if path.trim().is_empty() || !Path::new(path).exists() {
        return None;
    }
    let raw = fs::read_to_string(path).ok()?;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let normalized = trimmed.to_ascii_lowercase();
        if normalized.starts_with("user:") || normalized.starts_with("prompt:") {
            let candidate = trimmed
                .split_once(':')
                .map(|(_, rest)| rest.trim())
                .unwrap_or_default();
            if let Some(result) = first_prompt_line(candidate) {
                return Some(result);
            }
        }
    }
    None
}

fn title_from_metadata_json(raw: Option<&str>) -> Option<String> {
    let raw = raw?.trim();
    if raw.is_empty() {
        return None;
    }
    let parsed = serde_json::from_str::<Value>(raw).ok()?;
    let title = parsed.get("title").and_then(|value| value.as_str())?;
    let trimmed = title.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.chars().take(80).collect())
    }
}

fn derive_session_title(
    session_id: &str,
    is_subagent: bool,
    agent_id: Option<&str>,
    prompt: Option<&str>,
) -> String {
    if let Some(value) = prompt.and_then(first_prompt_line) {
        return value.chars().take(80).collect();
    }
    if is_subagent {
        let suffix = agent_id
            .and_then(|value| {
                let trimmed = value.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            })
            .unwrap_or(session_id);
        let tail = if suffix.len() > 6 {
            &suffix[suffix.len() - 6..]
        } else {
            suffix
        };
        return format!("Subagent_{tail}");
    }
    format!("Session_{session_id}")
}

fn stringify_message_content(value: &Value) -> String {
    if let Some(text) = value.as_str() {
        return text.to_string();
    }

    if let Some(array) = value.as_array() {
        let mut parts: Vec<String> = Vec::new();
        for block in array {
            if let Some(obj) = block.as_object() {
                let block_type = obj.get("type").and_then(|v| v.as_str()).unwrap_or_default();
                let piece = match block_type {
                    "text" => obj
                        .get("text")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    "thinking" => obj
                        .get("thinking")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    "tool_use" => {
                        let name = obj
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("tool_call");
                        format!("[tool] {name}")
                    }
                    "tool_result" => {
                        let result = obj.get("content").unwrap_or(&Value::Null);
                        let inner = stringify_message_content(result);
                        if inner.is_empty() {
                            "[tool_result]".to_string()
                        } else {
                            format!("[tool_result]\n{inner}")
                        }
                    }
                    "image" => "[image]".to_string(),
                    "redacted_thinking" => "[redacted_thinking]".to_string(),
                    _ => obj
                        .get("text")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string(),
                };
                if !piece.trim().is_empty() {
                    parts.push(piece);
                }
                continue;
            }

            if let Some(text) = block.as_str() {
                if !text.trim().is_empty() {
                    parts.push(text.to_string());
                }
            }
        }
        return parts.join("\n");
    }

    if let Some(obj) = value.as_object() {
        if let Some(text) = obj.get("text").and_then(|v| v.as_str()) {
            return text.to_string();
        }
    }

    String::new()
}

fn build_tool_payload_json(tool_name: &str, input: Value, result: Value, is_error: bool) -> String {
    serde_json::to_string(&serde_json::json!({
        "toolName": tool_name,
        "input": input,
        "result": result,
        "isError": is_error,
    }))
    .unwrap_or_else(|_| {
        format!(
            "{{\"toolName\":\"{}\",\"isError\":{}}}",
            tool_name.replace('"', "\\\""),
            is_error
        )
    })
}

fn flush_hydrated_text_parts(
    out: &mut Vec<HydratedChatMessage>,
    text_parts: &mut Vec<String>,
    session_id: &str,
    role: &str,
    message_id_base: &str,
    text_segment_index: &mut usize,
    ts: u64,
) {
    if text_parts.is_empty() {
        return;
    }
    let joined = text_parts.join("\n");
    text_parts.clear();
    if joined.trim().is_empty() {
        return;
    }
    out.push(HydratedChatMessage {
        id: format!("{message_id_base}_text_{text_segment_index}"),
        session_id: Some(session_id.to_string()),
        role: role.to_string(),
        content: joined,
        created_at: ts,
        meta: None,
    });
    *text_segment_index += 1;
}

fn tool_approval_dir() -> Option<PathBuf> {
    if let Ok(value) = std::env::var("CLINE_TOOL_APPROVAL_DIR") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    shared_session_data_dir().map(|base| base.join("tool-approvals"))
}

fn tool_approval_request_prefix(session_id: &str) -> String {
    format!("{session_id}.request.")
}

fn tool_approval_decision_path(session_id: &str, request_id: &str) -> Option<PathBuf> {
    let dir = tool_approval_dir()?;
    Some(dir.join(format!("{session_id}.decision.{request_id}.json")))
}

fn root_session_id_from(session_id: &str) -> &str {
    session_id
        .split_once("__")
        .map(|(root, _)| root)
        .unwrap_or(session_id)
}

fn find_artifact_under_dir(dir: &Path, file_name: &str, max_depth: usize) -> Option<PathBuf> {
    if !dir.exists() {
        return None;
    }
    let mut stack: Vec<(PathBuf, usize)> = vec![(dir.to_path_buf(), 0)];
    while let Some((current, depth)) = stack.pop() {
        let Ok(entries) = fs::read_dir(&current) else {
            continue;
        };
        for entry_result in entries {
            let Ok(entry) = entry_result else {
                continue;
            };
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_file() {
                if entry.file_name().to_string_lossy() == file_name {
                    return Some(path);
                }
                continue;
            }
            if file_type.is_dir() && depth < max_depth {
                stack.push((path, depth + 1));
            }
        }
    }
    None
}

fn shared_session_artifact_path(session_id: &str, suffix: &str) -> Option<PathBuf> {
    let base = shared_session_data_dir()?;
    let file_name = format!("{session_id}.{suffix}");

    let legacy = base.join(session_id).join(&file_name);
    if legacy.exists() {
        return Some(legacy);
    }

    let root_dir = base.join(root_session_id_from(session_id));
    if let Some(found) = find_artifact_under_dir(&root_dir, &file_name, 4) {
        return Some(found);
    }

    None
}

fn sql_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn load_related_cli_session_ids(session_id: &str) -> Result<Vec<String>, String> {
    let Some(db_path) = root_session_db_path() else {
        return Ok(vec![session_id.to_string()]);
    };
    if !db_path.exists() {
        return Ok(vec![session_id.to_string()]);
    }

    let id_quoted = sql_quote(session_id);
    let like_quoted = sql_quote(&format!("{session_id}__%"));
    let query = format!(
        "SELECT DISTINCT session_id FROM sessions \
         WHERE session_id = {id_quoted} \
            OR session_id LIKE {like_quoted} \
            OR parent_session_id = {id_quoted} \
            OR parent_session_id LIKE {like_quoted};"
    );

    let output = Command::new("sqlite3")
        .arg("-noheader")
        .arg(db_path.to_string_lossy().to_string())
        .arg(query)
        .output()
        .map_err(|e| format!("failed to query root sessions db for delete: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "failed to query root sessions db for delete".to_string()
        } else {
            format!("failed to query root sessions db for delete: {stderr}")
        });
    }

    let mut ids: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect();
    if ids.is_empty() {
        ids.push(session_id.to_string());
    }
    Ok(ids)
}

fn delete_cli_sessions_from_root_db(session_id: &str) -> Result<(), String> {
    let Some(db_path) = root_session_db_path() else {
        return Ok(());
    };
    if !db_path.exists() {
        return Ok(());
    }

    let id_quoted = sql_quote(session_id);
    let like_quoted = sql_quote(&format!("{session_id}__%"));
    let query = format!(
        "DELETE FROM sessions \
         WHERE session_id = {id_quoted} \
            OR session_id LIKE {like_quoted} \
            OR parent_session_id = {id_quoted} \
            OR parent_session_id LIKE {like_quoted};"
    );

    let output = Command::new("sqlite3")
        .arg(db_path.to_string_lossy().to_string())
        .arg(query)
        .output()
        .map_err(|e| format!("failed to delete from root sessions db: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "failed to delete from root sessions db".to_string()
        } else {
            format!("failed to delete from root sessions db: {stderr}")
        });
    }

    Ok(())
}

fn remove_persisted_session_artifacts(session_ids: &[String]) {
    if let Some(base) = shared_session_data_dir() {
        for session_id in session_ids {
            let session_dir = base.join(session_id);
            if session_dir.exists() {
                let _ = fs::remove_dir_all(&session_dir);
            }

            let file_suffixes = ["messages.json", "log", "hooks.jsonl"];
            for suffix in file_suffixes {
                let file_name = format!("{session_id}.{suffix}");
                if let Some(found) = find_artifact_under_dir(
                    &base.join(root_session_id_from(session_id)),
                    &file_name,
                    4,
                ) {
                    let _ = fs::remove_file(found);
                }
            }
        }
    }

    if let Some(dir) = tool_approval_dir() {
        if dir.exists() {
            if let Ok(entries) = fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if !path.is_file() {
                        continue;
                    }
                    let Some(name) = path.file_name().and_then(|v| v.to_str()) else {
                        continue;
                    };
                    if session_ids
                        .iter()
                        .any(|session_id| name.starts_with(&format!("{session_id}.")))
                    {
                        let _ = fs::remove_file(path);
                    }
                }
            }
        }
    }
}

fn resolve_cli_entrypoint_path(context: &AppContext) -> Option<PathBuf> {
    let candidates = [
        PathBuf::from(&context.workspace_root)
            .join("apps")
            .join("cli")
            .join("src")
            .join("index.ts"),
        PathBuf::from(&context.workspace_root)
            .join("packages")
            .join("cli")
            .join("src")
            .join("index.ts"),
        PathBuf::from(&context.workspace_root)
            .join("cli")
            .join("src")
            .join("index.ts"),
        PathBuf::from(&context.launch_cwd)
            .join("apps")
            .join("cli")
            .join("src")
            .join("index.ts"),
        PathBuf::from(&context.launch_cwd)
            .join("packages")
            .join("cli")
            .join("src")
            .join("index.ts"),
        PathBuf::from(&context.launch_cwd)
            .join("cli")
            .join("src")
            .join("index.ts"),
    ];

    candidates.into_iter().find(|path| path.exists())
}

fn resolve_workspace_cli_entrypoint_path(workspace_root: &str) -> Option<PathBuf> {
    let candidates = [
        PathBuf::from(workspace_root)
            .join("apps")
            .join("cli")
            .join("src")
            .join("index.ts"),
        PathBuf::from(workspace_root)
            .join("packages")
            .join("cli")
            .join("src")
            .join("index.ts"),
        PathBuf::from(workspace_root)
            .join("cli")
            .join("src")
            .join("index.ts"),
    ];

    candidates.into_iter().find(|path| path.exists())
}

fn resolve_cli_workdir(cli_entrypoint: &Path, context: &AppContext) -> PathBuf {
    cli_entrypoint
        .parent()
        .and_then(|p: &Path| p.parent())
        .map(|p: &Path| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from(&context.launch_cwd))
}

fn resolve_rpc_address() -> String {
    std::env::var("CLINE_RPC_ADDRESS")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_RPC_ADDRESS.to_string())
}

fn bun_binary_candidates() -> Vec<String> {
    let mut out: Vec<String> = Vec::new();

    if let Ok(value) = std::env::var("BUN_BIN") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            out.push(trimmed.to_string());
        }
    }

    out.push("bun".to_string());

    if let Ok(home) = std::env::var("HOME") {
        out.push(
            PathBuf::from(&home)
                .join(".bun")
                .join("bin")
                .join("bun")
                .to_string_lossy()
                .to_string(),
        );
    }

    out.push("/opt/homebrew/bin/bun".to_string());
    out.push("/usr/local/bin/bun".to_string());

    let mut deduped: Vec<String> = Vec::new();
    for candidate in out {
        if !deduped.iter().any(|item| item == &candidate) {
            deduped.push(candidate);
        }
    }
    deduped
}

fn spawn_bun_with_builder<F>(mut builder: F) -> Result<Child, String>
where
    F: FnMut(&mut Command),
{
    let mut last_not_found: Vec<String> = Vec::new();

    for bun in bun_binary_candidates() {
        let mut command = Command::new(&bun);
        builder(&mut command);
        match command.spawn() {
            Ok(child) => return Ok(child),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                last_not_found.push(format!("{bun} ({error})"));
            }
            Err(error) => {
                return Err(format!("failed to start bun command via '{bun}': {error}"));
            }
        }
    }

    Err(format!(
        "failed to find a runnable bun binary. Tried: {}",
        last_not_found.join(", ")
    ))
}

fn run_bun_output_with_builder<F>(mut builder: F) -> Result<Output, String>
where
    F: FnMut(&mut Command),
{
    let mut last_not_found: Vec<String> = Vec::new();

    for bun in bun_binary_candidates() {
        let mut command = Command::new(&bun);
        builder(&mut command);
        match command.output() {
            Ok(output) => return Ok(output),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                last_not_found.push(format!("{bun} ({error})"));
            }
            Err(error) => {
                return Err(format!(
                    "failed to execute bun command via '{bun}': {error}"
                ));
            }
        }
    }

    Err(format!(
        "failed to find a runnable bun binary. Tried: {}",
        last_not_found.join(", ")
    ))
}

fn run_cli_rpc_output_command(
    workspace_root: &str,
    args: &[&str],
) -> Result<std::process::Output, String> {
    let clite_cmd = std::env::var("CLINE_CLI_COMMAND")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "clite".to_string());

    Command::new(&clite_cmd)
        .arg("rpc")
        .args(args)
        .current_dir(workspace_root)
        .output()
        .map_err(|e| format!("failed running `{clite_cmd} rpc {}`: {e}", args.join(" ")))
}

fn resolve_cli_command() -> String {
    std::env::var("CLINE_CLI_COMMAND")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "clite".to_string())
}

fn apply_shared_cli_env(command: &mut Command) {
    for key in [
        "CLINE_DATA_DIR",
        "CLINE_SESSION_DATA_DIR",
        "CLINE_TEAM_DATA_DIR",
    ] {
        if let Ok(value) = std::env::var(key) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                command.env(key, trimmed.to_string());
            }
        }
    }
    command.env("CLINE_RPC_ADDRESS", resolve_rpc_address());
}

fn resolve_preferred_cli_entrypoint(context: &AppContext) -> Option<PathBuf> {
    resolve_workspace_cli_entrypoint_path(&context.workspace_root)
        .or_else(|| resolve_cli_entrypoint_path(context))
}

fn cli_binary_candidates() -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    out.push(resolve_cli_command());

    if let Ok(home) = std::env::var("HOME") {
        out.push(
            PathBuf::from(&home)
                .join(".bun")
                .join("bin")
                .join("clite")
                .to_string_lossy()
                .to_string(),
        );
    }

    out.push("/opt/homebrew/bin/clite".to_string());
    out.push("/usr/local/bin/clite".to_string());

    let mut deduped: Vec<String> = Vec::new();
    for candidate in out {
        if !deduped.iter().any(|item| item == &candidate) {
            deduped.push(candidate);
        }
    }
    deduped
}

fn spawn_cli_with_builder<F>(mut builder: F) -> Result<Child, String>
where
    F: FnMut(&mut Command),
{
    let mut last_not_found: Vec<String> = Vec::new();

    for cli in cli_binary_candidates() {
        let mut command = Command::new(&cli);
        builder(&mut command);
        match command.spawn() {
            Ok(child) => return Ok(child),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                last_not_found.push(format!("{cli} ({error})"));
            }
            Err(error) => {
                return Err(format!("failed to start CLI command via '{cli}': {error}"));
            }
        }
    }

    Err(format!(
        "failed to find a runnable clite binary. Tried: {}",
        last_not_found.join(", ")
    ))
}

fn ensure_rpc_server(workspace_root: &str, rpc_address: &str) -> Result<String, String> {
    let output = run_cli_rpc_output_command(
        workspace_root,
        &["ensure", "--address", rpc_address, "--json"],
    )?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("rpc ensure exited with {}", output.status)
        } else {
            stderr
        });
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parsed = serde_json::from_str::<Value>(&stdout)
        .map_err(|e| format!("invalid rpc ensure json response: {e}"))?;
    let ensured = parsed
        .get("address")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "rpc ensure response missing address".to_string())?;
    Ok(ensured)
}

fn register_rpc_client(workspace_root: &str, rpc_address: &str) -> Result<(), String> {
    let output = run_cli_rpc_output_command(
        workspace_root,
        &[
            "register",
            "--address",
            rpc_address,
            "--client-id",
            DEFAULT_RPC_CLIENT_ID,
            "--client-type",
            DEFAULT_RPC_CLIENT_TYPE,
            "--meta",
            "app=desktop",
            "--meta",
            "host=tauri",
        ],
    )?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        format!("rpc register exited with {}", output.status)
    } else {
        stderr
    })
}

fn bootstrap_rpc_gateway(context: &AppContext) -> Result<(), String> {
    let requested_rpc_address = resolve_rpc_address();
    let ensured_rpc_address = ensure_rpc_server(&context.workspace_root, &requested_rpc_address)?;
    std::env::set_var("CLINE_RPC_ADDRESS", &ensured_rpc_address);

    register_rpc_client(&context.workspace_root, &ensured_rpc_address)?;
    Ok(())
}

fn run_cli_list_json_command(
    cli_entrypoint: &Path,
    workspace_root: &str,
    target: &str,
) -> Result<String, String> {
    let output = run_bun_output_with_builder(|command| {
        command
            .arg("run")
            .arg(cli_entrypoint.to_string_lossy().to_string())
            .arg("list")
            .arg(target)
            .arg("--json")
            .current_dir(workspace_root);
    })
    .map_err(|e| format!("failed running list {target}: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("list {target} exited with {}", output.status)
        } else {
            stderr
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn parse_cli_list_json<T: DeserializeOwned>(target: &str, raw: &str) -> Result<Vec<T>, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str::<Vec<T>>(trimmed)
        .map_err(|e| format!("failed parsing list {target} JSON: {e}"))
}

fn resolve_provider_oauth_login_script_path(context: &AppContext) -> Option<PathBuf> {
    let candidates = [
        PathBuf::from(&context.workspace_root)
            .join("apps")
            .join("code")
            .join("scripts")
            .join("provider-oauth-login.ts"),
        PathBuf::from(&context.workspace_root)
            .join("scripts")
            .join("provider-oauth-login.ts"),
        PathBuf::from(&context.launch_cwd)
            .join("scripts")
            .join("provider-oauth-login.ts"),
        PathBuf::from(&context.launch_cwd)
            .join("apps")
            .join("code")
            .join("scripts")
            .join("provider-oauth-login.ts"),
    ];
    candidates.into_iter().find(|path| path.exists())
}

fn resolve_provider_settings_script_path(context: &AppContext) -> Option<PathBuf> {
    let candidates = [
        PathBuf::from(&context.workspace_root)
            .join("apps")
            .join("code")
            .join("scripts")
            .join("provider-settings.ts"),
        PathBuf::from(&context.workspace_root)
            .join("scripts")
            .join("provider-settings.ts"),
        PathBuf::from(&context.launch_cwd)
            .join("scripts")
            .join("provider-settings.ts"),
        PathBuf::from(&context.launch_cwd)
            .join("apps")
            .join("code")
            .join("scripts")
            .join("provider-settings.ts"),
    ];
    candidates.into_iter().find(|path| path.exists())
}

fn resolve_workspace_file_search_script_path(context: &AppContext) -> Option<PathBuf> {
    let candidates = [
        PathBuf::from(&context.workspace_root)
            .join("apps")
            .join("code")
            .join("scripts")
            .join("workspace-file-search.ts"),
        PathBuf::from(&context.workspace_root)
            .join("scripts")
            .join("workspace-file-search.ts"),
        PathBuf::from(&context.launch_cwd)
            .join("scripts")
            .join("workspace-file-search.ts"),
        PathBuf::from(&context.launch_cwd)
            .join("apps")
            .join("code")
            .join("scripts")
            .join("workspace-file-search.ts"),
    ];
    candidates.into_iter().find(|path| path.exists())
}

fn run_bun_script_json(
    script_path: &Path,
    script_workdir: &Path,
    stdin_body: String,
    command_name: &str,
) -> Result<Value, String> {
    let mut child = spawn_bun_with_builder(|command| {
        command
            .current_dir(script_workdir)
            .arg("run")
            .arg(script_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
    })
    .map_err(|e| format!("failed to start {command_name} script: {e}"))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(stdin_body.as_bytes())
            .map_err(|e| format!("failed writing {command_name} stdin: {e}"))?;
        stdin
            .flush()
            .map_err(|e| format!("failed flushing {command_name} stdin: {e}"))?;
    }
    let _ = child.stdin.take();

    let mut stdout = String::new();
    if let Some(mut handle) = child.stdout.take() {
        handle
            .read_to_string(&mut stdout)
            .map_err(|e| format!("failed reading {command_name} output: {e}"))?;
    }

    let mut stderr = String::new();
    if let Some(mut handle) = child.stderr.take() {
        handle
            .read_to_string(&mut stderr)
            .map_err(|e| format!("failed reading {command_name} stderr: {e}"))?;
    }

    let status = child
        .wait()
        .map_err(|e| format!("failed waiting for {command_name} script: {e}"))?;

    if !status.success() {
        let stderr = stderr.trim().to_string();
        if !stderr.is_empty() {
            return Err(stderr);
        }
        let stdout = stdout.trim().to_string();
        if !stdout.is_empty() {
            return Err(stdout);
        }
        return Err(format!("{command_name} script failed with status {status}"));
    }

    serde_json::from_str::<Value>(stdout.trim())
        .map_err(|e| format!("invalid {command_name} response: {e}"))
}

fn resolve_mcp_settings_path() -> Result<PathBuf, String> {
    if let Ok(value) = std::env::var("CLINE_MCP_SETTINGS_PATH") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }
    let home = resolve_home_dir().ok_or_else(|| "HOME is not set".to_string())?;
    Ok(PathBuf::from(home)
        .join(".cline")
        .join("data")
        .join("settings")
        .join("cline_mcp_settings.json"))
}

fn parse_string_map(value: Option<&Value>) -> Option<HashMap<String, String>> {
    let Some(obj) = value.and_then(|v| v.as_object()) else {
        return None;
    };
    let mut out = HashMap::new();
    for (key, val) in obj {
        if let Some(text) = val.as_str() {
            out.insert(key.clone(), text.to_string());
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

fn parse_bool(value: Option<&Value>) -> bool {
    value.and_then(|v| v.as_bool()).unwrap_or(false)
}

fn parse_mcp_server_record(name: &str, body: &Value) -> Result<McpServerRecord, String> {
    let obj = body
        .as_object()
        .ok_or_else(|| format!("Invalid MCP settings: server \"{name}\" must be an object"))?;
    let disabled = parse_bool(obj.get("disabled"));
    let metadata = obj.get("metadata").cloned();

    if let Some(transport) = obj.get("transport") {
        let transport_obj = transport.as_object().ok_or_else(|| {
            format!("Invalid MCP settings: server \"{name}\" has invalid transport object")
        })?;
        let transport_type = transport_obj
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if transport_type != "stdio"
            && transport_type != "sse"
            && transport_type != "streamableHttp"
        {
            return Err(format!(
                "Invalid MCP settings: server \"{name}\" has unsupported transport type \"{transport_type}\""
            ));
        }

        if transport_type == "stdio" {
            let command = transport_obj
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if command.is_empty() {
                return Err(format!(
                    "Invalid MCP settings: server \"{name}\" requires transport.command for stdio"
                ));
            }
            let args = transport_obj
                .get("args")
                .and_then(|v| v.as_array())
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| item.as_str().map(|value| value.to_string()))
                        .collect::<Vec<String>>()
                })
                .filter(|items| !items.is_empty());
            let cwd = transport_obj
                .get("cwd")
                .and_then(|v| v.as_str())
                .map(|value| value.to_string())
                .filter(|value| !value.trim().is_empty());
            let env = parse_string_map(transport_obj.get("env"));
            return Ok(McpServerRecord {
                name: name.to_string(),
                transport_type,
                disabled,
                command: Some(command),
                args,
                cwd,
                env,
                url: None,
                headers: None,
                metadata,
            });
        }

        let url = transport_obj
            .get("url")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if url.is_empty() {
            return Err(format!(
                "Invalid MCP settings: server \"{name}\" requires transport.url for URL transport"
            ));
        }
        let headers = parse_string_map(transport_obj.get("headers"));
        return Ok(McpServerRecord {
            name: name.to_string(),
            transport_type,
            disabled,
            command: None,
            args: None,
            cwd: None,
            env: None,
            url: Some(url),
            headers,
            metadata,
        });
    }

    if obj.contains_key("command") {
        let command = obj
            .get("command")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if command.is_empty() {
            return Err(format!(
                "Invalid MCP settings: server \"{name}\" requires command for stdio transport"
            ));
        }
        let transport_type = obj
            .get("type")
            .and_then(|v| v.as_str())
            .or_else(|| obj.get("transportType").and_then(|v| v.as_str()))
            .unwrap_or("stdio")
            .trim()
            .to_string();
        if transport_type != "stdio" {
            return Err(format!(
                "Invalid MCP settings: server \"{name}\" command-based transport must use type \"stdio\""
            ));
        }
        let args = obj
            .get("args")
            .and_then(|v| v.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str().map(|value| value.to_string()))
                    .collect::<Vec<String>>()
            })
            .filter(|items| !items.is_empty());
        let cwd = obj
            .get("cwd")
            .and_then(|v| v.as_str())
            .map(|value| value.to_string())
            .filter(|value| !value.trim().is_empty());
        let env = parse_string_map(obj.get("env"));
        return Ok(McpServerRecord {
            name: name.to_string(),
            transport_type: "stdio".to_string(),
            disabled,
            command: Some(command),
            args,
            cwd,
            env,
            url: None,
            headers: None,
            metadata,
        });
    }

    if obj.contains_key("url") {
        let url = obj
            .get("url")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if url.is_empty() {
            return Err(format!(
                "Invalid MCP settings: server \"{name}\" requires url for URL transport"
            ));
        }
        let raw_type = obj
            .get("type")
            .and_then(|v| v.as_str())
            .or_else(|| obj.get("transportType").and_then(|v| v.as_str()))
            .unwrap_or("sse");
        let transport_type = if raw_type == "http" {
            "streamableHttp"
        } else {
            raw_type
        };
        if transport_type != "sse" && transport_type != "streamableHttp" {
            return Err(format!(
                "Invalid MCP settings: server \"{name}\" url-based transport must use type \"sse\" or \"streamableHttp\""
            ));
        }
        let headers = parse_string_map(obj.get("headers"));
        return Ok(McpServerRecord {
            name: name.to_string(),
            transport_type: transport_type.to_string(),
            disabled,
            command: None,
            args: None,
            cwd: None,
            env: None,
            url: Some(url),
            headers,
            metadata,
        });
    }

    Err(format!(
        "Invalid MCP settings: server \"{name}\" must define transport or a legacy command/url shape"
    ))
}

fn parse_mcp_server_record_fallback(name: &str, body: &Value) -> Option<McpServerRecord> {
    let obj = body.as_object()?;
    let disabled = parse_bool(obj.get("disabled"));
    if !disabled {
        return None;
    }

    let raw_transport_type = obj
        .get("transport")
        .and_then(|v| v.as_object())
        .and_then(|transport| transport.get("type"))
        .and_then(|v| v.as_str())
        .or_else(|| obj.get("type").and_then(|v| v.as_str()))
        .or_else(|| obj.get("transportType").and_then(|v| v.as_str()))
        .unwrap_or("stdio");

    let normalized_transport_type = match raw_transport_type {
        "sse" => "sse",
        "streamableHttp" | "http" => "streamableHttp",
        _ => "stdio",
    };

    let command = obj
        .get("command")
        .and_then(|v| v.as_str())
        .map(|v| v.to_string());
    let args = obj
        .get("args")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(|value| value.to_string()))
                .collect::<Vec<String>>()
        })
        .filter(|items| !items.is_empty());
    let cwd = obj
        .get("cwd")
        .and_then(|v| v.as_str())
        .map(|v| v.to_string())
        .filter(|v| !v.trim().is_empty());
    let env = parse_string_map(obj.get("env"));

    let url = obj
        .get("url")
        .and_then(|v| v.as_str())
        .map(|v| v.to_string())
        .or_else(|| {
            obj.get("transport")
                .and_then(|v| v.as_object())
                .and_then(|transport| transport.get("url"))
                .and_then(|v| v.as_str())
                .map(|v| v.to_string())
        });
    let headers = parse_string_map(obj.get("headers").or_else(|| {
        obj.get("transport")
            .and_then(|v| v.as_object())
            .and_then(|transport| transport.get("headers"))
    }));

    Some(McpServerRecord {
        name: name.to_string(),
        transport_type: normalized_transport_type.to_string(),
        disabled,
        command,
        args,
        cwd,
        env,
        url,
        headers,
        metadata: obj.get("metadata").cloned(),
    })
}

fn read_mcp_servers_from_path(path: &Path) -> Result<Vec<McpServerRecord>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(path).map_err(|e| format!("failed reading MCP settings: {e}"))?;
    let parsed = serde_json::from_str::<Value>(&raw)
        .map_err(|e| format!("invalid MCP settings JSON: {e}"))?;
    let root = parsed
        .as_object()
        .ok_or_else(|| "invalid MCP settings JSON: root must be an object".to_string())?;
    let servers = root
        .get("mcpServers")
        .and_then(|v| v.as_object())
        .ok_or_else(|| "invalid MCP settings JSON: mcpServers must be an object".to_string())?;
    let mut out: Vec<McpServerRecord> = Vec::new();
    for (name, body) in servers {
        match parse_mcp_server_record(name, body) {
            Ok(record) => out.push(record),
            Err(error) => {
                if let Some(fallback) = parse_mcp_server_record_fallback(name, body) {
                    out.push(fallback);
                } else {
                    return Err(error);
                }
            }
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

fn read_mcp_servers_map(path: &Path) -> Result<serde_json::Map<String, Value>, String> {
    if !path.exists() {
        return Ok(serde_json::Map::new());
    }
    let raw = fs::read_to_string(path).map_err(|e| format!("failed reading MCP settings: {e}"))?;
    let parsed = serde_json::from_str::<Value>(&raw)
        .map_err(|e| format!("invalid MCP settings JSON: {e}"))?;
    let root = parsed
        .as_object()
        .ok_or_else(|| "invalid MCP settings JSON: root must be an object".to_string())?;
    let servers = root
        .get("mcpServers")
        .and_then(|v| v.as_object())
        .ok_or_else(|| "invalid MCP settings JSON: mcpServers must be an object".to_string())?;
    Ok(servers.clone())
}

fn server_record_to_json(record: &McpServerRecord) -> Result<Value, String> {
    if record.transport_type == "stdio" {
        let command = record
            .command
            .as_ref()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .ok_or_else(|| "command is required for stdio transport".to_string())?;
        let mut transport = serde_json::Map::new();
        transport.insert("type".to_string(), Value::String("stdio".to_string()));
        transport.insert("command".to_string(), Value::String(command));
        if let Some(args) = &record.args {
            let cleaned: Vec<Value> = args
                .iter()
                .map(|item| item.trim())
                .filter(|item| !item.is_empty())
                .map(|item| Value::String(item.to_string()))
                .collect();
            if !cleaned.is_empty() {
                transport.insert("args".to_string(), Value::Array(cleaned));
            }
        }
        if let Some(cwd) = &record.cwd {
            let trimmed = cwd.trim();
            if !trimmed.is_empty() {
                transport.insert("cwd".to_string(), Value::String(trimmed.to_string()));
            }
        }
        if let Some(env) = &record.env {
            let mut env_obj = serde_json::Map::new();
            for (key, value) in env {
                if !key.trim().is_empty() {
                    env_obj.insert(key.clone(), Value::String(value.clone()));
                }
            }
            if !env_obj.is_empty() {
                transport.insert("env".to_string(), Value::Object(env_obj));
            }
        }
        let mut server = serde_json::Map::new();
        server.insert("transport".to_string(), Value::Object(transport));
        if record.disabled {
            server.insert("disabled".to_string(), Value::Bool(true));
        }
        if let Some(metadata) = &record.metadata {
            server.insert("metadata".to_string(), metadata.clone());
        }
        return Ok(Value::Object(server));
    }

    if record.transport_type != "sse" && record.transport_type != "streamableHttp" {
        return Err(format!(
            "unsupported transport type \"{}\"",
            record.transport_type
        ));
    }
    let url = record
        .url
        .as_ref()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "url is required for URL transport".to_string())?;
    let mut transport = serde_json::Map::new();
    transport.insert(
        "type".to_string(),
        Value::String(record.transport_type.clone()),
    );
    transport.insert("url".to_string(), Value::String(url));
    if let Some(headers) = &record.headers {
        let mut headers_obj = serde_json::Map::new();
        for (key, value) in headers {
            if !key.trim().is_empty() {
                headers_obj.insert(key.clone(), Value::String(value.clone()));
            }
        }
        if !headers_obj.is_empty() {
            transport.insert("headers".to_string(), Value::Object(headers_obj));
        }
    }
    let mut server = serde_json::Map::new();
    server.insert("transport".to_string(), Value::Object(transport));
    if record.disabled {
        server.insert("disabled".to_string(), Value::Bool(true));
    }
    if let Some(metadata) = &record.metadata {
        server.insert("metadata".to_string(), metadata.clone());
    }
    Ok(Value::Object(server))
}

fn write_mcp_servers_map(
    path: &Path,
    servers: serde_json::Map<String, Value>,
) -> Result<(), String> {
    let mut entries: Vec<(String, Value)> = servers.into_iter().collect();
    entries.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));
    let mut sorted = serde_json::Map::new();
    for (key, value) in entries {
        sorted.insert(key, value);
    }

    let mut root = serde_json::Map::new();
    root.insert("mcpServers".to_string(), Value::Object(sorted));
    let body = serde_json::to_vec_pretty(&Value::Object(root))
        .map_err(|e| format!("failed encoding MCP settings: {e}"))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed creating MCP settings directory: {e}"))?;
    }
    let mut with_newline = body;
    with_newline.push(b'\n');
    fs::write(path, with_newline).map_err(|e| format!("failed writing MCP settings: {e}"))?;
    Ok(())
}

fn open_path_with_default_app(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let status = Command::new("open")
            .arg(path)
            .status()
            .map_err(|e| format!("failed to open path: {e}"))?;
        if status.success() {
            return Ok(());
        }
        return Err(format!("open command exited with status {status}"));
    }

    #[cfg(target_os = "windows")]
    {
        let path_arg = path.to_string_lossy().to_string();
        let status = Command::new("cmd")
            .args(["/C", "start", "", &path_arg])
            .status()
            .map_err(|e| format!("failed to open path: {e}"))?;
        if status.success() {
            return Ok(());
        }
        return Err(format!("start command exited with status {status}"));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let status = Command::new("xdg-open")
            .arg(path)
            .status()
            .map_err(|e| format!("failed to open path: {e}"))?;
        if status.success() {
            return Ok(());
        }
        return Err(format!("xdg-open command exited with status {status}"));
    }

    #[allow(unreachable_code)]
    Err("opening files is not supported on this platform".to_string())
}

fn resolve_chat_runtime_bridge_script_path(context: &AppContext) -> Option<PathBuf> {
    let candidates = [
        PathBuf::from(&context.workspace_root)
            .join("apps")
            .join("desktop")
            .join("scripts")
            .join("chat-runtime-bridge.ts"),
        PathBuf::from(&context.workspace_root)
            .join("apps")
            .join("code")
            .join("scripts")
            .join("chat-runtime-bridge.ts"),
        PathBuf::from(&context.workspace_root)
            .join("packages")
            .join("app")
            .join("scripts")
            .join("chat-runtime-bridge.ts"),
        PathBuf::from(&context.workspace_root)
            .join("app")
            .join("scripts")
            .join("chat-runtime-bridge.ts"),
        PathBuf::from(&context.launch_cwd)
            .join("app")
            .join("scripts")
            .join("chat-runtime-bridge.ts"),
        PathBuf::from(&context.launch_cwd)
            .join("..")
            .join("scripts")
            .join("chat-runtime-bridge.ts"),
        PathBuf::from(&context.launch_cwd)
            .join("scripts")
            .join("chat-runtime-bridge.ts"),
    ];
    candidates.into_iter().find(|path| path.exists())
}

fn ensure_chat_runtime_bridge_started(
    app: &AppHandle,
    state: &Arc<ChatSessionStore>,
    context: &AppContext,
) -> Result<(), String> {
    {
        let mut bridge_guard = state
            .runtime_bridge
            .lock()
            .map_err(|_| "failed to lock chat runtime bridge state")?;
        if let Some(existing) = bridge_guard.as_mut() {
            match existing.child.try_wait() {
                Ok(None) => {
                    return Ok(());
                }
                Ok(Some(_)) | Err(_) => {
                    *bridge_guard = None;
                }
            }
        }
    }

    let Some(script_path) = resolve_chat_runtime_bridge_script_path(context) else {
        return Err(format!(
            "chat runtime bridge script not found. checked workspace_root={} and launch_cwd={}",
            context.workspace_root, context.launch_cwd
        ));
    };

    let approval_dir = tool_approval_dir()
        .unwrap_or_else(|| PathBuf::from(".").join(".cline").join("tool-approvals"));
    let _ = fs::create_dir_all(&approval_dir);

    let mut child = Command::new("bun")
        .arg(script_path.to_string_lossy().to_string())
        .current_dir(&context.workspace_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("CLINE_TOOL_APPROVAL_MODE", "desktop")
        .env(
            "CLINE_TOOL_APPROVAL_DIR",
            approval_dir.to_string_lossy().to_string(),
        )
        .spawn()
        .map_err(|e| format!("failed to start chat runtime bridge script: {e}"))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "failed to capture chat runtime bridge stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to capture chat runtime bridge stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "failed to capture chat runtime bridge stderr".to_string())?;

    let pending = Arc::new(Mutex::new(HashMap::<
        String,
        std::sync::mpsc::Sender<Result<Value, String>>,
    >::new()));
    let stdout_app = app.clone();
    let stdout_pending = pending.clone();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        loop {
            line.clear();
            let Ok(bytes) = reader.read_line(&mut line) else {
                break;
            };
            if bytes == 0 {
                break;
            }
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let Ok(parsed) = serde_json::from_str::<ChatRuntimeBridgeLine>(trimmed) else {
                continue;
            };
            match parsed.line_type.as_str() {
                "ready" => {}
                "response" => {
                    let Some(request_id) = parsed.request_id.as_deref() else {
                        continue;
                    };
                    let pending_sender = stdout_pending
                        .lock()
                        .ok()
                        .and_then(|mut pending_map| pending_map.remove(request_id));
                    let Some(sender) = pending_sender else {
                        continue;
                    };
                    if let Some(error) = parsed.error {
                        let _ = sender.send(Err(error));
                    } else {
                        let _ = sender.send(Ok(parsed.response.unwrap_or(Value::Null)));
                    }
                }
                "chat_text" => {
                    let Some(session_id) = parsed.session_id.as_deref() else {
                        continue;
                    };
                    let Some(chunk) = parsed.chunk else {
                        continue;
                    };
                    emit_chunk(&stdout_app, session_id, "chat_text", chunk);
                }
                "tool_call_start" => {
                    let Some(session_id) = parsed.session_id.as_deref() else {
                        continue;
                    };
                    let payload = serde_json::json!({
                        "toolCallId": parsed.tool_call_id,
                        "toolName": parsed.tool_name,
                        "input": parsed.input,
                    });
                    emit_chunk(
                        &stdout_app,
                        session_id,
                        "chat_tool_call_start",
                        payload.to_string(),
                    );
                }
                "tool_call_end" => {
                    let Some(session_id) = parsed.session_id.as_deref() else {
                        continue;
                    };
                    let payload = serde_json::json!({
                        "toolCallId": parsed.tool_call_id,
                        "toolName": parsed.tool_name,
                        "output": parsed.output,
                        "error": parsed.error,
                        "durationMs": parsed.duration_ms,
                    });
                    emit_chunk(
                        &stdout_app,
                        session_id,
                        "chat_tool_call_end",
                        payload.to_string(),
                    );
                }
                "error" => {
                    if let Some(session_id) = parsed.session_id.as_deref() {
                        let payload = serde_json::json!({
                            "level": "error",
                            "message": parsed.message.unwrap_or_else(|| "chat runtime bridge error".to_string()),
                        });
                        emit_chunk(
                            &stdout_app,
                            session_id,
                            "chat_core_log",
                            payload.to_string(),
                        );
                    } else if let Some(message) = parsed.message {
                        eprintln!("[chat-runtime-bridge] {message}");
                    }
                }
                _ => {}
            }
        }
        if let Ok(mut pending_map) = stdout_pending.lock() {
            for (_, sender) in pending_map.drain() {
                let _ = sender.send(Err("chat runtime bridge exited".to_string()));
            }
        }
    });

    thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut buf = String::new();
        let _ = reader.read_to_string(&mut buf);
        let trimmed = buf.trim();
        if !trimmed.is_empty() {
            eprintln!("[chat-runtime-bridge] {trimmed}");
        }
    });

    let mut bridge_guard = state
        .runtime_bridge
        .lock()
        .map_err(|_| "failed to lock chat runtime bridge state")?;
    *bridge_guard = Some(ChatRuntimeBridge {
        child,
        stdin,
        next_request_id: 0,
        pending,
    });
    Ok(())
}

fn run_chat_runtime_bridge_command(
    app: &AppHandle,
    state: &Arc<ChatSessionStore>,
    context: &AppContext,
    command: Value,
) -> Result<Value, String> {
    ensure_chat_runtime_bridge_started(app, state, context)?;

    let (tx, rx) = std::sync::mpsc::channel::<Result<Value, String>>();
    let request_id = {
        let mut bridge_guard = state
            .runtime_bridge
            .lock()
            .map_err(|_| "failed to lock chat runtime bridge state")?;
        let Some(bridge) = bridge_guard.as_mut() else {
            return Err("chat runtime bridge not available".to_string());
        };
        bridge.next_request_id += 1;
        let request_id = format!("runtime_bridge_req_{}", bridge.next_request_id);
        bridge
            .pending
            .lock()
            .map_err(|_| "failed to lock chat runtime bridge pending responses")?
            .insert(request_id.clone(), tx);
        let envelope = ChatRuntimeBridgeCommandEnvelope {
            message_type: "request".to_string(),
            request_id: request_id.clone(),
            command,
        };
        let payload = serde_json::to_string(&envelope)
            .map_err(|e| format!("failed serializing chat runtime bridge command: {e}"))?;
        let write_result = bridge.stdin.write_all(payload.as_bytes());
        let newline_result = bridge.stdin.write_all(b"\n");
        let flush_result = bridge.stdin.flush();
        if let Err(error) = write_result.and(newline_result).and(flush_result) {
            let _ = bridge
                .pending
                .lock()
                .ok()
                .and_then(|mut pending_map| pending_map.remove(&request_id));
            return Err(format!(
                "failed writing chat runtime bridge command: {error}"
            ));
        }
        request_id
    };

    match rx.recv() {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(error)) => Err(error),
        Err(_) => {
            let _ = state.runtime_bridge.lock().ok().and_then(|mut guard| {
                guard.as_mut().and_then(|bridge| {
                    bridge
                        .pending
                        .lock()
                        .ok()
                        .and_then(|mut pending_map| pending_map.remove(&request_id))
                })
            });
            Err("chat runtime bridge response channel closed".to_string())
        }
    }
}

fn create_chat_session_via_rpc_runtime(
    app: &AppHandle,
    state: &Arc<ChatSessionStore>,
    context: &AppContext,
    config: &StartSessionRequest,
) -> Result<String, String> {
    let response = run_chat_runtime_bridge_command(
        app,
        state,
        context,
        serde_json::json!({
            "action": "start",
            "config": config,
        }),
    )?;
    let session_id = response
        .get("sessionId")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .trim()
        .to_string();
    if session_id.is_empty() {
        return Err("chat runtime bridge start response missing session id".to_string());
    }
    Ok(session_id)
}

fn sync_chat_stream_subscriptions(
    app: &AppHandle,
    state: &Arc<ChatSessionStore>,
    context: &AppContext,
) -> Result<(), String> {
    let session_ids = {
        let subscriptions = state
            .stream_subscriptions
            .lock()
            .map_err(|_| "failed to lock chat stream subscriptions")?;
        let mut ids: Vec<String> = subscriptions.iter().cloned().collect();
        ids.sort();
        ids
    };
    let _ = run_chat_runtime_bridge_command(
        app,
        state,
        context,
        serde_json::json!({
            "action": "set_sessions",
            "sessionIds": session_ids,
        }),
    )?;
    Ok(())
}

fn ensure_chat_stream_subscription(
    app: &AppHandle,
    state: &Arc<ChatSessionStore>,
    context: &AppContext,
    session_id: &str,
) -> Result<(), String> {
    let inserted = {
        let mut subscriptions = state
            .stream_subscriptions
            .lock()
            .map_err(|_| "failed to lock chat stream subscriptions")?;
        subscriptions.insert(session_id.to_string())
    };
    if !inserted {
        return Ok(());
    }
    sync_chat_stream_subscriptions(app, state, context)
}

fn remove_chat_stream_subscription(
    app: &AppHandle,
    state: &Arc<ChatSessionStore>,
    context: &AppContext,
    session_id: &str,
) -> Result<(), String> {
    {
        let mut subscriptions = state
            .stream_subscriptions
            .lock()
            .map_err(|_| "failed to lock chat stream subscriptions")?;
        subscriptions.remove(session_id);
    }
    sync_chat_stream_subscriptions(app, state, context)
}

fn run_chat_turn_via_rpc_runtime(
    app: &AppHandle,
    state: &Arc<ChatSessionStore>,
    context: &AppContext,
    session_id: &str,
    request: &ChatRunTurnRequest,
) -> Result<ChatTurnResult, String> {
    let response = run_chat_runtime_bridge_command(
        app,
        state,
        context,
        serde_json::json!({
            "action": "send",
            "sessionId": session_id,
            "request": request,
        }),
    )?;
    let result_value = response
        .get("result")
        .cloned()
        .ok_or_else(|| "chat runtime bridge send response missing result".to_string())?;
    serde_json::from_value::<ChatTurnResult>(result_value)
        .map_err(|e| format!("invalid chat runtime bridge result: {e}"))
}

fn abort_chat_session_via_rpc_runtime(
    app: &AppHandle,
    state: &Arc<ChatSessionStore>,
    context: &AppContext,
    session_id: &str,
) -> Result<(), String> {
    let _ = run_chat_runtime_bridge_command(
        app,
        state,
        context,
        serde_json::json!({
            "action": "abort",
            "sessionId": session_id,
        }),
    )?;
    Ok(())
}

fn reset_chat_session_via_rpc_runtime(
    app: &AppHandle,
    state: &Arc<ChatSessionStore>,
    context: &AppContext,
    session_id: Option<&str>,
) -> Result<(), String> {
    let _ = run_chat_runtime_bridge_command(
        app,
        state,
        context,
        serde_json::json!({
            "action": "reset",
            "sessionId": session_id,
        }),
    )?;
    Ok(())
}

fn append_session_chunk(session_id: &str, stream: &str, chunk: &str, ts: u64) {
    let Some(path) = session_log_path(session_id) else {
        return;
    };
    if let Some(parent) = path.parent() {
        if fs::create_dir_all(parent).is_err() {
            return;
        }
    }
    let line = serde_json::json!({
        "ts": ts,
        "stream": stream,
        "chunk": chunk,
    })
    .to_string();
    let mut file = match std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        Ok(file) => file,
        Err(_) => return,
    };
    let _ = writeln!(file, "{line}");
}

fn emit_chunk(app: &AppHandle, session_id: &str, stream: &str, chunk: String) {
    let ts = now_ms();
    append_session_chunk(session_id, stream, &chunk, ts);

    let payload = StreamChunkEvent {
        session_id: session_id.to_string(),
        stream: stream.to_string(),
        chunk: chunk.clone(),
        ts,
    };
    if let Some(ws_bridge) = app.try_state::<Arc<ChatWsBridgeState>>() {
        ws_bridge.broadcast_chunk_event(payload.clone());
    }
    let _ = app.emit("agent://chunk", payload);
}

fn emit_session_ended(app: &AppHandle, session_id: &str, reason: String) {
    let payload = SessionEndedEvent {
        session_id: session_id.to_string(),
        reason,
        ts: now_ms(),
    };
    let _ = app.emit("agent://session-ended", payload);
}

async fn chat_ws_writer_task(
    mut sink: futures_util::stream::SplitSink<WebSocketStream<TcpStream>, Message>,
    mut rx: UnboundedReceiver<String>,
) {
    while let Some(line) = rx.recv().await {
        if sink.send(Message::Text(line)).await.is_err() {
            break;
        }
    }
}

async fn handle_chat_ws_connection(
    stream: TcpStream,
    app: AppHandle,
    chat_state: Arc<ChatSessionStore>,
    app_context: AppContext,
    ws_bridge: Arc<ChatWsBridgeState>,
) -> Result<(), String> {
    let websocket = accept_async(stream)
        .await
        .map_err(|e| format!("failed websocket accept: {e}"))?;
    let (sink, mut source) = websocket.split();
    let (tx, rx) = mpsc::unbounded_channel::<String>();
    let client_id = ws_bridge.register_client(tx.clone());
    tauri::async_runtime::spawn(chat_ws_writer_task(sink, rx));

    while let Some(message) = source.next().await {
        let message = match message {
            Ok(value) => value,
            Err(e) => {
                ws_bridge.unregister_client(client_id);
                return Err(format!("websocket read error: {e}"));
            }
        };
        if message.is_close() {
            break;
        }
        let Message::Text(body) = message else {
            continue;
        };
        let parsed = serde_json::from_str::<ChatWsCommandEnvelope>(&body);
        let envelope = match parsed {
            Ok(value) => value,
            Err(e) => {
                let response = ChatWsResponseEnvelope {
                    message_type: "chat_response".to_string(),
                    request_id: String::new(),
                    response: None,
                    error: Some(format!("invalid chat websocket payload: {e}")),
                };
                if let Ok(encoded) = serde_json::to_string(&response) {
                    let _ = tx.send(encoded);
                }
                continue;
            }
        };
        let command_result =
            handle_chat_session_command(&app, &chat_state, &app_context, envelope.request).await;
        let response = match command_result {
            Ok(value) => ChatWsResponseEnvelope {
                message_type: "chat_response".to_string(),
                request_id: envelope.request_id,
                response: Some(value),
                error: None,
            },
            Err(error) => ChatWsResponseEnvelope {
                message_type: "chat_response".to_string(),
                request_id: envelope.request_id,
                response: None,
                error: Some(error),
            },
        };
        if let Ok(encoded) = serde_json::to_string(&response) {
            let _ = tx.send(encoded);
        }
    }

    ws_bridge.unregister_client(client_id);
    Ok(())
}

async fn start_chat_ws_bridge(
    app: AppHandle,
    chat_state: Arc<ChatSessionStore>,
    app_context: AppContext,
    ws_bridge: Arc<ChatWsBridgeState>,
) -> Result<(), String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("failed to bind chat websocket listener: {e}"))?;
    let address = listener
        .local_addr()
        .map_err(|e| format!("failed reading chat websocket listener address: {e}"))?;
    ws_bridge.set_endpoint(format!("ws://127.0.0.1:{}/chat", address.port()));
    loop {
        let accepted = listener.accept().await;
        let (stream, _) = match accepted {
            Ok(value) => value,
            Err(e) => {
                eprintln!("[chat-ws] accept failed: {e}");
                continue;
            }
        };
        let app_for_connection = app.clone();
        let chat_state_for_connection = chat_state.clone();
        let context_for_connection = app_context.clone();
        let ws_bridge_for_connection = ws_bridge.clone();
        tauri::async_runtime::spawn(async move {
            let _ = handle_chat_ws_connection(
                stream,
                app_for_connection,
                chat_state_for_connection,
                context_for_connection,
                ws_bridge_for_connection,
            )
            .await;
        });
    }
}

#[tauri::command]
fn get_chat_ws_endpoint(state: State<'_, Arc<ChatWsBridgeState>>) -> Result<String, String> {
    state
        .endpoint()
        .ok_or_else(|| "chat websocket endpoint not ready".to_string())
}

fn sanitize_team_name(name: &str) -> String {
    let lowered = name.to_ascii_lowercase();
    let mut out = String::with_capacity(lowered.len());
    for ch in lowered.chars() {
        if ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-' {
            out.push(ch);
        } else {
            out.push('-');
        }
    }
    out.trim_matches('-').to_string()
}

fn team_base_dir() -> Option<PathBuf> {
    if let Ok(value) = std::env::var("CLINE_TEAM_DATA_DIR") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    let home = resolve_home_dir()?;
    Some(
        PathBuf::from(home)
            .join(".cline")
            .join("data")
            .join("teams"),
    )
}

fn team_state_path(team_name: &str) -> Option<PathBuf> {
    let base = team_base_dir()?;
    let safe = sanitize_team_name(team_name);
    if safe.is_empty() {
        return None;
    }
    Some(base.join(safe).join("state.json"))
}

fn team_history_path(team_name: &str) -> Option<PathBuf> {
    let base = team_base_dir()?;
    let safe = sanitize_team_name(team_name);
    if safe.is_empty() {
        return None;
    }
    Some(base.join(safe).join("task-history.jsonl"))
}

fn spawn_reader<R: Read + Send + 'static>(
    app: AppHandle,
    session_id: String,
    stream: &'static str,
    mut reader: R,
) {
    thread::spawn(move || {
        let mut buf = [0_u8; 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                    emit_chunk(&app, &session_id, stream, chunk);
                }
                Err(_) => break,
            }
        }
    });
}

#[tauri::command]
fn start_session(
    app: AppHandle,
    state: State<'_, Arc<SessionStore>>,
    context: State<'_, AppContext>,
    request: StartSessionRequest,
) -> Result<String, String> {
    let effective_api_key = resolve_api_key(&request.provider, &request.api_key).ok_or_else(|| {
        format!(
            "Missing API key for provider '{}'. Provide one in the UI or set the required env var before launching Tauri.",
            request.provider
        )
    })?;

    let id = format!("sess_{}", state.counter.fetch_add(1, Ordering::Relaxed) + 1);

    let prompt = request.prompt.clone().unwrap_or_default();
    let interactive = prompt.trim().is_empty();

    let mut args: Vec<String> = vec![
        "-p".into(),
        request.provider.clone(),
        "-m".into(),
        request.model.clone(),
        "--mode".into(),
        if request.mode.trim().eq_ignore_ascii_case("plan") {
            "plan".into()
        } else {
            "act".into()
        },
        "--mission-step-interval".into(),
        request.mission_step_interval.to_string(),
        "--mission-time-interval-ms".into(),
        request.mission_time_interval_ms.to_string(),
    ];

    if interactive {
        args.push("-i".into());
    }

    let auto_approve_tools = request.auto_approve_tools.unwrap_or(true);
    if request.enable_tools {
        args.push("--tools".into());
        if !auto_approve_tools {
            args.push("--require-tool-approval".into());
        }
    }
    if request.enable_spawn {
        args.push("--spawn".into());
    }
    if request.enable_teams {
        args.push("--teams".into());
        args.push("--team-name".into());
        args.push(request.team_name.clone());
    }
    if let Some(cwd) = &request.cwd {
        if !cwd.trim().is_empty() {
            args.push("--cwd".into());
            args.push(cwd.clone());
        }
    }
    if let Some(system_prompt) = &request.system_prompt {
        if !system_prompt.trim().is_empty() {
            args.push("-s".into());
            args.push(system_prompt.clone());
        }
    }
    if !request.enable_teams {
        if let Some(max_iterations) = request.max_iterations {
            args.push("-n".into());
            args.push(max_iterations.to_string());
        }
    }
    if !interactive {
        args.push(prompt);
    }

    let hook_log_path = session_hook_log_path(&id).unwrap_or_else(|| PathBuf::from("."));
    if let Some(parent) = hook_log_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let approval_dir = tool_approval_dir()
        .unwrap_or_else(|| PathBuf::from(".").join(".cline").join("tool-approvals"));
    let _ = fs::create_dir_all(&approval_dir);
    let mut spawn_errors: Vec<String> = Vec::new();
    let mut child: Option<Child> = None;

    if let Some(cli_entrypoint) = resolve_preferred_cli_entrypoint(&context) {
        let cli_workdir = resolve_cli_workdir(&cli_entrypoint, &context);
        match spawn_bun_with_builder(|command| {
            command
                .current_dir(&cli_workdir)
                .arg("run")
                .arg(cli_entrypoint.to_string_lossy().to_string())
                .args(args.clone())
                .stdin(if interactive {
                    Stdio::piped()
                } else {
                    Stdio::null()
                })
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .env("NO_COLOR", "1")
                .env("FORCE_COLOR", "0")
                .env("CLINE_ENABLE_SUBPROCESS_HOOKS", "1")
                .env("CLINE_SESSION_ID", id.clone())
                .env("CLINE_TOOL_APPROVAL_MODE", "desktop")
                .env("CLINE_TOOL_APPROVAL_SESSION_ID", id.clone())
                .env(
                    "CLINE_TOOL_APPROVAL_DIR",
                    approval_dir.to_string_lossy().to_string(),
                )
                .env(
                    "CLINE_HOOKS_LOG_PATH",
                    hook_log_path.to_string_lossy().to_string(),
                )
                .env("ANTHROPIC_API_KEY", &effective_api_key)
                .env("OPENAI_API_KEY", &effective_api_key);
            apply_shared_cli_env(command);
        }) {
            Ok(next_child) => child = Some(next_child),
            Err(error) => spawn_errors.push(format!("workspace CLI launch failed: {error}")),
        }
    }

    if child.is_none() {
        match spawn_cli_with_builder(|command| {
            command
                .current_dir(&request.workspace_root)
                .args(args.clone())
                .stdin(if interactive {
                    Stdio::piped()
                } else {
                    Stdio::null()
                })
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .env("NO_COLOR", "1")
                .env("FORCE_COLOR", "0")
                .env("CLINE_ENABLE_SUBPROCESS_HOOKS", "1")
                .env("CLINE_SESSION_ID", id.clone())
                .env("CLINE_TOOL_APPROVAL_MODE", "desktop")
                .env("CLINE_TOOL_APPROVAL_SESSION_ID", id.clone())
                .env(
                    "CLINE_TOOL_APPROVAL_DIR",
                    approval_dir.to_string_lossy().to_string(),
                )
                .env(
                    "CLINE_HOOKS_LOG_PATH",
                    hook_log_path.to_string_lossy().to_string(),
                )
                .env("ANTHROPIC_API_KEY", &effective_api_key)
                .env("OPENAI_API_KEY", &effective_api_key);
            apply_shared_cli_env(command);
        }) {
            Ok(next_child) => child = Some(next_child),
            Err(error) => spawn_errors.push(format!("clite launch failed: {error}")),
        }
    }

    let mut child = child.ok_or_else(|| {
        format!(
            "failed to start session process: {}",
            spawn_errors.join("; ")
        )
    })?;

    let stdin = child.stdin.take();
    let stdout = child.stdout.take().ok_or("failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("failed to capture stderr")?;

    spawn_reader(app.clone(), id.clone(), "stdout", stdout);
    spawn_reader(app, id.clone(), "stderr", stderr);

    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "failed to lock session store")?;
    sessions.insert(id.clone(), SessionProcess { child, stdin });

    Ok(id)
}

#[tauri::command]
fn send_prompt(
    app: AppHandle,
    state: State<'_, Arc<SessionStore>>,
    session_id: String,
    prompt: String,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "failed to lock session store")?;

    let mut should_remove = false;
    let mut ended_reason: Option<String> = None;
    {
        let session = sessions
            .get_mut(&session_id)
            .ok_or_else(|| format!("session not found: {session_id}"))?;

        if let Some(status) = session
            .child
            .try_wait()
            .map_err(|e| format!("failed checking session status: {e}"))?
        {
            should_remove = true;
            ended_reason = Some(format!("session process exited ({status})"));
        } else {
            let Some(stdin) = session.stdin.as_mut() else {
                return Err("session is not interactive".to_string());
            };
            let write_result = stdin.write_all(format!("{prompt}\n").as_bytes());
            let flush_result = stdin.flush();

            if let Err(e) = write_result.or(flush_result) {
                should_remove = true;
                ended_reason = Some(format!("failed writing prompt: {e}"));
            }
        }
    }

    if should_remove {
        sessions.remove(&session_id);
        let reason = ended_reason.unwrap_or_else(|| "session ended".to_string());
        emit_session_ended(&app, &session_id, reason.clone());
        return Err(format!(
            "{reason}. The agent session is no longer running. Start a new session."
        ));
    }

    Ok(())
}

#[tauri::command]
fn stop_session(
    app: AppHandle,
    state: State<'_, Arc<SessionStore>>,
    chat_state: State<'_, Arc<ChatSessionStore>>,
    context: State<'_, AppContext>,
    session_id: String,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "failed to lock session store")?;

    if let Some(mut session) = sessions.remove(&session_id) {
        if let Some(stdin) = session.stdin.as_mut() {
            let _ = stdin.write_all(&[3]);
            let _ = stdin.flush();
        }
        let _ = session.child.kill();
        let _ = session.child.wait();
        emit_session_ended(&app, &session_id, "session stopped".to_string());
        return Ok(());
    }

    let response = run_chat_runtime_bridge_command(
        &app,
        chat_state.inner(),
        context.inner(),
        serde_json::json!({
            "action": "stop",
            "sessionId": session_id,
        }),
    )?;
    let applied = response
        .get("ok")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    if !applied {
        return Err(format!("session not found: {session_id}"));
    }

    emit_session_ended(&app, &session_id, "session stopped".to_string());
    Ok(())
}

#[tauri::command]
fn abort_session(
    app: AppHandle,
    state: State<'_, Arc<SessionStore>>,
    chat_state: State<'_, Arc<ChatSessionStore>>,
    context: State<'_, AppContext>,
    session_id: String,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "failed to lock session store")?;

    let Some(mut session) = sessions.remove(&session_id) else {
        drop(sessions);

        let response = run_chat_runtime_bridge_command(
            &app,
            chat_state.inner(),
            context.inner(),
            serde_json::json!({
                "action": "abort",
                "sessionId": session_id,
            }),
        )?;
        let applied = response
            .get("ok")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        if !applied {
            return Err(format!("session not found: {session_id}"));
        }
        emit_session_ended(&app, &session_id, "session aborted".to_string());
        return Ok(());
    };

    if let Some(stdin) = session.stdin.as_mut() {
        let _ = stdin.write_all(&[3]);
        let _ = stdin.flush();
    }

    let _ = send_abort_signal(&mut session.child);
    let exited_after_int = wait_for_exit(&mut session.child, 8, 75)?;
    if !exited_after_int {
        let _ = send_terminate_signal(&mut session.child);
    }
    let exited_after_term = if exited_after_int {
        true
    } else {
        wait_for_exit(&mut session.child, 8, 75)?
    };
    if !exited_after_term {
        let _ = session.child.kill();
        let _ = session.child.wait();
    }

    emit_session_ended(&app, &session_id, "session cancelled".to_string());
    Ok(())
}

#[tauri::command]
fn poll_sessions(
    app: AppHandle,
    state: State<'_, Arc<SessionStore>>,
) -> Result<Vec<String>, String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "failed to lock session store")?;

    let ids: Vec<String> = sessions.keys().cloned().collect();
    let mut ended: Vec<(String, String)> = Vec::new();

    for session_id in ids {
        if let Some(session) = sessions.get_mut(&session_id) {
            if let Some(status) = session
                .child
                .try_wait()
                .map_err(|e| format!("failed checking session status: {e}"))?
            {
                let reason = if status.success() {
                    "session completed".to_string()
                } else {
                    format!("session exited ({status})")
                };
                ended.push((session_id.clone(), reason));
            }
        }
    }

    for (session_id, reason) in &ended {
        sessions.remove(session_id);
        emit_session_ended(&app, session_id, reason.clone());
    }

    Ok(ended
        .into_iter()
        .map(|(session_id, _)| session_id)
        .collect())
}

#[tauri::command]
fn list_cli_sessions(
    _context: State<'_, AppContext>,
    limit: Option<usize>,
) -> Result<Vec<CliDiscoveredSession>, String> {
    let limit_value = limit.unwrap_or(300).max(1);
    let db_path = root_session_db_path()
        .ok_or_else(|| "could not resolve home directory for root sessions db".to_string())?;
    if !db_path.exists() {
        return Ok(Vec::new());
    }

    let schema_output = Command::new("sqlite3")
        .arg("-noheader")
        .arg("-separator")
        .arg("\t")
        .arg(db_path.to_string_lossy().to_string())
        .arg("PRAGMA table_info(sessions);")
        .output()
        .map_err(|e| format!("failed to inspect root sessions db schema: {e}"))?;
    if !schema_output.status.success() {
        let stderr = String::from_utf8_lossy(&schema_output.stderr)
            .trim()
            .to_string();
        return Err(if stderr.is_empty() {
            "failed to inspect root sessions db schema".to_string()
        } else {
            format!("failed to inspect root sessions db schema: {stderr}")
        });
    }
    let mut columns = HashSet::<String>::new();
    for line in String::from_utf8_lossy(&schema_output.stdout).lines() {
        let fields: Vec<&str> = line.split('\t').collect();
        if fields.len() < 2 {
            continue;
        }
        let name = fields[1].trim();
        if !name.is_empty() {
            columns.insert(name.to_string());
        }
    }
    if columns.is_empty() {
        return Ok(Vec::new());
    }

    let col_expr = |name: &str, fallback: &str| {
        if columns.contains(name) {
            name.to_string()
        } else {
            fallback.to_string()
        }
    };
    let select_sql = vec![
        col_expr("session_id", "''"),
        col_expr("status", "''"),
        col_expr("provider", "''"),
        col_expr("model", "''"),
        col_expr("cwd", "''"),
        col_expr("workspace_root", "''"),
        col_expr("team_name", "''"),
        col_expr("parent_session_id", "''"),
        col_expr("parent_agent_id", "''"),
        col_expr("agent_id", "''"),
        col_expr("conversation_id", "''"),
        col_expr("is_subagent", "0"),
        col_expr("prompt", "''"),
        col_expr("metadata_json", "''"),
        col_expr("started_at", "''"),
        col_expr("ended_at", "''"),
        col_expr("interactive", "0"),
        col_expr("messages_path", "''"),
        col_expr("hook_path", "''"),
        col_expr("transcript_path", "''"),
    ]
    .join(",");
    let order_expr = if columns.contains("started_at") {
        "datetime(started_at)"
    } else {
        "rowid"
    };
    let query = format!(
        "SELECT {select_sql} FROM sessions ORDER BY {order_expr} DESC LIMIT {limit_value};"
    );
    let output = Command::new("sqlite3")
        .arg("-noheader")
        .arg("-separator")
        .arg("\t")
        .arg(db_path.to_string_lossy().to_string())
        .arg(query)
        .output()
        .map_err(|e| format!("failed to query root sessions db: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "failed to query root sessions db".to_string()
        } else {
            format!("failed to query root sessions db: {stderr}")
        });
    }

    let as_opt = |value: &str| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    };
    let as_bool = |value: &str| {
        let trimmed = value.trim().to_ascii_lowercase();
        trimmed == "1" || trimmed == "true"
    };

    let mut out: Vec<CliDiscoveredSession> = Vec::new();
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let fields: Vec<&str> = line.split('\t').collect();
        if fields.len() < 20 {
            continue;
        }

        let session_id = fields[0].trim().to_string();
        if session_id.is_empty() {
            continue;
        }
        let cwd = fields[4].trim().to_string();
        let workspace_root = {
            let root = fields[5].trim().to_string();
            if root.is_empty() {
                cwd.clone()
            } else {
                root
            }
        };
        let metadata_title = title_from_metadata_json(Some(fields[13]));
        let messages_path = as_opt(fields[17]);
        let hook_path = as_opt(fields[18]);
        let transcript_path = as_opt(fields[19]);
        let prompt = match as_opt(fields[12]) {
            Some(value) => Some(value),
            None => read_persisted_chat_messages(&session_id)
                .ok()
                .flatten()
                .and_then(|messages| derive_prompt_from_messages(&messages))
                .or_else(|| {
                    messages_path.as_deref().and_then(|path| {
                        fs::read_to_string(path)
                            .ok()
                            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
                            .and_then(|parsed| {
                                parsed
                                    .get("messages")
                                    .and_then(|v| v.as_array())
                                    .or_else(|| parsed.as_array())
                                    .cloned()
                            })
                            .and_then(|messages| derive_prompt_from_messages(&messages))
                    })
                })
                .or_else(|| hook_path.as_deref().and_then(derive_prompt_from_hook_file))
                .or_else(|| {
                    transcript_path
                        .as_deref()
                        .and_then(derive_prompt_from_transcript_file)
                }),
        };
        let is_subagent = as_bool(fields[11]);
        let agent_id = as_opt(fields[9]);
        let title = metadata_title.unwrap_or_else(|| {
            derive_session_title(&session_id, is_subagent, agent_id.as_deref(), prompt.as_deref())
        });

        out.push(CliDiscoveredSession {
            session_id,
            title,
            status: {
                let value = fields[1].trim();
                if value.is_empty() {
                    "running".to_string()
                } else {
                    value.to_string()
                }
            },
            provider: {
                let value = fields[2].trim();
                if value.is_empty() {
                    "anthropic".to_string()
                } else {
                    value.to_string()
                }
            },
            model: fields[3].trim().to_string(),
            cwd,
            workspace_root,
            team_name: as_opt(fields[6]),
            parent_session_id: as_opt(fields[7]),
            parent_agent_id: as_opt(fields[8]),
            agent_id,
            conversation_id: as_opt(fields[10]),
            is_subagent,
            prompt,
            started_at: fields[14].trim().to_string(),
            ended_at: as_opt(fields[15]),
            interactive: as_bool(fields[16]),
        });
    }

    Ok(out)
}

#[tauri::command]
fn run_provider_oauth_login(
    context: State<'_, AppContext>,
    provider: String,
) -> Result<ProviderOauthLoginResponse, String> {
    let Some(script_path) = resolve_provider_oauth_login_script_path(&context) else {
        return Err(format!(
            "provider oauth login script not found. checked workspace_root={} and launch_cwd={}",
            context.workspace_root, context.launch_cwd
        ));
    };
    let script_workdir = script_path
        .parent()
        .and_then(|parent| parent.parent())
        .map(|value| value.to_path_buf())
        .unwrap_or_else(|| PathBuf::from(&context.launch_cwd));

    let response = run_bun_script_json(
        &script_path,
        &script_workdir,
        serde_json::json!({ "provider": provider }).to_string(),
        "provider oauth",
    )?;

    serde_json::from_value::<ProviderOauthLoginResponse>(response)
        .map_err(|e| format!("invalid provider oauth response: {e}"))
}

#[tauri::command]
fn list_provider_catalog(context: State<'_, AppContext>) -> Result<Value, String> {
    let Some(script_path) = resolve_provider_settings_script_path(&context) else {
        return Err(format!(
            "provider settings script not found. checked workspace_root={} and launch_cwd={}",
            context.workspace_root, context.launch_cwd
        ));
    };
    let script_workdir = script_path
        .parent()
        .and_then(|parent| parent.parent())
        .map(|value| value.to_path_buf())
        .unwrap_or_else(|| PathBuf::from(&context.launch_cwd));

    run_bun_script_json(
        &script_path,
        &script_workdir,
        serde_json::json!({ "action": "listProviders" }).to_string(),
        "provider settings",
    )
}

#[tauri::command]
fn list_provider_models(context: State<'_, AppContext>, provider: String) -> Result<Value, String> {
    let Some(script_path) = resolve_provider_settings_script_path(&context) else {
        return Err(format!(
            "provider settings script not found. checked workspace_root={} and launch_cwd={}",
            context.workspace_root, context.launch_cwd
        ));
    };
    let script_workdir = script_path
        .parent()
        .and_then(|parent| parent.parent())
        .map(|value| value.to_path_buf())
        .unwrap_or_else(|| PathBuf::from(&context.launch_cwd));

    run_bun_script_json(
        &script_path,
        &script_workdir,
        serde_json::json!({
            "action": "getProviderModels",
            "providerId": provider
        })
        .to_string(),
        "provider settings",
    )
}

#[tauri::command]
fn save_provider_settings(
    context: State<'_, AppContext>,
    provider: String,
    enabled: Option<bool>,
    api_key: Option<String>,
    base_url: Option<String>,
) -> Result<Value, String> {
    let Some(script_path) = resolve_provider_settings_script_path(&context) else {
        return Err(format!(
            "provider settings script not found. checked workspace_root={} and launch_cwd={}",
            context.workspace_root, context.launch_cwd
        ));
    };
    let script_workdir = script_path
        .parent()
        .and_then(|parent| parent.parent())
        .map(|value| value.to_path_buf())
        .unwrap_or_else(|| PathBuf::from(&context.launch_cwd));

    run_bun_script_json(
        &script_path,
        &script_workdir,
        serde_json::json!({
            "action": "saveProviderSettings",
            "providerId": provider,
            "enabled": enabled,
            "apiKey": api_key,
            "baseUrl": base_url
        })
        .to_string(),
        "provider settings",
    )
}

#[tauri::command]
fn search_workspace_files(
    context: State<'_, AppContext>,
    workspace_root: Option<String>,
    query: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<String>, String> {
    let Some(script_path) = resolve_workspace_file_search_script_path(&context) else {
        return Err(format!(
            "workspace file search script not found. checked workspace_root={} and launch_cwd={}",
            context.workspace_root, context.launch_cwd
        ));
    };
    let script_workdir = script_path
        .parent()
        .and_then(|parent| parent.parent())
        .map(|value| value.to_path_buf())
        .unwrap_or_else(|| PathBuf::from(&context.launch_cwd));

    let response = run_bun_script_json(
        &script_path,
        &script_workdir,
        serde_json::json!({
            "workspaceRoot": workspace_root,
            "query": query,
            "limit": limit
        })
        .to_string(),
        "workspace file search",
    )?;
    serde_json::from_value::<Vec<String>>(response)
        .map_err(|e| format!("invalid workspace file search response: {e}"))
}

#[tauri::command]
fn delete_cli_session(_context: State<'_, AppContext>, session_id: String) -> Result<(), String> {
    let trimmed_session_id = session_id.trim();
    if trimmed_session_id.is_empty() {
        return Err("session id is required".to_string());
    }

    let related_session_ids = load_related_cli_session_ids(trimmed_session_id)?;
    delete_cli_sessions_from_root_db(trimmed_session_id)?;
    remove_persisted_session_artifacts(&related_session_ids);

    Ok(())
}

#[tauri::command]
fn read_session_hooks(
    session_id: String,
    limit: Option<usize>,
) -> Result<Vec<SessionHookEvent>, String> {
    let path = match shared_session_hook_path(&session_id) {
        Some(path) if path.exists() => path,
        _ => return Ok(vec![]),
    };
    if !path.exists() {
        return Ok(vec![]);
    }

    let raw = fs::read_to_string(path).map_err(|e| format!("failed reading hook log: {e}"))?;
    let mut out: Vec<SessionHookEvent> = Vec::new();

    let parse_tokens = |value: &Value, key: &str| -> Option<u64> {
        value.get(key).and_then(|v| {
            v.as_u64()
                .or_else(|| v.as_f64().map(|n| n.max(0.0) as u64))
                .or_else(|| v.as_str().and_then(|s| s.parse::<u64>().ok()))
        })
    };
    let parse_cost = |value: &Value, key: &str| -> Option<f64> {
        value.get(key).and_then(|v| {
            v.as_f64()
                .or_else(|| v.as_u64().map(|n| n as f64))
                .or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok()))
                .filter(|n| n.is_finite() && *n >= 0.0)
        })
    };

    for line in raw.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let hook_name = value
            .get("hookName")
            .or_else(|| value.get("hook_event_name"))
            .or_else(|| value.get("event"))
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        if hook_name.is_empty() {
            continue;
        }

        let ts = value
            .get("ts")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        let tool_name = value
            .get("tool_call")
            .and_then(|v| v.get("name"))
            .or_else(|| value.get("tool_result").and_then(|v| v.get("name")))
            .and_then(|v| v.as_str())
            .map(|v| v.to_string());
        let tool_input = value
            .get("tool_call")
            .and_then(|v| v.get("input"))
            .cloned()
            .or_else(|| {
                value
                    .get("tool_result")
                    .and_then(|v| v.get("input"))
                    .cloned()
            });
        let tool_output = value
            .get("tool_result")
            .and_then(|v| v.get("output"))
            .cloned();
        let tool_error = value
            .get("tool_result")
            .and_then(|v| v.get("error"))
            .and_then(|v| v.as_str())
            .map(|v| v.to_string());

        let usage = value
            .get("turn")
            .and_then(|v| v.get("usage"))
            .or_else(|| value.get("usage"))
            .or_else(|| value.get("turn_usage"));
        let input_tokens = usage.and_then(|u| {
            parse_tokens(u, "inputTokens")
                .or_else(|| parse_tokens(u, "input_tokens"))
                .or_else(|| parse_tokens(u, "prompt_tokens"))
        });
        let output_tokens = usage.and_then(|u| {
            parse_tokens(u, "outputTokens")
                .or_else(|| parse_tokens(u, "output_tokens"))
                .or_else(|| parse_tokens(u, "completion_tokens"))
        });
        let total_cost = usage.and_then(|u| {
            parse_cost(u, "totalCost")
                .or_else(|| parse_cost(u, "total_cost"))
                .or_else(|| parse_cost(u, "cost"))
        });

        out.push(SessionHookEvent {
            ts,
            hook_name,
            agent_id: value
                .get("agent_id")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string()),
            task_id: value
                .get("taskId")
                .or_else(|| value.get("conversation_id"))
                .and_then(|v| v.as_str())
                .map(|v| v.to_string()),
            parent_agent_id: value
                .get("parent_agent_id")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string()),
            iteration: value.get("iteration").and_then(|v| v.as_u64()),
            tool_name,
            tool_input,
            tool_output,
            tool_error,
            input_tokens,
            output_tokens,
            total_cost,
        });
    }

    let max = limit.unwrap_or(300);
    if out.len() > max {
        out = out.split_off(out.len() - max);
    }

    Ok(out)
}

#[tauri::command]
fn read_team_state(team_name: String) -> Result<Option<Value>, String> {
    let Some(path) = team_state_path(&team_name) else {
        return Ok(None);
    };
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path).map_err(|e| format!("failed reading team state: {e}"))?;
    let parsed =
        serde_json::from_str::<Value>(&raw).map_err(|e| format!("invalid team state JSON: {e}"))?;
    Ok(Some(parsed))
}

#[tauri::command]
fn read_team_history(
    team_name: String,
    limit: Option<usize>,
) -> Result<Vec<TeamHistoryItem>, String> {
    let Some(path) = team_history_path(&team_name) else {
        return Ok(vec![]);
    };
    if !path.exists() {
        return Ok(vec![]);
    }

    let raw = fs::read_to_string(path).map_err(|e| format!("failed reading team history: {e}"))?;
    let mut out: Vec<TeamHistoryItem> = Vec::new();

    for line in raw.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<Value>(line) {
            let ts = value
                .get("ts")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let item_type = value
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let task = value.get("task").cloned().unwrap_or(Value::Null);
            out.push(TeamHistoryItem {
                ts,
                item_type,
                task,
            });
        }
    }

    let max = limit.unwrap_or(200);
    if out.len() > max {
        out = out.split_off(out.len() - max);
    }

    Ok(out)
}

#[tauri::command]
fn list_existing_teams() -> Result<Vec<String>, String> {
    let Some(base) = team_base_dir() else {
        return Ok(vec![]);
    };
    if !base.exists() {
        return Ok(vec![]);
    }

    let mut out: Vec<String> = Vec::new();
    let entries = fs::read_dir(base).map_err(|e| format!("failed reading team directory: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let state_path = path.join("state.json");
        let history_path = path.join("task-history.jsonl");
        if !state_path.exists() && !history_path.exists() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().trim().to_string();
        if !name.is_empty() {
            out.push(name);
        }
    }
    out.sort();
    out.dedup();
    Ok(out)
}

#[tauri::command]
fn get_process_context(context: State<'_, AppContext>) -> ProcessContext {
    ProcessContext {
        workspace_root: context.workspace_root.clone(),
        cwd: context.launch_cwd.clone(),
    }
}

#[tauri::command]
fn get_git_branch(context: State<'_, AppContext>, cwd: Option<String>) -> GitBranchContext {
    let target_cwd = cwd
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| context.launch_cwd.clone());

    GitBranchContext {
        branch: resolve_git_branch(&target_cwd),
    }
}

#[tauri::command]
fn list_git_branches(context: State<'_, AppContext>, cwd: Option<String>) -> GitBranchesContext {
    let target_cwd = cwd
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| context.launch_cwd.clone());

    resolve_git_branches(&target_cwd)
}

#[tauri::command]
fn checkout_git_branch(
    context: State<'_, AppContext>,
    cwd: Option<String>,
    branch: String,
) -> Result<GitBranchContext, String> {
    let target_cwd = cwd
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| context.launch_cwd.clone());

    run_checkout_git_branch(&target_cwd, &branch)?;
    Ok(GitBranchContext {
        branch: resolve_git_branch(&target_cwd),
    })
}

async fn handle_chat_session_command(
    app: &AppHandle,
    state: &Arc<ChatSessionStore>,
    context: &AppContext,
    request: ChatSessionCommandRequest,
) -> Result<ChatSessionCommandResponse, String> {
    match request.action.as_str() {
        "start" => {
            let Some(mut config) = request.config else {
                return Err("missing config for start action".to_string());
            };
            resolve_chat_config_api_key(&mut config)?;
            ensure_start_session_home_dir(&mut config);
            let session_id = create_chat_session_via_rpc_runtime(app, state, context, &config)?;
            ensure_chat_stream_subscription(app, state, context, &session_id)?;
            let mut sessions = state
                .sessions
                .lock()
                .map_err(|_| "failed to lock chat session store")?;
            sessions.insert(
                session_id.clone(),
                ChatRuntimeSession {
                    config,
                    messages: Vec::new(),
                    busy: false,
                    started_at: now_ms(),
                    ended_at: None,
                    status: "idle".to_string(),
                    prompt: None,
                },
            );
            Ok(ChatSessionCommandResponse {
                session_id: Some(session_id),
                result: None,
                ok: None,
            })
        }
        "send" => {
            let prompt = request.prompt.unwrap_or_default().trim().to_string();
            let attachments = request.attachments.clone();
            let has_attachments = attachments
                .as_ref()
                .map(|value| !value.user_images.is_empty() || !value.user_files.is_empty())
                .unwrap_or(false);
            if prompt.is_empty() && !has_attachments {
                return Err("prompt is required for send action".to_string());
            }
            let Some(session_id) = request.session_id else {
                return Err("sessionId is required for send action".to_string());
            };

            let has_live_session = {
                let sessions = state
                    .sessions
                    .lock()
                    .map_err(|_| "failed to lock chat session store")?;
                sessions.contains_key(&session_id)
            };
            if !has_live_session {
                let mut config = request
                    .config
                    .clone()
                    .ok_or_else(|| "session not found. start a new session.".to_string())?;
                resolve_chat_config_api_key(&mut config)?;
                ensure_start_session_home_dir(&mut config);
                let messages = read_persisted_chat_messages(&session_id)?
                    .ok_or_else(|| "session not found. start a new session.".to_string())?;
                let mut sessions = state
                    .sessions
                    .lock()
                    .map_err(|_| "failed to lock chat session store")?;
                sessions
                    .entry(session_id.clone())
                    .or_insert(ChatRuntimeSession {
                        config,
                        prompt: derive_prompt_from_messages(&messages),
                        messages,
                        busy: false,
                        started_at: now_ms(),
                        ended_at: None,
                        status: "idle".to_string(),
                    });
            }

            let (config, messages) = {
                let mut sessions = state
                    .sessions
                    .lock()
                    .map_err(|_| "failed to lock chat session store")?;
                let session = sessions
                    .get_mut(&session_id)
                    .ok_or_else(|| "session not found. start a new session.".to_string())?;
                if let Some(mut next_config) = request.config.clone() {
                    resolve_chat_config_api_key(&mut next_config)?;
                    ensure_start_session_home_dir(&mut next_config);
                    session.config = next_config;
                }
                if session.busy {
                    return Err("session is busy. wait for current response to finish.".to_string());
                }
                session.busy = true;
                session.status = "running".to_string();
                session.ended_at = None;
                if !prompt.is_empty() {
                    // Keep sidebar/session discovery title in sync while turn is in-flight.
                    session.prompt = Some(prompt.clone());
                }
                (session.config.clone(), session.messages.clone())
            };

            let session_id_for_turn = session_id.clone();
            let app_for_turn = app.clone();
            let state_for_turn = state.clone();
            let context_for_turn = context.clone();
            ensure_chat_stream_subscription(app, state, &context_for_turn, &session_id_for_turn)?;
            let turn_request = ChatRunTurnRequest {
                config: config.clone(),
                messages,
                prompt: prompt.clone(),
                attachments,
            };

            let turn_result = tauri::async_runtime::spawn_blocking(move || {
                run_chat_turn_via_rpc_runtime(
                    &app_for_turn,
                    &state_for_turn,
                    &context_for_turn,
                    &session_id_for_turn,
                    &turn_request,
                )
            })
            .await
            .map_err(|e| format!("chat turn task failed: {e}"));

            let mut sessions = state
                .sessions
                .lock()
                .map_err(|_| "failed to lock chat session store")?;
            if let Some(session) = sessions.get_mut(&session_id) {
                session.busy = false;
                if let Ok(Ok(result)) = &turn_result {
                    session.messages = result.messages.clone();
                    session.status = normalize_chat_finish_status(result.finish_reason.as_deref());
                    session.ended_at = Some(now_ms());
                    append_chat_usage_hook_event(&session_id, result);
                    if let Some(path) = shared_session_messages_write_path(&session_id) {
                        if let Some(parent) = path.parent() {
                            let _ = fs::create_dir_all(parent);
                        }
                        let body = serde_json::json!({
                            "messages": result.messages,
                            "ts": now_ms(),
                        });
                        if let Ok(encoded) = serde_json::to_vec(&body) {
                            let _ = fs::write(path, encoded);
                        }
                    }
                } else {
                    session.status = "failed".to_string();
                    session.ended_at = Some(now_ms());
                    if let Ok(Some(messages)) = read_persisted_chat_messages(&session_id) {
                        session.messages = messages;
                    }
                }
            }

            let turn_result = turn_result?;
            let result = turn_result?;
            Ok(ChatSessionCommandResponse {
                session_id: Some(session_id),
                result: Some(result),
                ok: None,
            })
        }
        "abort" => Ok(ChatSessionCommandResponse {
            session_id: {
                if let Some(session_id) = request.session_id.clone() {
                    abort_chat_session_via_rpc_runtime(app, state, context, &session_id)?;
                    let mut sessions = state
                        .sessions
                        .lock()
                        .map_err(|_| "failed to lock chat session store")?;
                    if let Some(session) = sessions.get_mut(&session_id) {
                        session.busy = false;
                        session.status = "cancelled".to_string();
                        session.ended_at = Some(now_ms());
                    }
                }
                request.session_id
            },
            result: None,
            ok: Some(true),
        }),
        "reset" => {
            if let Some(session_id) = request.session_id.clone() {
                let mut sessions = state
                    .sessions
                    .lock()
                    .map_err(|_| "failed to lock chat session store")?;
                sessions.remove(&session_id);
                let _ = reset_chat_session_via_rpc_runtime(app, state, context, Some(&session_id));
                let _ = remove_chat_stream_subscription(app, state, context, &session_id);
            }
            Ok(ChatSessionCommandResponse {
                session_id: request.session_id,
                result: None,
                ok: Some(true),
            })
        }
        _ => Err("unsupported action".to_string()),
    }
}

#[tauri::command]
async fn chat_session_command(
    app: AppHandle,
    state: State<'_, Arc<ChatSessionStore>>,
    context: State<'_, AppContext>,
    request: ChatSessionCommandRequest,
) -> Result<ChatSessionCommandResponse, String> {
    handle_chat_session_command(&app, state.inner(), context.inner(), request).await
}

#[tauri::command]
fn read_session_transcript(session_id: String, max_chars: Option<usize>) -> Result<String, String> {
    let (path, is_jsonl) = match shared_session_log_path(&session_id) {
        Some(path) if path.exists() => (path, false),
        _ => return Ok(String::new()),
    };
    if !path.exists() {
        return Ok(String::new());
    }
    let raw =
        fs::read_to_string(path).map_err(|e| format!("failed reading session transcript: {e}"))?;
    let mut out = String::new();
    if is_jsonl {
        for line in raw.lines() {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(value) = serde_json::from_str::<Value>(line) {
                if let Some(chunk) = value.get("chunk").and_then(|v| v.as_str()) {
                    out.push_str(chunk);
                }
            }
        }
    } else {
        out = raw;
    }
    if let Some(limit) = max_chars {
        if out.chars().count() > limit {
            let start = out.chars().count().saturating_sub(limit);
            out = out.chars().skip(start).collect();
        }
    }
    Ok(out)
}

#[tauri::command]
fn read_session_messages(
    chat_state: State<'_, Arc<ChatSessionStore>>,
    session_id: String,
    max_messages: Option<usize>,
) -> Result<Vec<HydratedChatMessage>, String> {
    let messages = if let Some(path) = shared_session_messages_path(&session_id) {
        if path.exists() {
            let raw = fs::read_to_string(path)
                .map_err(|e| format!("failed reading session messages: {e}"))?;
            let parsed = serde_json::from_str::<Value>(&raw)
                .map_err(|e| format!("failed parsing session messages: {e}"))?;
            parsed
                .get("messages")
                .and_then(|v| v.as_array())
                .or_else(|| parsed.as_array())
                .cloned()
                .unwrap_or_default()
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    let messages = if messages.is_empty() {
        let sessions = chat_state
            .sessions
            .lock()
            .map_err(|_| "failed to lock chat session store")?;
        sessions
            .get(&session_id)
            .map(|session| session.messages.clone())
            .unwrap_or_default()
    } else {
        messages
    };

    let max = max_messages.unwrap_or(800).max(1);
    let start = messages.len().saturating_sub(max);
    let base_ts = now_ms().saturating_sub(messages.len() as u64);
    let mut out: Vec<HydratedChatMessage> = Vec::new();
    let mut pending_tool_messages: HashMap<String, (usize, String, Value)> = HashMap::new();

    for (idx, message) in messages.iter().enumerate().skip(start) {
        let role_raw = message
            .get("role")
            .and_then(|v| v.as_str())
            .unwrap_or("assistant");
        let role = match role_raw {
            "user" | "assistant" | "tool" | "system" | "status" | "error" => role_raw,
            _ => "assistant",
        };
        let created_at_base = message
            .get("ts")
            .and_then(|v| v.as_u64())
            .unwrap_or(base_ts.saturating_add(idx as u64));
        let message_id_base = message
            .get("id")
            .and_then(|v| v.as_str())
            .filter(|v| !v.trim().is_empty())
            .map(|v| v.to_string())
            .unwrap_or_else(|| format!("history_message_{idx}"));

        let Some(content_blocks) = message.get("content").and_then(|v| v.as_array()) else {
            let content = stringify_message_content(message.get("content").unwrap_or(&Value::Null));
            if content.trim().is_empty() {
                continue;
            }
            out.push(HydratedChatMessage {
                id: message_id_base,
                session_id: Some(session_id.clone()),
                role: role.to_string(),
                content,
                created_at: created_at_base,
                meta: None,
            });
            continue;
        };

        let mut text_parts: Vec<String> = Vec::new();
        let mut text_segment_index: usize = 0;

        for (block_idx, block) in content_blocks.iter().enumerate() {
            let block_ts = created_at_base.saturating_add(block_idx as u64);
            let Some(obj) = block.as_object() else {
                let line = stringify_message_content(block);
                if !line.trim().is_empty() {
                    text_parts.push(line);
                }
                continue;
            };

            let block_type = obj.get("type").and_then(|v| v.as_str()).unwrap_or_default();
            match block_type {
                "tool_use" => {
                    flush_hydrated_text_parts(
                        &mut out,
                        &mut text_parts,
                        &session_id,
                        role,
                        &message_id_base,
                        &mut text_segment_index,
                        block_ts,
                    );
                    let tool_name = obj
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("tool_call")
                        .to_string();
                    let tool_use_id = obj
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let input = obj.get("input").cloned().unwrap_or(Value::Null);
                    let payload =
                        build_tool_payload_json(&tool_name, input.clone(), Value::Null, false);
                    let out_index = out.len();
                    out.push(HydratedChatMessage {
                        id: format!("{message_id_base}_tool_use_{block_idx}"),
                        session_id: Some(session_id.clone()),
                        role: "tool".to_string(),
                        content: payload,
                        created_at: block_ts,
                        meta: Some(HydratedChatMessageMeta {
                            tool_name: Some(tool_name.clone()),
                            hook_event_name: Some("history_tool_use".to_string()),
                        }),
                    });
                    if !tool_use_id.trim().is_empty() {
                        pending_tool_messages.insert(tool_use_id, (out_index, tool_name, input));
                    }
                }
                "tool_result" => {
                    flush_hydrated_text_parts(
                        &mut out,
                        &mut text_parts,
                        &session_id,
                        role,
                        &message_id_base,
                        &mut text_segment_index,
                        block_ts,
                    );
                    let tool_use_id = obj
                        .get("tool_use_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let result = obj.get("content").cloned().unwrap_or(Value::Null);
                    let is_error = obj
                        .get("is_error")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);

                    if let Some((out_index, tool_name, input)) =
                        pending_tool_messages.remove(&tool_use_id)
                    {
                        if let Some(existing) = out.get_mut(out_index) {
                            existing.content =
                                build_tool_payload_json(&tool_name, input, result, is_error);
                            existing.meta = Some(HydratedChatMessageMeta {
                                tool_name: Some(tool_name),
                                hook_event_name: Some("history_tool_result".to_string()),
                            });
                        }
                    } else {
                        out.push(HydratedChatMessage {
                            id: format!("{message_id_base}_tool_result_{block_idx}"),
                            session_id: Some(session_id.clone()),
                            role: "tool".to_string(),
                            content: build_tool_payload_json(
                                "tool_result",
                                Value::Null,
                                result,
                                is_error,
                            ),
                            created_at: block_ts,
                            meta: Some(HydratedChatMessageMeta {
                                tool_name: Some("tool_result".to_string()),
                                hook_event_name: Some("history_tool_result".to_string()),
                            }),
                        });
                    }
                }
                _ => {
                    let line = stringify_message_content(block);
                    if !line.trim().is_empty() {
                        text_parts.push(line);
                    }
                }
            }
        }

        flush_hydrated_text_parts(
            &mut out,
            &mut text_parts,
            &session_id,
            role,
            &message_id_base,
            &mut text_segment_index,
            created_at_base.saturating_add(content_blocks.len() as u64),
        );
    }

    Ok(out)
}

#[tauri::command]
fn list_chat_sessions(
    state: State<'_, Arc<ChatSessionStore>>,
    limit: Option<usize>,
) -> Result<Vec<CliDiscoveredSession>, String> {
    let max = limit.unwrap_or(300).max(1);
    let mut out: Vec<CliDiscoveredSession> = {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "failed to lock chat session store")?;

        // Drop sessions that were created but never received any messages.
        sessions.retain(|_, session| {
            session.busy || session.prompt.is_some() || session_has_messages(&session.messages)
        });

        sessions
            .iter()
            .map(|(session_id, session)| {
                let prompt = session
                    .prompt
                    .clone()
                    .or_else(|| derive_prompt_from_messages(&session.messages));
                CliDiscoveredSession {
                    session_id: session_id.clone(),
                    title: derive_session_title(session_id, false, None, prompt.as_deref()),
                    status: session.status.clone(),
                    provider: session.config.provider.clone(),
                    model: session.config.model.clone(),
                    cwd: session
                        .config
                        .cwd
                        .clone()
                        .unwrap_or_else(|| session.config.workspace_root.clone()),
                    workspace_root: session.config.workspace_root.clone(),
                    team_name: None,
                    parent_session_id: None,
                    parent_agent_id: None,
                    agent_id: None,
                    conversation_id: None,
                    is_subagent: false,
                    prompt,
                    started_at: session.started_at.to_string(),
                    ended_at: session.ended_at.map(|value| value.to_string()),
                    interactive: false,
                }
            })
            .collect()
    };

    if let Some(base) = shared_session_data_dir() {
        if base.exists() {
            let entries =
                fs::read_dir(base).map_err(|e| format!("failed reading session data dir: {e}"))?;
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let Some(session_id) = path
                    .file_name()
                    .and_then(|v| v.to_str())
                    .map(|v| v.trim().to_string())
                else {
                    continue;
                };
                if out.iter().any(|item| item.session_id == session_id) {
                    continue;
                }
                let manifest_path = path.join(format!("{session_id}.json"));
                let manifest = fs::read_to_string(&manifest_path)
                    .ok()
                    .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
                    .unwrap_or(Value::Null);
                let is_desktop_chat = manifest
                    .get("source")
                    .and_then(|v| v.as_str())
                    .map(|v| v == "desktop-chat")
                    .unwrap_or(false);
                if !is_desktop_chat && !session_id.starts_with("chat_") {
                    continue;
                }
                let msg_path = path.join(format!("{session_id}.messages.json"));
                if !msg_path.exists() {
                    let _ = fs::remove_dir_all(&path);
                    continue;
                }
                let raw = match fs::read_to_string(&msg_path) {
                    Ok(value) => value,
                    Err(_) => continue,
                };
                let parsed: Value = match serde_json::from_str(&raw) {
                    Ok(value) => value,
                    Err(_) => continue,
                };
                let messages = parsed
                    .get("messages")
                    .and_then(|v| v.as_array())
                    .or_else(|| parsed.as_array())
                    .cloned()
                    .unwrap_or_default();
                if !session_has_messages(&messages) {
                    let _ = fs::remove_dir_all(&path);
                    continue;
                }
                let prompt = derive_prompt_from_messages(&messages);
                let file_ts = fs::metadata(&msg_path)
                    .ok()
                    .and_then(|meta| meta.modified().ok())
                    .and_then(|ts| ts.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or_else(now_ms);
                let cwd = json_string_field(&manifest, &["cwd"]).unwrap_or_default();
                let workspace_root =
                    json_string_field(&manifest, &["workspace_root", "workspaceRoot"])
                        .or_else(|| {
                            if cwd.trim().is_empty() {
                                None
                            } else {
                                Some(cwd.clone())
                            }
                        })
                        .unwrap_or_default();
                let provider = json_string_field(&manifest, &["provider"])
                    .unwrap_or_else(|| "unknown".to_string());
                let model = json_string_field(&manifest, &["model"])
                    .unwrap_or_else(|| "unknown".to_string());
                let started_at = json_string_field(&manifest, &["started_at", "startedAt"])
                    .unwrap_or_else(|| file_ts.to_string());
                let ended_at = json_string_field(&manifest, &["ended_at", "endedAt"])
                    .unwrap_or_else(|| file_ts.to_string());
                out.push(CliDiscoveredSession {
                    session_id: session_id.clone(),
                    title: derive_session_title(&session_id, false, None, prompt.as_deref()),
                    status: "completed".to_string(),
                    provider,
                    model,
                    cwd,
                    workspace_root,
                    team_name: None,
                    parent_session_id: None,
                    parent_agent_id: None,
                    agent_id: None,
                    conversation_id: None,
                    is_subagent: false,
                    prompt,
                    started_at,
                    ended_at: Some(ended_at),
                    interactive: false,
                });
            }
        }
    }

    out.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    if out.len() > max {
        out.truncate(max);
    }
    Ok(out)
}

#[tauri::command]
fn delete_chat_session(
    app: AppHandle,
    state: State<'_, Arc<ChatSessionStore>>,
    context: State<'_, AppContext>,
    session_id: String,
) -> Result<(), String> {
    let trimmed_session_id = session_id.trim();
    if trimmed_session_id.is_empty() {
        return Err("session id is required".to_string());
    }

    {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "failed to lock chat session store")?;
        sessions.remove(trimmed_session_id);
    }
    let _ = remove_chat_stream_subscription(&app, state.inner(), &context, trimmed_session_id);

    remove_persisted_session_artifacts(&[trimmed_session_id.to_string()]);

    Ok(())
}

#[tauri::command]
fn poll_tool_approvals(
    session_id: String,
    limit: Option<usize>,
) -> Result<Vec<ToolApprovalRequestItem>, String> {
    let Some(dir) = tool_approval_dir() else {
        return Ok(vec![]);
    };
    if !dir.exists() {
        return Ok(vec![]);
    }

    let prefix = tool_approval_request_prefix(&session_id);
    let mut items: Vec<ToolApprovalRequestItem> = Vec::new();
    let entries = fs::read_dir(dir).map_err(|e| format!("failed reading tool approvals: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|v| v.to_str()) else {
            continue;
        };
        if !name.starts_with(&prefix) || !name.ends_with(".json") {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(parsed) = serde_json::from_str::<ToolApprovalRequestItem>(&raw) else {
            continue;
        };
        items.push(parsed);
    }

    items.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    let max = limit.unwrap_or(20);
    if items.len() > max {
        items.truncate(max);
    }
    Ok(items)
}

#[tauri::command]
fn respond_tool_approval(
    session_id: String,
    request_id: String,
    approved: bool,
    reason: Option<String>,
) -> Result<(), String> {
    let Some(path) = tool_approval_decision_path(&session_id, &request_id) else {
        return Err("tool approval decision path unavailable".to_string());
    };
    let request_path =
        tool_approval_dir().map(|dir| dir.join(format!("{session_id}.request.{request_id}.json")));
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("failed preparing approval dir: {e}"))?;
    }
    let body = serde_json::json!({
        "approved": approved,
        "reason": reason,
        "ts": now_ms(),
    });
    fs::write(
        path,
        serde_json::to_vec(&body).map_err(|e| format!("failed encoding decision: {e}"))?,
    )
    .map_err(|e| format!("failed writing tool approval decision: {e}"))?;
    if let Some(req_path) = request_path {
        let _ = fs::remove_file(req_path);
    }
    Ok(())
}

#[tauri::command]
fn list_user_instruction_configs(
    context: State<'_, AppContext>,
) -> Result<UserInstructionListsResponse, String> {
    let Some(cli_entrypoint) = resolve_workspace_cli_entrypoint_path(&context.workspace_root)
    else {
        return Err(format!(
            "CLI entrypoint not found under workspace_root={}",
            context.workspace_root
        ));
    };

    let mut warnings: Vec<String> = Vec::new();

    let rules = match run_cli_list_json_command(&cli_entrypoint, &context.workspace_root, "rules")
        .and_then(|raw| parse_cli_list_json::<RuleListItem>("rules", &raw))
    {
        Ok(items) => items,
        Err(error) => {
            warnings.push(format!("rules: {error}"));
            Vec::new()
        }
    };

    let workflows =
        match run_cli_list_json_command(&cli_entrypoint, &context.workspace_root, "workflows")
            .and_then(|raw| parse_cli_list_json::<WorkflowListItem>("workflows", &raw))
        {
            Ok(items) => items,
            Err(error) => {
                warnings.push(format!("workflows: {error}"));
                Vec::new()
            }
        };

    let skills = match run_cli_list_json_command(&cli_entrypoint, &context.workspace_root, "skills")
        .and_then(|raw| parse_cli_list_json::<SkillListItem>("skills", &raw))
    {
        Ok(items) => items,
        Err(error) => {
            warnings.push(format!("skills: {error}"));
            Vec::new()
        }
    };

    let agents = match run_cli_list_json_command(&cli_entrypoint, &context.workspace_root, "agents")
        .and_then(|raw| parse_cli_list_json::<AgentListItem>("agents", &raw))
    {
        Ok(items) => items,
        Err(error) => {
            warnings.push(format!("agents: {error}"));
            Vec::new()
        }
    };

    let hooks = match run_cli_list_json_command(&cli_entrypoint, &context.workspace_root, "hooks")
        .and_then(|raw| parse_cli_list_json::<HookListItem>("hooks", &raw))
    {
        Ok(items) => items,
        Err(error) => {
            warnings.push(format!("hooks: {error}"));
            Vec::new()
        }
    };

    Ok(UserInstructionListsResponse {
        workspace_root: context.workspace_root.clone(),
        rules,
        workflows,
        skills,
        agents,
        hooks,
        warnings,
    })
}

#[tauri::command]
fn list_mcp_servers() -> Result<McpServersResponse, String> {
    let settings_path = resolve_mcp_settings_path()?;
    let has_settings_file = settings_path.exists();
    let servers = read_mcp_servers_from_path(&settings_path)?;
    Ok(McpServersResponse {
        settings_path: settings_path.to_string_lossy().to_string(),
        has_settings_file,
        servers,
    })
}

#[tauri::command]
fn set_mcp_server_disabled(name: String, disabled: bool) -> Result<McpServersResponse, String> {
    let server_name = name.trim().to_string();
    if server_name.is_empty() {
        return Err("server name is required".to_string());
    }
    let settings_path = resolve_mcp_settings_path()?;
    let mut servers = read_mcp_servers_map(&settings_path)?;
    let Some(body) = servers.get(&server_name).cloned() else {
        return Err(format!("unknown MCP server: {server_name}"));
    };
    let mut record = parse_mcp_server_record(&server_name, &body)?;
    record.disabled = disabled;
    servers.insert(server_name, server_record_to_json(&record)?);
    write_mcp_servers_map(&settings_path, servers)?;
    list_mcp_servers()
}

#[tauri::command]
fn upsert_mcp_server(input: McpServerUpsertInput) -> Result<McpServersResponse, String> {
    let server_name = input.name.trim().to_string();
    if server_name.is_empty() {
        return Err("server name is required".to_string());
    }
    let transport_type = input.transport_type.trim().to_string();
    if transport_type != "stdio" && transport_type != "sse" && transport_type != "streamableHttp" {
        return Err("transportType must be one of: stdio, sse, streamableHttp".to_string());
    }
    let settings_path = resolve_mcp_settings_path()?;
    let mut servers = read_mcp_servers_map(&settings_path)?;
    let record = McpServerRecord {
        name: server_name.clone(),
        transport_type,
        disabled: input.disabled.unwrap_or(false),
        command: input.command,
        args: input.args,
        cwd: input.cwd,
        env: input.env,
        url: input.url,
        headers: input.headers,
        metadata: input.metadata,
    };
    let json = server_record_to_json(&record)?;
    servers.insert(server_name, json);
    write_mcp_servers_map(&settings_path, servers)?;
    list_mcp_servers()
}

#[tauri::command]
fn delete_mcp_server(name: String) -> Result<McpServersResponse, String> {
    let server_name = name.trim().to_string();
    if server_name.is_empty() {
        return Err("server name is required".to_string());
    }
    let settings_path = resolve_mcp_settings_path()?;
    let mut servers = read_mcp_servers_map(&settings_path)?;
    if servers.remove(&server_name).is_none() {
        return Err(format!("unknown MCP server: {server_name}"));
    }
    write_mcp_servers_map(&settings_path, servers)?;
    list_mcp_servers()
}

#[tauri::command]
fn open_mcp_settings_file() -> Result<String, String> {
    let settings_path = resolve_mcp_settings_path()?;
    if !settings_path.exists() {
        if let Some(parent) = settings_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("failed creating MCP settings directory: {e}"))?;
        }
        let initial = serde_json::json!({
            "mcpServers": {}
        });
        let mut body = serde_json::to_vec_pretty(&initial)
            .map_err(|e| format!("failed encoding MCP settings: {e}"))?;
        body.push(b'\n');
        fs::write(&settings_path, body)
            .map_err(|e| format!("failed writing MCP settings file: {e}"))?;
    }
    open_path_with_default_app(&settings_path)?;
    Ok(settings_path.to_string_lossy().to_string())
}

fn main() {
    let store = Arc::new(SessionStore::default());
    let chat_store = Arc::new(ChatSessionStore::default());
    let chat_ws_bridge = Arc::new(ChatWsBridgeState::default());
    let launch_cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string());
    let workspace_root = resolve_workspace_root(&launch_cwd);
    let app_context = AppContext {
        launch_cwd,
        workspace_root,
    };
    if let Err(error) = bootstrap_rpc_gateway(&app_context) {
        eprintln!("[rpc] startup bootstrap failed: {error}");
    }

    tauri::Builder::default()
        .manage(store)
        .manage(chat_store)
        .manage(chat_ws_bridge)
        .manage(app_context)
        .setup(|app| {
            let app_handle = app.handle().clone();
            let chat_state = app.state::<Arc<ChatSessionStore>>().inner().clone();
            let app_context = app.state::<AppContext>().inner().clone();
            let chat_ws = app.state::<Arc<ChatWsBridgeState>>().inner().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) =
                    start_chat_ws_bridge(app_handle, chat_state, app_context, chat_ws).await
                {
                    eprintln!("[chat-ws] bridge exited: {error}");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_session,
            send_prompt,
            abort_session,
            stop_session,
            poll_sessions,
            list_cli_sessions,
            run_provider_oauth_login,
            list_provider_catalog,
            list_provider_models,
            save_provider_settings,
            search_workspace_files,
            delete_cli_session,
            read_session_hooks,
            read_team_state,
            read_team_history,
            list_existing_teams,
            get_process_context,
            get_git_branch,
            list_git_branches,
            checkout_git_branch,
            list_user_instruction_configs,
            list_mcp_servers,
            set_mcp_server_disabled,
            upsert_mcp_server,
            delete_mcp_server,
            open_mcp_settings_file,
            get_chat_ws_endpoint,
            chat_session_command,
            read_session_transcript,
            read_session_messages,
            list_chat_sessions,
            delete_chat_session,
            poll_tool_approvals,
            respond_tool_approval
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri app");
}
