/**
 * Handler Interface Types
 *
 * Core interfaces that all provider handlers must implement.
 */

import type { Message, ModelInfo, ToolDefinition } from "@cline/shared";
import type { ApiStream, ApiStreamUsageChunk } from "./stream";

/**
 * Model information returned by handlers
 */
export interface HandlerModelInfo {
	/** Model identifier */
	id: string;
	/** Model capabilities and pricing info */
	info: ModelInfo;
}

/**
 * Core API Handler interface
 *
 * All providers must implement this interface.
 */
export interface ApiHandler {
	/**
	 * Convert Cline messages into provider-specific message format
	 *
	 * @param systemPrompt - The system prompt to use
	 * @param messages - Conversation history
	 * @returns Provider-specific messages payload
	 */
	getMessages(systemPrompt: string, messages: Message[]): unknown;

	/**
	 * Create a streaming message completion
	 *
	 * @param systemPrompt - The system prompt to use
	 * @param messages - Conversation history
	 * @param tools - Optional tool definitions for native tool calling
	 * @returns An async generator yielding stream chunks
	 */
	createMessage(
		systemPrompt: string,
		messages: Message[],
		tools?: ToolDefinition[],
	): ApiStream;

	/**
	 * Get the current model configuration
	 */
	getModel(): HandlerModelInfo;

	/**
	 * Get usage information for the last API call (optional)
	 * Some providers can fetch this from a separate endpoint
	 */
	getApiStreamUsage?(): Promise<ApiStreamUsageChunk | undefined>;

	/**
	 * Abort the current request (optional)
	 */
	abort?(): void;

	/**
	 * Update the abort signal used for subsequent requests (optional).
	 */
	setAbortSignal?(signal: AbortSignal | undefined): void;
}

/**
 * Handler for simple single-turn completions
 */
export interface SingleCompletionHandler {
	/**
	 * Complete a single prompt without streaming
	 */
	completePrompt(prompt: string): Promise<string>;
}

/**
 * Factory function type for creating handlers
 */
export type HandlerFactory<TConfig = unknown> = (config: TConfig) => ApiHandler;

/**
 * Async factory for lazy-loaded handlers
 */
export type LazyHandlerFactory<TConfig = unknown> = (
	config: TConfig,
) => Promise<ApiHandler>;
