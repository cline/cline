/**
 * Cline Library Exports
 *
 * This file exports the public API for programmatic use of Cline.
 * Consumers can import these classes and types to embed Cline in their applications.
 *
 * @example
 * ```typescript
 * import { ClineAgent } from "cline"
 *
 * const agent = new ClineAgent({ version: "1.0.0" })
 * await agent.initialize({ clientCapabilities: {} })
 * const session = await agent.newSession({ cwd: process.cwd() })
 * ```
 *
 * @module cline
 */

// Core Agent
export { ClineAgent } from "./agent/ClineAgent.js"
export { ClineSessionEmitter } from "./agent/ClineSessionEmitter.js"

// All public types (including re-exported ACP SDK types) come from public-types.ts
// which is free of internal dependencies (Controller, StateManager, etc.)
export type {
	// Cline-specific types
	AcpAgentOptions,
	AcpSessionState,
	// ACP SDK re-exports
	Agent,
	AgentSideConnection,
	AudioContent,
	CancelNotification,
	ClientCapabilities,
	ClineAcpSession,
	ClineAgentCapabilities,
	ClineAgentInfo,
	ClineAgentOptions,
	ClinePermissionOption,
	ClineSessionEvents,
	ClineToAcpUpdateMapping,
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
	PermissionHandler,
	PermissionOption,
	PermissionOptionKind,
	PermissionResolver,
	PromptRequest,
	PromptResponse,
	RequestPermissionRequest,
	RequestPermissionResponse,
	SessionConfigOption,
	SessionModelState,
	SessionNotification,
	SessionUpdate,
	SessionUpdatePayload,
	SessionUpdateType,
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
	TranslatedMessage,
} from "./agent/public-types.js"
