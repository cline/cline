/**
 * Message Types
 *
 * Standardized message format for input to providers.
 * This is a simplified, provider-agnostic format that can be
 * converted to any provider's native format.
 */

import type { GeneratedMedia } from "./media";

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

/** Model-generated binary media preserved independently of textual files. */
export interface MediaContent {
	type: "media";
	media: GeneratedMedia;
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
	/** Name of the tool that generated this result */
	name: string;
	/** Result content (can be text or error) */
	content:
		| string
		| Array<TextContent | ImageContent | ImageRefContent | FileContent>;
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
 * Reference to an image stored on disk beside the session data.
 *
 * Conversation history keeps blobs out of the transport: tool results carrying
 * binary data are persisted as `image_ref` blocks pointing at content-addressed
 * files under `<session-data>/<sessionId>/blobs/`. The model sees the raw image
 * bytes on the turn the tool produced them; every later projection renders a
 * short placeholder, and UI clients render the blob by fetching it on demand.
 */
export interface ImageRefContent {
	type: "image_ref";
	/** SHA-256 of the decoded image bytes; also the blob file stem. */
	blobId: string;
	/** MIME type (e.g., "image/png", "image/jpeg"). */
	mediaType: string;
	/** Decoded size in bytes, for display without touching the file. */
	bytes: number;
	/** Source path/URI the image was read from, when known. */
	source?: string;
}

/**
 * Union of all content block types
 */
export type ContentBlock =
	| TextContent
	| ImageContent
	| ImageRefContent
	| MediaContent
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
