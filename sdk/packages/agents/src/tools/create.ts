/**
 * Tool Creation Utilities
 *
 * Functions for creating tools with proper typing.
 */

import type * as LlmsProviders from "@clinebot/llms/providers";
import { type Tool, type ToolContext, zodToJsonSchema } from "@clinebot/shared";
import { z } from "zod";

/**
 * Create a tool with proper typing
 *
 * @example
 * ```typescript
 * const readFile = createTool({
 *   name: "read_file",
 *   description: "Read the contents of a file",
 *   inputSchema: {
 *     type: "object",
 *     properties: {
 *       path: { type: "string", description: "File path to read" }
 *     },
 *     required: ["path"]
 *   },
 *   execute: async ({ path }) => {
 *     const content = await fs.readFile(path, "utf-8")
 *     return { content }
 *   }
 * })
 * ```
 */
export function createTool<TInput, TOutput>(config: {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	execute: (input: TInput, context: ToolContext) => Promise<TOutput>;
	timeoutMs?: number;
	retryable?: boolean;
	maxRetries?: number;
}): Tool<TInput, TOutput>;
export function createTool<TSchema extends z.ZodTypeAny, TOutput>(config: {
	name: string;
	description: string;
	inputSchema: TSchema;
	execute: (input: z.infer<TSchema>, context: ToolContext) => Promise<TOutput>;
	timeoutMs?: number;
	retryable?: boolean;
	maxRetries?: number;
}): Tool<z.infer<TSchema>, TOutput>;
export function createTool<TInput, TOutput>(config: {
	name: string;
	description: string;
	inputSchema: Record<string, unknown> | z.ZodTypeAny;
	execute: (input: TInput, context: ToolContext) => Promise<TOutput>;
	timeoutMs?: number;
	retryable?: boolean;
	maxRetries?: number;
}): Tool<TInput, TOutput> {
	const inputSchema =
		config.inputSchema instanceof z.ZodType
			? zodToJsonSchema(config.inputSchema)
			: config.inputSchema;

	return {
		name: config.name,
		description: config.description,
		inputSchema,
		execute: config.execute,
		timeoutMs: config.timeoutMs ?? 30000,
		retryable: config.retryable ?? true,
		maxRetries: config.maxRetries ?? 2,
	};
}

/**
 * Convert a Tool to a ToolDefinition for the provider
 *
 * This transforms our internal Tool format into the format expected
 * by the provider's API.
 */
export function toToolDefinition(tool: Tool): LlmsProviders.ToolDefinition {
	return {
		name: tool.name,
		description: tool.description,
		inputSchema: tool.inputSchema as Record<string, unknown>,
	};
}

/**
 * Convert an array of Tools to ToolDefinitions
 */
export function toToolDefinitions(
	tools: Tool[],
): LlmsProviders.ToolDefinition[] {
	return tools.map(toToolDefinition);
}
