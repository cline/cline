import type { GeneratedMedia } from "@cline/shared/browser";
import type { ComponentType } from "react";

/**
 * Structural view model for a chat transcript row. Hosts keep their own
 * transport schemas (e.g. zod-validated sidecar payloads) and pass messages
 * here by structural compatibility — every field the presentation layer
 * reads is declared on this type, nothing more.
 */
export type ChatMessageRole =
	| "user"
	| "assistant"
	| "tool"
	| "system"
	| "status"
	| "error";

export type ChatMessageImageMediaType =
	| "image/png"
	| "image/jpeg"
	| "image/gif"
	| "image/webp";

export interface ChatMessageImage {
	id: string;
	mediaType: ChatMessageImageMediaType;
	data: string;
}

export type ChatMessageMedia = GeneratedMedia;

export interface ChatMessageCheckpoint {
	ref: string;
	createdAt: number;
	runCount: number;
	kind?: "stash" | "commit";
}

export interface ChatMessageMeta {
	stream?: "stdout" | "stderr";
	toolName?: string;
	toolCallId?: string;
	toolOutput?: string;
	toolOutputTruncated?: boolean;
	toolDetachable?: boolean;
	iteration?: number;
	agentId?: string;
	conversationId?: string;
	hookEventName?: string;
	messageKind?: string;
	displayRole?: string;
	reason?: string;
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	totalCost?: number;
	providerId?: string;
	modelId?: string;
	userRunSpan?: number;
	runCount?: number;
	checkpoint?: ChatMessageCheckpoint;
}

export interface ChatMessage {
	id: string;
	sessionId: string | null;
	role: ChatMessageRole;
	content: string;
	images?: ChatMessageImage[];
	media?: ChatMessageMedia[];
	reasoning?: string;
	reasoningRedacted?: boolean;
	createdAt: number;
	meta?: ChatMessageMeta;
}

/**
 * Markdown rendering stays with the host: it owns the renderer, link/image
 * safety policy, and external-URL handling. Components that display prose
 * take the host's renderer through this prop type.
 */
export interface ChatMarkdownProps {
	content: string;
	streaming?: boolean;
	classNames?: string;
}

export type ChatMarkdownComponent = ComponentType<ChatMarkdownProps>;

/** Class applied by agent-chat.css to animate an in-progress row title. */
export const STREAMING_TITLE_CLASS = "cline-chat-streaming-title";
