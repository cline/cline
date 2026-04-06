import { z } from "zod";
import type { Tool, ToolContext } from "../llms/tools";
import { zodToJsonSchema } from "../parse/zod";

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
