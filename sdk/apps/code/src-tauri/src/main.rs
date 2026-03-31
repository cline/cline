#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use futures_util::{SinkExt, StreamExt};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
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

#[derive(Default)]
struct DesktopBackendState {
    ws_endpoint: Mutex<Option<String>>,
    process: Mutex<Option<Child>>,
}

impl Drop for DesktopBackendState {
    fn drop(&mut self) {
        if let Ok(mut process_guard) = self.process.lock() {
            if let Some(child) = process_guard.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
            *process_guard = None;
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopBackendReadyLine {
    #[serde(rename = "type")]
    line_type: String,
    endpoint: Option<String>,
    ws_endpoint: Option<String>,
    pid: Option<u64>,
    mode: Option<String>,
}

const DEFAULT_RPC_ADDRESS: &str = "127.0.0.1:4317";
const DEFAULT_RPC_CLIENT_ID: &str = "code-desktop";
const DEFAULT_RPC_CLIENT_TYPE: &str = "desktop";
const CHAT_RUNTIME_BRIDGE_RESPONSE_TIMEOUT_MS: u64 = 130000;

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
    delivery: Option<String>,
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
    redacted: Option<bool>,
    tool_call_id: Option<String>,
    tool_name: Option<String>,
    input: Option<Value>,
    output: Option<Value>,
    error: Option<String>,
    duration_ms: Option<u64>,
    message: Option<String>,
    prompts: Option<Vec<PendingPromptSnapshot>>,
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
    prompt_id: Option<String>,
    delivery: Option<String>,
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
    queued: Option<bool>,
    #[serde(default)]
    prompts_in_queue: Vec<PromptInQueue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingPromptSnapshot {
    id: String,
    prompt: String,
    delivery: String,
    attachment_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PromptInQueue {
    id: String,
    prompt: String,
    steer: bool,
    attachment_count: Option<u64>,
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
    prompts_in_queue: Vec<PromptInQueue>,
    busy: bool,
    started_at: u64,
    ended_at: Option<u64>,
    status: String,
    prompt: Option<String>,
    title: Option<String>,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CliDiscoveredSession {
    session_id: String,
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
    metadata: Option<Value>,
    started_at: String,
    ended_at: Option<String>,
    interactive: bool,
}

fn session_started_at_rank(value: &str) -> i128 {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return i128::MIN;
    }
    if let Ok(raw) = trimmed.parse::<i128>() {
        if trimmed.len() == 10 {
            return raw.saturating_mul(1000);
        }
        return raw;
    }
    i128::MIN
}

fn session_metadata_title(metadata: &Option<Value>) -> Option<String> {
    let object = metadata.as_ref()?.as_object()?;
    normalize_session_title(object.get("title").and_then(|value| value.as_str()))
}

fn merge_session_metadata(preferred: &Option<Value>, fallback: &Option<Value>) -> Option<Value> {
    let mut merged = serde_json::Map::new();
    if let Some(Value::Object(map)) = fallback {
        for (key, value) in map {
            merged.insert(key.clone(), value.clone());
        }
    }
    if let Some(Value::Object(map)) = preferred {
        for (key, value) in map {
            merged.insert(key.clone(), value.clone());
        }
    }
    let preferred_title = session_metadata_title(preferred);
    let fallback_title = session_metadata_title(fallback);
    if let Some(title) = preferred_title.or(fallback_title) {
        merged.insert("title".to_string(), Value::String(title));
    }
    if merged.is_empty() {
        None
    } else {
        Some(Value::Object(merged))
    }
}

fn pick_non_empty(primary: String, fallback: String) -> String {
    if primary.trim().is_empty() {
        fallback
    } else {
        primary
    }
}

fn pick_option_non_empty(primary: Option<String>, fallback: Option<String>) -> Option<String> {
    match primary {
        Some(value) if !value.trim().is_empty() => Some(value),
        _ => fallback,
    }
}

fn merge_discovered_session_pair(
    existing: CliDiscoveredSession,
    incoming: CliDiscoveredSession,
) -> CliDiscoveredSession {
    let existing_rank = session_started_at_rank(&existing.started_at);
    let incoming_rank = session_started_at_rank(&incoming.started_at);
    let incoming_is_newer = if incoming_rank == existing_rank {
        incoming.session_id >= existing.session_id
    } else {
        incoming_rank > existing_rank
    };
    let (newer, older) = if incoming_is_newer {
        (incoming, existing)
    } else {
        (existing, incoming)
    };

    CliDiscoveredSession {
        session_id: newer.session_id.clone(),
        status: pick_non_empty(newer.status, older.status),
        provider: pick_non_empty(newer.provider, older.provider),
        model: pick_non_empty(newer.model, older.model),
        cwd: pick_non_empty(newer.cwd, older.cwd),
        workspace_root: pick_non_empty(newer.workspace_root, older.workspace_root),
        team_name: pick_option_non_empty(newer.team_name, older.team_name),
        parent_session_id: pick_option_non_empty(newer.parent_session_id, older.parent_session_id),
        parent_agent_id: pick_option_non_empty(newer.parent_agent_id, older.parent_agent_id),
        agent_id: pick_option_non_empty(newer.agent_id, older.agent_id),
        conversation_id: pick_option_non_empty(newer.conversation_id, older.conversation_id),
        is_subagent: newer.is_subagent || older.is_subagent,
        prompt: pick_option_non_empty(newer.prompt, older.prompt),
        metadata: merge_session_metadata(&newer.metadata, &older.metadata),
        started_at: pick_non_empty(newer.started_at, older.started_at),
        ended_at: pick_option_non_empty(newer.ended_at, older.ended_at),
        interactive: newer.interactive || older.interactive,
    }
}

fn merge_discovered_session_lists(
    chat_sessions: Vec<CliDiscoveredSession>,
    cli_sessions: Vec<CliDiscoveredSession>,
    max: usize,
) -> Vec<CliDiscoveredSession> {
    let mut by_id: HashMap<String, CliDiscoveredSession> = HashMap::new();
    for session in chat_sessions.into_iter().chain(cli_sessions.into_iter()) {
        let id = session.session_id.clone();
        if let Some(existing) = by_id.remove(&id) {
            by_id.insert(id, merge_discovered_session_pair(existing, session));
        } else {
            by_id.insert(id, session);
        }
    }
    let mut out: Vec<CliDiscoveredSession> = by_id.into_values().collect();
    out.sort_by(|a, b| {
        session_started_at_rank(&b.started_at)
            .cmp(&session_started_at_rank(&a.started_at))
            .then_with(|| b.session_id.cmp(&a.session_id))
    });
    if out.len() > max {
        out.truncate(max);
    }
    out
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
    message_kind: Option<String>,
    display_role: Option<String>,
    reason: Option<String>,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    total_cost: Option<f64>,
    provider_id: Option<String>,
    model_id: Option<String>,
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

fn json_bool_field(value: &Value, keys: &[&str]) -> Option<bool> {
    for key in keys {
        let next = value.get(key).and_then(|entry| match entry {
            Value::Bool(flag) => Some(*flag),
            Value::Number(number) => number.as_i64().map(|raw| raw != 0),
            Value::String(text) => {
                let normalized = text.trim().to_lowercase();
                if normalized == "true" || normalized == "1" {
                    Some(true)
                } else if normalized == "false" || normalized == "0" {
                    Some(false)
                } else {
                    None
                }
            }
            _ => None,
        });
        if next.is_some() {
            return next;
        }
    }
    None
}

fn json_object_field(value: &Value, keys: &[&str]) -> Option<Value> {
    for key in keys {
        let next = value.get(key).and_then(|entry| {
            if entry.is_object() {
                Some(entry.clone())
            } else {
                None
            }
        });
        if next.is_some() {
            return next;
        }
    }
    None
}

fn normalize_session_title(title: Option<&str>) -> Option<String> {
    let raw = title.unwrap_or_default().trim();
    if raw.is_empty() {
        return None;
    }
    let mut out = raw.to_string();
    if out.chars().count() > 140 {
        out = out.chars().take(140).collect();
    }
    Some(out)
}

fn parse_json_object_string(raw: &str) -> Option<Value> {
    let parsed = serde_json::from_str::<Value>(raw).ok()?;
    if parsed.is_object() {
        Some(parsed)
    } else {
        None
    }
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

    let home = std::env::var("HOME").ok()?;
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
    let home = std::env::var("HOME").ok()?;
    Some(
        PathBuf::from(home)
            .join(".cline")
            .join("data")
            .join("sessions"),
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

fn persist_usage_in_messages(
    messages: &[Value],
    config: &StartSessionRequest,
    result: &ChatTurnResult,
) -> Vec<Value> {
    let mut next = messages.to_vec();
    let assistant_index = next.iter().rposition(|message| {
        message
            .get("role")
            .and_then(|value| value.as_str())
            .map(|role| role == "assistant")
            .unwrap_or(false)
    });

    let Some(index) = assistant_index else {
        return next;
    };
    let Some(assistant_message) = next.get_mut(index).and_then(Value::as_object_mut) else {
        return next;
    };

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

    if let Some(metrics) = assistant_message
        .entry("metrics")
        .or_insert_with(|| Value::Object(serde_json::Map::new()))
        .as_object_mut()
    {
        if let Some(value) = input_tokens {
            metrics.insert("inputTokens".to_string(), Value::from(value));
        }
        if let Some(value) = output_tokens {
            metrics.insert("outputTokens".to_string(), Value::from(value));
        }
        if let Some(value) = total_cost {
            metrics.insert("cost".to_string(), Value::from(value));
        }
    }

    let provider_id = config.provider.trim();
    let model_id = config.model.trim();
    if !provider_id.is_empty() {
        assistant_message.insert(
            "providerId".to_string(),
            Value::String(provider_id.to_string()),
        );
    }
    if !model_id.is_empty() {
        assistant_message.insert("modelId".to_string(), Value::String(model_id.to_string()));
    }

    let model_info_entry = assistant_message
        .entry("modelInfo")
        .or_insert_with(|| Value::Object(serde_json::Map::new()));
    if let Some(model_info) = model_info_entry.as_object_mut() {
        if !model_id.is_empty() && !model_info.contains_key("id") {
            model_info.insert("id".to_string(), Value::String(model_id.to_string()));
        }
        if !provider_id.is_empty() && !model_info.contains_key("provider") {
            model_info.insert(
                "provider".to_string(),
                Value::String(provider_id.to_string()),
            );
        }
    }

    if !assistant_message.contains_key("ts") {
        assistant_message.insert("ts".to_string(), Value::from(now_ms()));
    }

    next
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
        let is_recovery_notice = message
            .get("metadata")
            .and_then(|value| value.as_object())
            .and_then(|metadata| metadata.get("kind"))
            .and_then(|value| value.as_str())
            .map(|kind| kind == "recovery_notice")
            .unwrap_or(false);
        if is_recovery_notice {
            continue;
        }
        let content = stringify_message_content(message.get("content").unwrap_or(&Value::Null));
        let trimmed = content.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    None
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

fn parse_u64_value(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_f64().map(|n| n.max(0.0) as u64))
        .or_else(|| value.as_str().and_then(|s| s.parse::<u64>().ok()))
}

fn parse_f64_value(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_u64().map(|n| n as f64))
        .or_else(|| value.as_str().and_then(|s| s.parse::<f64>().ok()))
        .filter(|n| n.is_finite() && *n >= 0.0)
}

fn extract_message_usage_meta(message: &Value) -> Option<HydratedChatMessageMeta> {
    let metrics = message
        .get("metrics")
        .and_then(|v| v.as_object())
        .map(|obj| Value::Object(obj.clone()));
    let model_info = message
        .get("modelInfo")
        .and_then(|v| v.as_object())
        .map(|obj| Value::Object(obj.clone()));

    let input_tokens = metrics
        .as_ref()
        .and_then(|m| m.get("inputTokens"))
        .and_then(parse_u64_value);
    let output_tokens = metrics
        .as_ref()
        .and_then(|m| m.get("outputTokens"))
        .and_then(parse_u64_value);
    let total_cost = metrics
        .as_ref()
        .and_then(|m| m.get("cost"))
        .and_then(parse_f64_value);
    let provider_id = message
        .get("providerId")
        .and_then(|v| v.as_str())
        .map(|v| v.to_string())
        .or_else(|| {
            model_info
                .as_ref()
                .and_then(|info| info.get("provider"))
                .and_then(|v| v.as_str())
                .map(|v| v.to_string())
        });
    let model_id = message
        .get("modelId")
        .and_then(|v| v.as_str())
        .map(|v| v.to_string())
        .or_else(|| {
            model_info
                .as_ref()
                .and_then(|info| info.get("id"))
                .and_then(|v| v.as_str())
                .map(|v| v.to_string())
        });

    if input_tokens.is_none()
        && output_tokens.is_none()
        && total_cost.is_none()
        && provider_id.is_none()
        && model_id.is_none()
    {
        return None;
    }

    Some(HydratedChatMessageMeta {
        tool_name: None,
        hook_event_name: None,
        message_kind: None,
        display_role: None,
        reason: None,
        input_tokens,
        output_tokens,
        total_cost,
        provider_id,
        model_id,
    })
}

fn extract_message_notice_meta(message: &Value) -> Option<HydratedChatMessageMeta> {
    let metadata = message.get("metadata").and_then(|v| v.as_object())?;
    let message_kind = metadata
        .get("kind")
        .and_then(|v| v.as_str())
        .map(|v| v.to_string());
    let display_role = metadata
        .get("displayRole")
        .and_then(|v| v.as_str())
        .map(|v| v.to_string());
    let reason = metadata
        .get("reason")
        .and_then(|v| v.as_str())
        .map(|v| v.to_string());

    if message_kind.is_none() && display_role.is_none() && reason.is_none() {
        return None;
    }

    Some(HydratedChatMessageMeta {
        tool_name: None,
        hook_event_name: message_kind.as_ref().map(|_| "history_notice".to_string()),
        message_kind,
        display_role,
        reason,
        input_tokens: None,
        output_tokens: None,
        total_cost: None,
        provider_id: None,
        model_id: None,
    })
}

fn resolve_message_display_role(message: &Value, normalized_role: &str) -> String {
    let display_role = message
        .get("metadata")
        .and_then(|value| value.as_object())
        .and_then(|metadata| metadata.get("displayRole"))
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_default();

    match display_role.as_str() {
        "system" | "status" | "error" => display_role,
        _ => normalized_role.to_string(),
    }
}

fn merge_hydrated_message_meta(
    target: &mut Option<HydratedChatMessageMeta>,
    extra: HydratedChatMessageMeta,
) {
    if target.is_none() {
        *target = Some(extra);
        return;
    }
    if let Some(current) = target.as_mut() {
        if current.tool_name.is_none() {
            current.tool_name = extra.tool_name;
        }
        if current.hook_event_name.is_none() {
            current.hook_event_name = extra.hook_event_name;
        }
        if current.message_kind.is_none() {
            current.message_kind = extra.message_kind;
        }
        if current.display_role.is_none() {
            current.display_role = extra.display_role;
        }
        if current.reason.is_none() {
            current.reason = extra.reason;
        }
        if current.input_tokens.is_none() {
            current.input_tokens = extra.input_tokens;
        }
        if current.output_tokens.is_none() {
            current.output_tokens = extra.output_tokens;
        }
        if current.total_cost.is_none() {
            current.total_cost = extra.total_cost;
        }
        if current.provider_id.is_none() {
            current.provider_id = extra.provider_id;
        }
        if current.model_id.is_none() {
            current.model_id = extra.model_id;
        }
    }
}

fn flush_hydrated_text_parts(
    out: &mut Vec<HydratedChatMessage>,
    text_parts: &mut Vec<String>,
    session_id: &str,
    role: &str,
    message_id_base: &str,
    text_segment_index: &mut usize,
    ts: u64,
    text_meta: &mut Option<HydratedChatMessageMeta>,
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
        meta: text_meta.take(),
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

fn shared_session_manifest_path(session_id: &str) -> Option<PathBuf> {
    shared_session_artifact_path(session_id, "json")
}

fn read_session_manifest(session_id: &str) -> Option<(PathBuf, Value)> {
    let path = shared_session_manifest_path(session_id)?;
    let raw = fs::read_to_string(&path).ok()?;
    let parsed = serde_json::from_str::<Value>(&raw).ok()?;
    if !parsed.is_object() {
        return None;
    }
    Some((path, parsed))
}

fn read_session_metadata(session_id: &str) -> Option<Value> {
    let (_, manifest) = read_session_manifest(session_id)?;
    manifest.get("metadata").and_then(|value| {
        if value.is_object() {
            Some(value.clone())
        } else {
            None
        }
    })
}

fn read_session_metadata_title(session_id: &str) -> Option<String> {
    let metadata = read_session_metadata(session_id)?;
    normalize_session_title(metadata.get("title").and_then(|value| value.as_str()))
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
            "app=code",
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
    let output = Command::new("bun")
        .arg("run")
        .arg(cli_entrypoint.to_string_lossy().to_string())
        .arg("list")
        .arg(target)
        .arg("--json")
        .current_dir(workspace_root)
        .output()
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

fn resolve_routine_schedules_script_path(context: &AppContext) -> Option<PathBuf> {
    let candidates = [
        PathBuf::from(&context.workspace_root)
            .join("apps")
            .join("code")
            .join("scripts")
            .join("routine-schedules.ts"),
        PathBuf::from(&context.workspace_root)
            .join("scripts")
            .join("routine-schedules.ts"),
        PathBuf::from(&context.launch_cwd)
            .join("scripts")
            .join("routine-schedules.ts"),
        PathBuf::from(&context.launch_cwd)
            .join("apps")
            .join("code")
            .join("scripts")
            .join("routine-schedules.ts"),
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

fn resolve_desktop_backend_script_path(context: &AppContext) -> Option<PathBuf> {
    let candidates = [
        PathBuf::from(&context.workspace_root)
            .join("apps")
            .join("code")
            .join("host")
            .join("index.ts"),
        PathBuf::from(&context.launch_cwd)
            .join("host")
            .join("index.ts"),
        PathBuf::from(&context.launch_cwd)
            .join("apps")
            .join("code")
            .join("host")
            .join("index.ts"),
    ];
    candidates.into_iter().find(|path| path.exists())
}

fn resolve_desktop_backend_binary_path(context: &AppContext) -> Option<PathBuf> {
    let explicit = std::env::var("CLINE_CODE_HOST_BIN")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    let current_exe = std::env::current_exe().ok();
    let candidates = [
        explicit,
        Some(
            PathBuf::from(&context.workspace_root)
                .join("apps")
                .join("code")
                .join("src-tauri")
                .join("bin")
                .join("code-host"),
        ),
        current_exe
            .as_ref()
            .and_then(|path| path.parent().map(|parent| parent.join("code-host"))),
        current_exe.as_ref().and_then(|path| {
            path.parent()
                .and_then(|parent| parent.parent())
                .map(|parent| parent.join("Resources").join("code-host"))
        }),
    ];
    candidates.into_iter().flatten().find(|path| path.exists())
}

fn ensure_desktop_backend_started(
    state: &Arc<DesktopBackendState>,
    context: &AppContext,
) -> Result<(), String> {
    {
        let mut process_guard = state
            .process
            .lock()
            .map_err(|_| "failed to lock desktop backend process state")?;
        if let Some(existing) = process_guard.as_mut() {
            match existing.try_wait() {
                Ok(None) => {
                    if state
                        .ws_endpoint
                        .lock()
                        .ok()
                        .and_then(|value| value.as_ref().cloned())
                        .map(|value| !value.trim().is_empty())
                        .unwrap_or(false)
                    {
                        return Ok(());
                    }
                }
                Ok(Some(_)) | Err(_) => {
                    *process_guard = None;
                    if let Ok(mut endpoint_guard) = state.ws_endpoint.lock() {
                        *endpoint_guard = None;
                    }
                }
            }
        }
    }

    let mut command = if let Some(binary_path) = resolve_desktop_backend_binary_path(context) {
        let mut command = Command::new(binary_path);
        command.current_dir(&context.workspace_root);
        command
    } else if let Some(script_path) = resolve_desktop_backend_script_path(context) {
        let mut command = Command::new("bun");
        command
            .arg("run")
            .arg(script_path.to_string_lossy().to_string())
            .current_dir(&context.workspace_root);
        command
    } else {
        return Err(format!(
            "desktop backend host not found. checked binary/script under workspace_root={} and launch_cwd={}",
            context.workspace_root, context.launch_cwd
        ));
    };

    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to start desktop backend host: {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to capture desktop backend stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "failed to capture desktop backend stderr".to_string())?;

    let state_for_stdout = state.clone();
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
            if let Ok(parsed) = serde_json::from_str::<DesktopBackendReadyLine>(trimmed) {
                if parsed.line_type == "ready" {
                    if let Some(endpoint) = parsed.ws_endpoint.or(parsed.endpoint) {
                        if let Ok(mut endpoint_guard) = state_for_stdout.ws_endpoint.lock() {
                            *endpoint_guard = Some(endpoint);
                        }
                    }
                    continue;
                }
            }
            eprintln!("[desktop-backend] {trimmed}");
        }
        if let Ok(mut endpoint_guard) = state_for_stdout.ws_endpoint.lock() {
            *endpoint_guard = None;
        }
    });

    thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut buf = String::new();
        let _ = reader.read_to_string(&mut buf);
        let trimmed = buf.trim();
        if !trimmed.is_empty() {
            eprintln!("[desktop-backend] {trimmed}");
        }
    });

    let mut process_guard = state
        .process
        .lock()
        .map_err(|_| "failed to lock desktop backend process state")?;
    *process_guard = Some(child);
    Ok(())
}

fn run_bun_script_json(
    script_path: &Path,
    script_workdir: &Path,
    stdin_body: String,
    command_name: &str,
) -> Result<Value, String> {
    let mut child = Command::new("bun")
        .current_dir(script_workdir)
        .arg("run")
        .arg(script_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
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
    let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
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
        .env("CLINE_RPC_CLIENT_ID", DEFAULT_RPC_CLIENT_ID)
        .env("CLINE_RPC_CLIENT_TYPE", DEFAULT_RPC_CLIENT_TYPE)
        .env("CLINE_RPC_CLIENT_APP", "code")
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
    let stdout_state = state.clone();
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
                "chat_reasoning" => {
                    let Some(session_id) = parsed.session_id.as_deref() else {
                        continue;
                    };
                    let payload = serde_json::json!({
                        "text": parsed.chunk.unwrap_or_default(),
                        "redacted": parsed.redacted.unwrap_or(false),
                    });
                    emit_chunk(&stdout_app, session_id, "chat_reasoning", payload.to_string());
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
                "pending_prompts" => {
                    let Some(session_id) = parsed.session_id.as_deref() else {
                        continue;
                    };
                    let prompts = map_pending_prompts(parsed.prompts.unwrap_or_default());
                    let previous = {
                        let mut sessions = match stdout_state.sessions.lock() {
                            Ok(value) => value,
                            Err(_) => continue,
                        };
                        let Some(session) = sessions.get_mut(session_id) else {
                            continue;
                        };
                        let previous = session.prompts_in_queue.clone();
                        session.prompts_in_queue = prompts.clone();
                        previous
                    };
                    if previous.len() > prompts.len()
                        && !previous.is_empty()
                        && previous[0].id != prompts.first().map(|item| item.id.as_str()).unwrap_or("")
                    {
                        let payload = serde_json::json!({
                            "prompt": previous[0].prompt,
                            "attachmentCount": previous[0].attachment_count.unwrap_or(0),
                        });
                        emit_chunk(
                            &stdout_app,
                            session_id,
                            "chat_queued_prompt_start",
                            payload.to_string(),
                        );
                    }
                    send_prompts_in_queue_snapshot(&stdout_app, &stdout_state, session_id);
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

    match rx.recv_timeout(Duration::from_millis(
        CHAT_RUNTIME_BRIDGE_RESPONSE_TIMEOUT_MS,
    )) {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(error)) => Err(error),
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
            let _ = state.runtime_bridge.lock().ok().and_then(|mut guard| {
                guard.as_mut().and_then(|bridge| {
                    bridge
                        .pending
                        .lock()
                        .ok()
                        .and_then(|mut pending_map| pending_map.remove(&request_id))
                })
            });
            Err(format!(
                "chat runtime bridge request timed out after {}ms",
                CHAT_RUNTIME_BRIDGE_RESPONSE_TIMEOUT_MS
            ))
        }
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
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
) -> Result<ChatSessionCommandResponse, String> {
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
    serde_json::from_value::<ChatSessionCommandResponse>(response)
        .map_err(|e| format!("invalid chat runtime bridge response: {e}"))
}

fn map_pending_prompts(prompts: Vec<PendingPromptSnapshot>) -> Vec<PromptInQueue> {
    prompts
        .into_iter()
        .map(|item| PromptInQueue {
            id: item.id,
            prompt: item.prompt,
            steer: item.delivery == "steer",
            attachment_count: item.attachment_count,
        })
        .collect()
}

fn persist_chat_turn_result(
    state: &Arc<ChatSessionStore>,
    session_id: &str,
    config: &StartSessionRequest,
    result: &ChatTurnResult,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "failed to lock chat session store")?;
    if let Some(session) = sessions.get_mut(session_id) {
        let persisted_messages = persist_usage_in_messages(&result.messages, config, result);
        session.messages = persisted_messages.clone();
        session.status = normalize_chat_finish_status(result.finish_reason.as_deref());
        session.ended_at = Some(now_ms());
        if let Some(path) = shared_session_messages_write_path(session_id) {
            if let Some(parent) = path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let body = serde_json::json!({
                "messages": persisted_messages,
                "ts": now_ms(),
            });
            if let Ok(encoded) = serde_json::to_vec(&body) {
                let _ = fs::write(path, encoded);
            }
        }
    }
    Ok(())
}

fn mark_chat_turn_failed(state: &Arc<ChatSessionStore>, session_id: &str) -> Result<(), String> {
    let persisted_messages = read_persisted_chat_messages(session_id)?;
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "failed to lock chat session store")?;
    if let Some(session) = sessions.get_mut(session_id) {
        session.busy = false;
        session.status = "failed".to_string();
        session.ended_at = Some(now_ms());
        if let Some(messages) = persisted_messages {
            session.messages = messages;
        }
    }
    Ok(())
}

fn send_prompts_in_queue_snapshot(
    app: &AppHandle,
    state: &Arc<ChatSessionStore>,
    session_id: &str,
) {
    let items = state
        .sessions
        .lock()
        .ok()
        .and_then(|sessions| sessions.get(session_id).cloned())
        .map(|session| session.prompts_in_queue)
        .unwrap_or_default();
    let payload = serde_json::json!({ "items": items });
    emit_chunk(
        app,
        session_id,
        "prompts_in_queue_state",
        payload.to_string(),
    );
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
        chunk,
        ts,
    };
    if let Some(ws_bridge) = app.try_state::<Arc<ChatWsBridgeState>>() {
        ws_bridge.broadcast_chunk_event(payload);
    }
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

#[tauri::command]
fn get_desktop_backend_endpoint(
    backend_state: State<'_, Arc<DesktopBackendState>>,
    context: State<'_, AppContext>,
) -> Result<String, String> {
    ensure_desktop_backend_started(backend_state.inner(), context.inner())?;
    for _ in 0..50 {
        if let Some(endpoint) = backend_state
            .ws_endpoint
            .lock()
            .ok()
            .and_then(|value| value.as_ref().cloned())
            .filter(|value| !value.trim().is_empty())
        {
            return Ok(endpoint);
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err("desktop backend endpoint not ready".to_string())
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
    let home = std::env::var("HOME").ok()?;
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

fn discover_cli_sessions(
    context: &AppContext,
    limit: Option<usize>,
) -> Result<Vec<CliDiscoveredSession>, String> {
    let Some(cli_entrypoint) = resolve_cli_entrypoint_path(context) else {
        return Ok(vec![]);
    };
    let cli_workdir = resolve_cli_workdir(&cli_entrypoint, context);

    let limit_value = limit.unwrap_or(300).max(1).to_string();
    let output = Command::new("bun")
        .current_dir(cli_workdir)
        .arg("run")
        .arg(cli_entrypoint)
        .arg("history")
        .arg("--json")
        .arg("--limit")
        .arg(limit_value)
        .output()
        .map_err(|e| format!("failed to list cli sessions: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("failed to list cli sessions: {stderr}"));
    }

    let parsed = serde_json::from_slice::<Value>(&output.stdout)
        .map_err(|e| format!("invalid sessions json: {e}"))?;
    let mut out: Vec<CliDiscoveredSession> = Vec::new();
    let Some(items) = parsed.as_array() else {
        return Ok(out);
    };

    for item in items {
        let session_id = json_string_field(item, &["session_id", "sessionId"]).unwrap_or_default();
        if session_id.is_empty() {
            continue;
        }
        let metadata = json_object_field(item, &["metadata"]).or_else(|| {
            json_string_field(item, &["metadata_json", "metadataJson"])
                .and_then(|raw| parse_json_object_string(raw.trim()))
        });
        let cwd = json_string_field(item, &["cwd"]).unwrap_or_default();
        let workspace_root = json_string_field(item, &["workspace_root", "workspaceRoot"])
            .or_else(|| {
                if cwd.trim().is_empty() {
                    None
                } else {
                    Some(cwd.clone())
                }
            })
            .unwrap_or_default();
        out.push(CliDiscoveredSession {
            session_id,
            status: json_string_field(item, &["status"]).unwrap_or_else(|| "running".to_string()),
            provider: json_string_field(item, &["provider"])
                .unwrap_or_else(|| "anthropic".to_string()),
            model: json_string_field(item, &["model"])
                .unwrap_or_default()
                .to_string(),
            cwd,
            workspace_root,
            team_name: json_string_field(item, &["team_name", "teamName"]),
            parent_session_id: json_string_field(item, &["parent_session_id", "parentSessionId"]),
            parent_agent_id: json_string_field(item, &["parent_agent_id", "parentAgentId"]),
            agent_id: json_string_field(item, &["agent_id", "agentId"]),
            conversation_id: json_string_field(item, &["conversation_id", "conversationId"]),
            is_subagent: json_bool_field(item, &["is_subagent", "isSubagent"]).unwrap_or(false),
            prompt: json_string_field(item, &["prompt"]),
            metadata,
            started_at: json_string_field(item, &["started_at", "startedAt"]).unwrap_or_default(),
            ended_at: json_string_field(item, &["ended_at", "endedAt"]),
            interactive: json_bool_field(item, &["interactive"]).unwrap_or(false),
        });
    }

    Ok(out)
}

#[tauri::command]
fn list_cli_sessions(
    context: State<'_, AppContext>,
    limit: Option<usize>,
) -> Result<Vec<CliDiscoveredSession>, String> {
    discover_cli_sessions(&context, limit)
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
fn add_provider(
    context: State<'_, AppContext>,
    provider_id: String,
    name: String,
    base_url: String,
    api_key: Option<String>,
    headers: Option<Value>,
    timeout_ms: Option<u64>,
    models: Option<Vec<String>>,
    default_model_id: Option<String>,
    models_source_url: Option<String>,
    capabilities: Option<Vec<String>>,
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
            "action": "addProvider",
            "providerId": provider_id,
            "name": name,
            "baseUrl": base_url,
            "apiKey": api_key,
            "headers": headers,
            "timeoutMs": timeout_ms,
            "models": models,
            "defaultModelId": default_model_id,
            "modelsSourceUrl": models_source_url,
            "capabilities": capabilities
        })
        .to_string(),
        "provider settings",
    )
}

#[tauri::command]
fn list_routine_schedules(context: State<'_, AppContext>) -> Result<Value, String> {
    let Some(script_path) = resolve_routine_schedules_script_path(&context) else {
        return Err(format!(
            "routine schedules script not found. checked workspace_root={} and launch_cwd={}",
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
            "action": "listOverview"
        })
        .to_string(),
        "routine schedules",
    )
}

#[tauri::command]
fn create_routine_schedule(
    context: State<'_, AppContext>,
    name: String,
    cron_pattern: String,
    prompt: String,
    provider: String,
    model: String,
    mode: String,
    workspace_root: String,
    cwd: Option<String>,
    system_prompt: Option<String>,
    max_iterations: Option<u64>,
    timeout_seconds: Option<u64>,
    max_parallel: Option<u64>,
    enabled: Option<bool>,
    tags: Option<Vec<String>>,
) -> Result<Value, String> {
    let Some(script_path) = resolve_routine_schedules_script_path(&context) else {
        return Err(format!(
            "routine schedules script not found. checked workspace_root={} and launch_cwd={}",
            context.workspace_root, context.launch_cwd
        ));
    };
    let script_workdir = script_path
        .parent()
        .and_then(|parent| parent.parent())
        .map(|value| value.to_path_buf())
        .unwrap_or_else(|| PathBuf::from(&context.launch_cwd));
    let schedule_mode = if mode.trim().eq_ignore_ascii_case("plan") {
        "plan"
    } else {
        "act"
    };

    run_bun_script_json(
        &script_path,
        &script_workdir,
        serde_json::json!({
            "action": "createSchedule",
            "name": name,
            "cronPattern": cron_pattern,
            "prompt": prompt,
            "provider": provider,
            "model": model,
            "mode": schedule_mode,
            "workspaceRoot": workspace_root,
            "cwd": cwd,
            "systemPrompt": system_prompt,
            "maxIterations": max_iterations,
            "timeoutSeconds": timeout_seconds,
            "maxParallel": max_parallel,
            "enabled": enabled,
            "tags": tags
        })
        .to_string(),
        "routine schedules",
    )
}

#[tauri::command]
fn pause_routine_schedule(
    context: State<'_, AppContext>,
    schedule_id: String,
) -> Result<Value, String> {
    let Some(script_path) = resolve_routine_schedules_script_path(&context) else {
        return Err(format!(
            "routine schedules script not found. checked workspace_root={} and launch_cwd={}",
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
            "action": "pauseSchedule",
            "scheduleId": schedule_id
        })
        .to_string(),
        "routine schedules",
    )
}

#[tauri::command]
fn resume_routine_schedule(
    context: State<'_, AppContext>,
    schedule_id: String,
) -> Result<Value, String> {
    let Some(script_path) = resolve_routine_schedules_script_path(&context) else {
        return Err(format!(
            "routine schedules script not found. checked workspace_root={} and launch_cwd={}",
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
            "action": "resumeSchedule",
            "scheduleId": schedule_id
        })
        .to_string(),
        "routine schedules",
    )
}

#[tauri::command]
fn trigger_routine_schedule(
    context: State<'_, AppContext>,
    schedule_id: String,
) -> Result<Value, String> {
    let Some(script_path) = resolve_routine_schedules_script_path(&context) else {
        return Err(format!(
            "routine schedules script not found. checked workspace_root={} and launch_cwd={}",
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
            "action": "triggerScheduleNow",
            "scheduleId": schedule_id
        })
        .to_string(),
        "routine schedules",
    )
}

#[tauri::command]
fn delete_routine_schedule(
    context: State<'_, AppContext>,
    schedule_id: String,
) -> Result<Value, String> {
    let Some(script_path) = resolve_routine_schedules_script_path(&context) else {
        return Err(format!(
            "routine schedules script not found. checked workspace_root={} and launch_cwd={}",
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
            "action": "deleteSchedule",
            "scheduleId": schedule_id
        })
        .to_string(),
        "routine schedules",
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
fn delete_cli_session(context: State<'_, AppContext>, session_id: String) -> Result<(), String> {
    let Some(cli_entrypoint) = resolve_cli_entrypoint_path(&context) else {
        return Err("CLI entrypoint not found".to_string());
    };
    let cli_workdir = resolve_cli_workdir(&cli_entrypoint, &context);

    let output = Command::new("bun")
        .current_dir(cli_workdir)
        .arg("run")
        .arg(cli_entrypoint)
        .arg("history")
        .arg("delete")
        .arg("--json")
        .arg("--session-id")
        .arg(&session_id)
        .output()
        .map_err(|e| format!("failed to delete cli session: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("failed to delete cli session: {stderr}"));
    }

    if let Some(path) = session_log_path(&session_id) {
        let _ = fs::remove_file(path);
    }
    if let Some(path) = session_hook_log_path(&session_id) {
        let _ = fs::remove_file(path);
    }

    Ok(())
}

#[tauri::command]
fn read_session_hooks(
    session_id: String,
    limit: Option<usize>,
) -> Result<Vec<SessionHookEvent>, String> {
    let path = match session_hook_log_path(&session_id) {
        Some(path) if path.exists() => path,
        _ => match shared_session_hook_path(&session_id) {
            Some(path) if path.exists() => path,
            _ => return Ok(vec![]),
        },
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
        cwd: context.workspace_root.clone(),
    }
}

#[tauri::command]
fn pick_workspace_directory(initial_path: Option<String>) -> Option<String> {
    let mut dialog = rfd::FileDialog::new();
    if let Some(path) = initial_path
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        dialog = dialog.set_directory(path);
    }
    dialog
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn get_git_branch(context: State<'_, AppContext>, cwd: Option<String>) -> GitBranchContext {
    let target_cwd = cwd
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| context.workspace_root.clone());

    GitBranchContext {
        branch: resolve_git_branch(&target_cwd),
    }
}

#[tauri::command]
fn list_git_branches(context: State<'_, AppContext>, cwd: Option<String>) -> GitBranchesContext {
    let target_cwd = cwd
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| context.workspace_root.clone());

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
        .unwrap_or_else(|| context.workspace_root.clone());

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
                    prompts_in_queue: Vec::new(),
                    busy: false,
                    started_at: now_ms(),
                    ended_at: None,
                    status: "idle".to_string(),
                    prompt: None,
                    title: None,
                },
            );
            Ok(ChatSessionCommandResponse {
                session_id: Some(session_id),
                result: None,
                ok: None,
                queued: None,
                prompts_in_queue: Vec::new(),
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
                        title: read_session_metadata_title(&session_id),
                        messages,
                        prompts_in_queue: Vec::new(),
                        busy: false,
                        started_at: now_ms(),
                        ended_at: None,
                        status: "idle".to_string(),
                    });
            }

            let (config, messages, delivery) = {
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
                let delivery = match request.delivery.as_deref() {
                    Some("queue") => Some("queue".to_string()),
                    Some("steer") => Some("steer".to_string()),
                    _ if session.busy => Some("queue".to_string()),
                    _ => None,
                };
                session.busy = true;
                session.status = "running".to_string();
                session.ended_at = None;
                if !prompt.is_empty() {
                    session.prompt = Some(prompt.clone());
                }
                (
                    session.config.clone(),
                    session.messages.clone(),
                    delivery,
                )
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
                delivery,
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

            if let Ok(Ok(response)) = &turn_result {
                if response.queued == Some(true) {
                    let prompts_in_queue = {
                        let sessions = state
                            .sessions
                            .lock()
                            .map_err(|_| "failed to lock chat session store")?;
                        sessions
                            .get(&session_id)
                            .cloned()
                            .map(|session| session.prompts_in_queue)
                            .unwrap_or_default()
                    };
                    return Ok(ChatSessionCommandResponse {
                        session_id: Some(session_id),
                        result: None,
                        ok: Some(true),
                        queued: Some(true),
                        prompts_in_queue,
                    });
                }
                let result = response
                    .result
                    .as_ref()
                    .ok_or_else(|| "chat runtime bridge send response missing result".to_string())?;
                persist_chat_turn_result(state, &session_id, &config, result)?;
                let prompts_in_queue = {
                    let mut sessions = state
                        .sessions
                        .lock()
                        .map_err(|_| "failed to lock chat session store")?;
                    let session = sessions
                        .get_mut(&session_id)
                        .ok_or_else(|| "session not found. start a new session.".to_string())?;
                    session.busy = !session.prompts_in_queue.is_empty();
                    session.prompts_in_queue.clone()
                };
                return Ok(ChatSessionCommandResponse {
                    session_id: Some(session_id),
                    result: Some(result.clone()),
                    ok: None,
                    queued: Some(false),
                    prompts_in_queue,
                });
            } else {
                mark_chat_turn_failed(state, &session_id)?;
            }

            let turn_result = turn_result?;
            let response = turn_result?;
            Ok(ChatSessionCommandResponse {
                session_id: Some(session_id),
                result: response.result,
                ok: response.ok,
                queued: response.queued,
                prompts_in_queue: Vec::new(),
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
                        session.prompts_in_queue.clear();
                        session.status = "cancelled".to_string();
                        session.ended_at = Some(now_ms());
                    }
                    drop(sessions);
                    send_prompts_in_queue_snapshot(app, state, &session_id);
                }
                request.session_id
            },
            result: None,
            ok: Some(true),
            queued: None,
            prompts_in_queue: Vec::new(),
        }),
        "reset" => {
            if let Some(session_id) = request.session_id.clone() {
                let mut sessions = state
                    .sessions
                    .lock()
                    .map_err(|_| "failed to lock chat session store")?;
                sessions.remove(&session_id);
                let _ = reset_chat_session_via_rpc_runtime(
                    app,
                    state,
                    context,
                    Some(session_id.as_str()),
                );
                let _ = remove_chat_stream_subscription(app, state, context, &session_id);
                send_prompts_in_queue_snapshot(app, state, &session_id);
            }
            Ok(ChatSessionCommandResponse {
                session_id: request.session_id,
                result: None,
                ok: Some(true),
                queued: None,
                prompts_in_queue: Vec::new(),
            })
        }
        "pending_prompts" => {
            let Some(session_id) = request.session_id else {
                return Err("sessionId is required for pending_prompts action".to_string());
            };
            let prompts_in_queue = state
                .sessions
                .lock()
                .ok()
                .and_then(|sessions| sessions.get(&session_id).cloned())
                .map(|session| session.prompts_in_queue)
                .unwrap_or_default();
            Ok(ChatSessionCommandResponse {
                session_id: Some(session_id),
                result: None,
                ok: Some(true),
                queued: None,
                prompts_in_queue,
            })
        }
        "steer_prompt" => {
            let Some(session_id) = request.session_id.clone() else {
                return Err("sessionId is required for steer_prompt action".to_string());
            };
            let Some(prompt_id) = request.prompt_id.clone() else {
                return Err("promptId is required for steer_prompt action".to_string());
            };
            let session = state
                .sessions
                .lock()
                .ok()
                .and_then(|sessions| sessions.get(&session_id).cloned());
            if let Some(session) = session {
                let prompt = session
                    .prompts_in_queue
                    .iter()
                    .find(|item| item.id == prompt_id)
                    .map(|item| item.prompt.clone());
                if let Some(prompt) = prompt {
                    ensure_chat_stream_subscription(app, state, context, &session_id)?;
                    let _ = tauri::async_runtime::spawn_blocking({
                        let app_for_turn = app.clone();
                        let state_for_turn = state.clone();
                        let context_for_turn = context.clone();
                        let session_id_for_turn = session_id.clone();
                        let turn_request = ChatRunTurnRequest {
                            config: session.config.clone(),
                            messages: session.messages.clone(),
                            prompt,
                            attachments: None,
                            delivery: Some("steer".to_string()),
                        };
                        move || {
                            run_chat_turn_via_rpc_runtime(
                                &app_for_turn,
                                &state_for_turn,
                                &context_for_turn,
                                &session_id_for_turn,
                                &turn_request,
                            )
                        }
                    })
                    .await
                    .map_err(|e| format!("chat turn task failed: {e}"))??;
                }
            }
            let prompts_in_queue = state
                .sessions
                .lock()
                .ok()
                .and_then(|sessions| sessions.get(&session_id).cloned())
                .map(|session| session.prompts_in_queue)
                .unwrap_or_default();
            Ok(ChatSessionCommandResponse {
                session_id: Some(session_id),
                result: None,
                ok: Some(true),
                queued: Some(true),
                prompts_in_queue,
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
    let (path, is_jsonl) = match session_log_path(&session_id) {
        Some(path) if path.exists() => (path, true),
        _ => match shared_session_log_path(&session_id) {
            Some(path) if path.exists() => (path, false),
            _ => return Ok(String::new()),
        },
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
        let mut text_meta = extract_message_usage_meta(message);
        if let Some(notice_meta) = extract_message_notice_meta(message) {
            merge_hydrated_message_meta(&mut text_meta, notice_meta);
        }
        let role_raw = message
            .get("role")
            .and_then(|v| v.as_str())
            .unwrap_or("assistant");
        let normalized_role = match role_raw {
            "user" | "assistant" | "tool" | "system" | "status" | "error" => role_raw,
            _ => "assistant",
        };
        let role = resolve_message_display_role(message, normalized_role);
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
                role: role.clone(),
                content,
                created_at: created_at_base,
                meta: text_meta.take(),
            });
            continue;
        };

        let mut text_parts: Vec<String> = Vec::new();
        let mut text_segment_index: usize = 0;
        let out_start_index = out.len();

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
                        &role,
                        &message_id_base,
                        &mut text_segment_index,
                        block_ts,
                        &mut text_meta,
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
                            message_kind: None,
                            display_role: None,
                            reason: None,
                            input_tokens: None,
                            output_tokens: None,
                            total_cost: None,
                            provider_id: None,
                            model_id: None,
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
                        &role,
                        &message_id_base,
                        &mut text_segment_index,
                        block_ts,
                        &mut text_meta,
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
                                message_kind: None,
                                display_role: None,
                                reason: None,
                                input_tokens: None,
                                output_tokens: None,
                                total_cost: None,
                                provider_id: None,
                                model_id: None,
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
                                message_kind: None,
                                display_role: None,
                                reason: None,
                                input_tokens: None,
                                output_tokens: None,
                                total_cost: None,
                                provider_id: None,
                                model_id: None,
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
            &role,
            &message_id_base,
            &mut text_segment_index,
            created_at_base.saturating_add(content_blocks.len() as u64),
            &mut text_meta,
        );

        if let Some(extra_meta) = text_meta.take() {
            if let Some(first_block_message) = out.get_mut(out_start_index) {
                merge_hydrated_message_meta(&mut first_block_message.meta, extra_meta);
            }
        }
    }

    Ok(out)
}

fn discover_chat_sessions(
    state: &Arc<ChatSessionStore>,
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
            .map(|(session_id, session)| CliDiscoveredSession {
                metadata: {
                    let mut metadata = serde_json::Map::new();
                    if let Some(title) = normalize_session_title(session.title.as_deref()) {
                        metadata.insert("title".to_string(), Value::String(title));
                    }
                    if metadata.is_empty() {
                        None
                    } else {
                        Some(Value::Object(metadata))
                    }
                },
                session_id: session_id.clone(),
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
                prompt: session
                    .prompt
                    .clone()
                    .or_else(|| derive_prompt_from_messages(&session.messages)),
                started_at: session.started_at.to_string(),
                ended_at: session.ended_at.map(|value| value.to_string()),
                interactive: false,
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
                let metadata = manifest.get("metadata").cloned().and_then(|value| {
                    if value.is_object() {
                        Some(value)
                    } else {
                        None
                    }
                });
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
                    metadata,
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
fn list_chat_sessions(
    state: State<'_, Arc<ChatSessionStore>>,
    limit: Option<usize>,
) -> Result<Vec<CliDiscoveredSession>, String> {
    discover_chat_sessions(&state, limit)
}

#[tauri::command]
fn list_discovered_sessions(
    context: State<'_, AppContext>,
    state: State<'_, Arc<ChatSessionStore>>,
    limit: Option<usize>,
) -> Result<Vec<CliDiscoveredSession>, String> {
    let max = limit.unwrap_or(300).max(1);
    let chat = discover_chat_sessions(&state, Some(max))?;
    let cli = discover_cli_sessions(&context, Some(max)).unwrap_or_else(|_| Vec::new());
    Ok(merge_discovered_session_lists(chat, cli, max))
}

#[tauri::command]
fn update_chat_session_title(
    context: State<'_, AppContext>,
    state: State<'_, Arc<ChatSessionStore>>,
    session_id: String,
    title: String,
) -> Result<(), String> {
    let trimmed_session_id = session_id.trim();
    if trimmed_session_id.is_empty() {
        return Err("session id is required".to_string());
    }

    let normalized_title = normalize_session_title(Some(title.as_str()));
    let Some(cli_entrypoint) = resolve_cli_entrypoint_path(&context) else {
        return Err("CLI entrypoint not found".to_string());
    };
    let cli_workdir = resolve_cli_workdir(&cli_entrypoint, &context);
    let mut command = Command::new("bun");
    command
        .current_dir(cli_workdir)
        .arg("run")
        .arg(cli_entrypoint)
        .arg("history")
        .arg("update")
        .arg("--json")
        .arg("--session-id")
        .arg(trimmed_session_id)
        .arg("--title")
        .arg(normalized_title.clone().unwrap_or_default());

    let output = command
        .output()
        .map_err(|e| format!("failed to update session title: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            return Err("failed to update session title".to_string());
        }
        return Err(stderr);
    }

    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "failed to lock chat session store")?;
    if let Some(session) = sessions.get_mut(trimmed_session_id) {
        session.title = normalized_title;
    }

    Ok(())
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

    if let Some(path) = session_log_path(trimmed_session_id) {
        let _ = fs::remove_file(path);
    }
    if let Some(path) = session_hook_log_path(trimmed_session_id) {
        let _ = fs::remove_file(path);
    }

    if let Some(base) = shared_session_data_dir() {
        let session_dir = base.join(trimmed_session_id);
        if session_dir.exists() {
            let _ = fs::remove_dir_all(&session_dir);
        }

        let file_suffixes = ["messages.json", "log", "hooks.jsonl"];
        for suffix in file_suffixes {
            let file_name = format!("{trimmed_session_id}.{suffix}");
            if let Some(found) = find_artifact_under_dir(
                &base.join(root_session_id_from(trimmed_session_id)),
                &file_name,
                4,
            ) {
                let _ = fs::remove_file(found);
            }
        }
    }

    if let Some(dir) = tool_approval_dir() {
        if dir.exists() {
            if let Ok(entries) = fs::read_dir(dir) {
                let prefix = format!("{trimmed_session_id}.");
                for entry in entries.flatten() {
                    let path = entry.path();
                    if !path.is_file() {
                        continue;
                    }
                    let Some(name) = path.file_name().and_then(|v| v.to_str()) else {
                        continue;
                    };
                    if name.starts_with(&prefix) {
                        let _ = fs::remove_file(path);
                    }
                }
            }
        }
    }

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
    let desktop_backend = Arc::new(DesktopBackendState::default());
    let launch_cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string());
    let workspace_root = resolve_workspace_root(&launch_cwd);
    let app_context = AppContext {
        launch_cwd,
        workspace_root,
    };

    tauri::Builder::default()
        .manage(desktop_backend)
        .manage(app_context)
        .setup(|app| {
            let app_context = app.state::<AppContext>().inner().clone();
            let backend_state = app.state::<Arc<DesktopBackendState>>().inner().clone();
            if let Err(error) = ensure_desktop_backend_started(&backend_state, &app_context) {
                eprintln!("[desktop-backend] startup failed: {error}");
            }
            thread::spawn(move || loop {
                thread::sleep(Duration::from_secs(5));
                if let Err(error) = ensure_desktop_backend_started(&backend_state, &app_context) {
                    eprintln!("[desktop-backend] health check failed: {error}");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_desktop_backend_endpoint,
            pick_workspace_directory,
            open_mcp_settings_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri app");
}
