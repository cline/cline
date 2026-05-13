/**
 * Message Types
 *
 * Standardized message format for input to providers.
 * This is a simplified, provider-agnostic format that can be
 * converted to any provider's native format.
 */

/**
 * Message roles
 */
export type MessageRole = "user" | "assistant";

/**
 * Text content block
 */
export interface TextContent {
	type: "text";
	text: string;
	/** Thought signature for this text part (Gemini) */
	signature?: string;
}

/**
 * File content block for Cline
 */
export interface FileContent {
	type: "file";
	content: string;
	/** Absolute Path */
	path: string;
	source?: string;
}

/**
 * Image content block
 */
export interface ImageContent {
	type: "image";
	/** Base64 encoded image data */
	data: string;
	/** MIME type (e.g., "image/png", "image/jpeg") */
	mediaType: string;
}

/**
 * Tool use content block (assistant's tool call)
 */
export interface ToolUseContent {
	type: "tool_use";
	/** Unique ID for this tool call */
	id: string;
	/** Provider-native call ID for this tool call (if available) */
	call_id?: string;
	/** Name of the tool being called */
	name: string;
	/** Arguments for the tool call */
	input: Record<string, unknown>;
	/** Thought signature for this function call part (Gemini) */
	signature?: string;
}

/**
 * Tool result content block (user's response to tool call)
 */
export interface ToolResultContent {
	type: "tool_result";
	/** ID of the tool call this is responding to */
	tool_use_id: string;
	/** Result content (can be text or error) */
	content: string | Array<TextContent | ImageContent | FileContent>;
	/** Whether this result represents an error */
	is_error?: boolean;
}

/**
 * Thinking/reasoning content block
 */
export interface ThinkingContent {
	type: "thinking";
	/** The thinking/reasoning text */
	thinking: string;
	/** Signature for the thinking block (provider-specific) */
	signature?: string;
	/** Provider-native call ID for this reasoning block (if available) */
	call_id?: string;
	/** Structured reasoning details that can be replayed for tool-call continuation */
	details?: unknown[];
	/** Backward-compatible alias used by some internal processors */
	summary?: unknown[];
}

/**
 * Redacted thinking content block
 */
export interface RedactedThinkingContent {
	type: "redacted_thinking";
	/** Encrypted/redacted data */
	data: string;
	/** Provider-native call ID for this reasoning block (if available) */
	call_id?: string;
}

/**
 * Union of all content block types
 */
export type ContentBlock =
	| TextContent
	| ImageContent
	| ToolUseContent
	| ToolResultContent
	| ThinkingContent
	| FileContent
	| RedactedThinkingContent;

/**
 * A single message in the conversation
 */
export interface Message {
	/** Message role */
	role: MessageRole;
	/** Message content - can be a simple string or array of content blocks */
	content: string | ContentBlock[];
}

/**
 * Extended message with metadata (used for storage/history)
 */
export interface MessageWithMetadata extends Message {
	/** Unique message ID */
	id?: string;
	/** Logical agent kind for persisted session/history consumers */
	agent?: string;
	/** Concrete session id that owns this persisted message */
	sessionId?: string;
	/** Additional message metadata for storage/history consumers */
	metadata?: Record<string, unknown>;
	/** Model info at the time of generation */
	modelInfo?: {
		id: string;
		provider: string;
		family?: string;
	};
	/** Token usage metrics */
	metrics?: {
		inputTokens?: number;
		outputTokens?: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
		cost?: number;
	};
	/** Timestamp of when the message was created */
	ts?: number;
}

/**
 * Tool definition for native tool calling
 */
export interface ToolDefinition {
	/** Tool name */
	name: string;
	/** Tool description */
	description: string;
	/** JSON Schema for the tool's input parameters */
	inputSchema: Record<string, unknown>;
}
