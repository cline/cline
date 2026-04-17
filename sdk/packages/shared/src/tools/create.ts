import { z } from "zod";
import type { Tool, ToolContext } from "../llms/tools";
import { zodToJsonSchema } from "../parse/zod";

function normalizeToolInputSchema(
	inputSchema: Record<string, unknown>,
): Record<string, unknown> {
	if (typeof inputSchema.type === "string") {
		return inputSchema;
	}
	if (
		"properties" in inputSchema ||
		"required" in inputSchema ||
		"additionalProperties" in inputSchema
	) {
		return {
			type: "object",
			...inputSchema,
		};
	}
	for (const key of ["oneOf", "anyOf", "allOf"] as const) {
		const branches = inputSchema[key];
		if (!Array.isArray(branches) || branches.length === 0) {
			continue;
		}
		const allObjectBranches = branches.every(
			(branch) =>
				branch &&
				typeof branch === "object" &&
				(branch as Record<string, unknown>).type === "object",
		);
		if (allObjectBranches) {
			return {
				type: "object",
				...inputSchema,
			};
		}
	}
	return inputSchema;
}

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
	const inputSchema = normalizeToolInputSchema(
		config.inputSchema instanceof z.ZodType
			? zodToJsonSchema(config.inputSchema)
			: config.inputSchema,
	);

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
