/**
 * Custom types and extensions for ACP integration with Cline CLI.
 *
 * This file extends the base ACP types with Cline-specific functionality.
 */

import type * as acp from "@agentclientprotocol/sdk"
import type { Controller } from "@/core/controller"

// ============================================================
// Permission Handler Callback Types
// ============================================================

/**
 * Callback to resolve a permission request with the user's response.
 */
export type PermissionResolver = (response: acp.RequestPermissionResponse) => void

/**
 * Handler function for permission requests.
 * Called when the agent needs permission for a tool call.
 * The handler should present the request to the user and call resolve() with their response.
 */
export type PermissionHandler = (request: Omit<acp.RequestPermissionRequest, "sessionId">, resolve: PermissionResolver) => void

// ============================================================
// Session Event Emitter Types
// ============================================================

/**
 * Event types emitted by ClineSessionEmitter for per-session ACP events.
 */
export interface ClineSessionEvents {
	available_commands_update: (commands: acp.AvailableCommand[]) => void
	agent_message_chunk: (content: acp.TextContent) => void
	agent_thought_chunk: (content: acp.TextContent) => void
	tool_call: (toolCall: acp.ToolCallUpdate) => void
	tool_call_update: (update: acp.ToolCallUpdate) => void
	plan: (entries: acp.PlanEntry[]) => void
	current_mode_update: (modeId: string) => void
	error: (error: Error) => void
}

// ============================================================
// ClineAgent Options (decoupled from connection)
// ============================================================

/**
 * Options for creating a ClineAgent instance (decoupled from connection).
 */
export interface ClineAgentOptions {
	/** CLI version string */
	version: string
	/** Whether debug logging is enabled */
	debug?: boolean
}

// Re-export common ACP types for convenience
export type {
	Agent,
	AgentSideConnection,
	AudioContent,
	CancelNotification,
	ContentBlock,
	ImageContent,
	InitializeRequest,
	InitializeResponse,
	LoadSessionRequest,
	LoadSessionResponse,
	McpServer,
	ModelInfo,
	NewSessionRequest,
	NewSessionResponse,
	PermissionOption,
	PermissionOptionKind,
	PromptRequest,
	PromptResponse,
	ReadTextFileRequest,
	ReadTextFileResponse,
	RequestPermissionRequest,
	RequestPermissionResponse,
	SessionConfigOption,
	SessionModelState,
	SessionNotification,
	SessionUpdate,
	SetSessionConfigOptionRequest,
	SetSessionConfigOptionResponse,
	SetSessionModelRequest,
	SetSessionModelResponse,
	SetSessionModeRequest,
	SetSessionModeResponse,
	StopReason,
	TextContent,
	ToolCall,
	ToolCallStatus,
	ToolCallUpdate,
	ToolKind,
	WriteTextFileRequest,
	WriteTextFileResponse,
} from "@agentclientprotocol/sdk"

/**
 * Cline-specific agent capabilities extending the ACP base capabilities.
 */
export interface ClineAgentCapabilities {
	/** Support for loading sessions from disk */
	loadSession: boolean
	/** Prompt capabilities for the agent */
	promptCapabilities: {
		/** Support for image inputs */
		image: boolean
		/** Support for audio inputs */
		audio: boolean
		/** Support for embedded context (file resources) */
		embeddedContext: boolean
	}
	/** MCP server passthrough capabilities */
	mcpCapabilities: {
		/** Support for HTTP MCP servers */
		http: boolean
		/** Support for SSE MCP servers */
		sse: boolean
	}
}

/**
 * Cline agent info for ACP initialization response.
 */
export interface ClineAgentInfo {
	name: "cline"
	title: "Cline"
	version: string
}

/**
 * Extended session data stored by Cline for ACP sessions.
 * Maps to Cline's task history structure.
 */
export interface ClineAcpSession {
	/** Unique session/task ID */
	sessionId: string
	/** Working directory for the session */
	cwd: string
	/** Current mode (plan/act) */
	mode: "plan" | "act"
	/** MCP servers passed from the client */
	mcpServers: acp.McpServer[]
	/** Timestamp when session was created */
	createdAt: number
	/** Timestamp of last activity */
	lastActivityAt: number
	/** Whether this session was loaded from history (needs resume on first prompt) */
	isLoadedFromHistory?: boolean
	/** Controller instance for this session (manages task execution) */
	controller?: Controller
	/** Model ID override for plan mode (format: "provider/modelId") */
	planModeModelId?: string
	/** Model ID override for act mode (format: "provider/modelId") */
	actModeModelId?: string
}

/**
 * Permission option as presented to the ACP client.
 */
export interface ClinePermissionOption {
	kind: acp.PermissionOptionKind
	name: string
	optionId: string
}

/**
 * Mapping of Cline message types to their ACP session update equivalents.
 */
export type ClineToAcpUpdateMapping = {
	/** Text messages from the agent */
	text: "agent_message_chunk"
	/** Reasoning/thinking from the agent */
	reasoning: "agent_thought_chunk"
	/** Markdown content from the agent */
	markdown: "agent_message_chunk"
	/** Tool execution */
	tool: "tool_call"
	/** Command execution */
	command: "tool_call"
	/** Command output */
	command_output: "tool_call_update"
	/** Task completion */
	completion_result: "end_turn"
	/** Error messages */
	error: "tool_call_update" | "error"
}

/**
 * Options for creating an ACP agent instance.
 */
export interface AcpAgentOptions {
	/** CLI version string */
	version: string
	/** Whether debug logging is enabled */
	debug?: boolean
}

/**
 * Result of translating a Cline message to ACP session update(s).
 * A single Cline message may produce multiple ACP updates.
 */
export interface TranslatedMessage {
	/** The session updates to send */
	updates: acp.SessionUpdate[]
	/** Whether this message requires a permission request */
	requiresPermission?: boolean
	/** Permission request details if required */
	permissionRequest?: Omit<acp.RequestPermissionRequest, "sessionId">
	/** The toolCallId that was created/used (for tracking across streaming updates) */
	toolCallId?: string
}

/**
 * State tracking for an active ACP session within Cline.
 */
export interface AcpSessionState {
	/** Session ID */
	sessionId: string
	/** Whether the session is currently processing a prompt */
	isProcessing: boolean
	/** Current tool call ID being executed (if any) */
	currentToolCallId?: string
	/** Whether the session has been cancelled */
	cancelled: boolean
	/** Accumulated tool calls for permission batching */
	pendingToolCalls: Map<string, acp.ToolCall>
}
