/**
 * Internal types for ACP integration with Cline CLI.
 *
 * This file re-exports all public types from ./public-types.ts and adds
 * internal-only extensions that reference core modules (Controller, etc.).
 *
 * Library consumers should never import from this file directly — they
 * get the public types via the library entrypoint (exports.ts).
 */

import type { ClineAcpSession as PublicClineAcpSession } from "./public-types.js"

// Re-export ACP SDK types that were previously re-exported from here
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
// Re-export everything from public-types so existing internal imports
// (e.g. `import { ClineAgentOptions } from "./types.js"`) keep working.
export type {
	AcpAgentOptions,
	AcpSessionState,
	ClineAgentCapabilities,
	ClineAgentInfo,
	ClineAgentOptions,
	ClinePermissionOption,
	ClineSessionEvents,
	ClineToAcpUpdateMapping,
	PermissionHandler,
	PermissionResolver,
	SessionUpdatePayload,
	SessionUpdateType,
	TranslatedMessage,
} from "./public-types.js"

// ============================================================
// Internal Session Type (extends public ClineAcpSession)
// ============================================================

/**
 * Internal session type that adds the Controller reference.
 *
 * This extends the public {@link PublicClineAcpSession} with fields that
 * should not be exposed to library consumers.
 */
export interface ClineAcpSession extends PublicClineAcpSession {
	/**
	 * Internal controller reference for active sessions.
	 *
	 * Intentionally kept as unknown here so this internal type module does not
	 * pull in the full Controller dependency graph when generating library d.ts.
	 * ClineAgent maintains the strongly typed controller locally.
	 */
	controller?: unknown
}
