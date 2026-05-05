import { z } from "zod";
import type { AgentTool, AgentToolContext } from "../agent";
import { zodToJsonSchema } from "../parse/zod";

function normalizeToolInputSchema(
	inputSchema: Record<string, unknown>,
): Record<string, unknown> {
	// Zod v4's z.toJSONSchema() always emits a "$schema" meta-key that is not
	// needed in LLM tool definitions and can confuse strict validators.
	// Strip it here so all downstream consumers get a clean schema.
	const { $schema: _ignored, ...schema } = inputSchema;

	if (typeof schema.type === "string") {
		return schema;
	}
	if (
		"properties" in schema ||
		"required" in schema ||
		"additionalProperties" in schema
	) {
		return {
			type: "object",
			...schema,
		};
	}
	for (const key of ["oneOf", "anyOf", "allOf"] as const) {
		const branches = schema[key];
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
				...schema,
			};
		}
		// Mixed-type union: branches include non-object types (strings, arrays,
		// etc.).  LLM tool APIs require input_schema to describe an object — tool
		// inputs are always key-value maps.  A schema whose top-level branches
		// admit non-object values is almost certainly a mistake (e.g. a
		// coercion/union schema was passed instead of the canonical object
		// schema).  Fail loudly so the bug is caught at registration time.
		throw new Error(
			`Tool inputSchema must describe an object at the top level, but ` +
				`the schema has a top-level "${key}" whose branches include ` +
				`non-object types. Pass the strict object schema as inputSchema ` +
				`and reserve union/coercion schemas for use inside execute().`,
		);
	}
	return schema;
}

export function createTool<TInput, TOutput>(config: {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	execute: (input: TInput, context: AgentToolContext) => Promise<TOutput>;
	lifecycle?: AgentTool<TInput, TOutput>["lifecycle"];
	timeoutMs?: number;
	retryable?: boolean;
	maxRetries?: number;
}): AgentTool<TInput, TOutput>;
export function createTool<TSchema extends z.ZodTypeAny, TOutput>(config: {
	name: string;
	description: string;
	inputSchema: TSchema;
	execute: (
		input: z.infer<TSchema>,
		context: AgentToolContext,
	) => Promise<TOutput>;
	lifecycle?: AgentTool<z.infer<TSchema>, TOutput>["lifecycle"];
	timeoutMs?: number;
	retryable?: boolean;
	maxRetries?: number;
}): AgentTool<z.infer<TSchema>, TOutput>;
export function createTool<TInput, TOutput>(config: {
	name: string;
	description: string;
	inputSchema: Record<string, unknown> | z.ZodTypeAny;
	execute: (input: TInput, context: AgentToolContext) => Promise<TOutput>;
	lifecycle?: AgentTool<TInput, TOutput>["lifecycle"];
	timeoutMs?: number;
	retryable?: boolean;
	maxRetries?: number;
}): AgentTool<TInput, TOutput> {
	const inputSchema = normalizeToolInputSchema(
		config.inputSchema instanceof z.ZodType
			? zodToJsonSchema(config.inputSchema)
			: config.inputSchema,
	);

	return {
		name: config.name,
		description: config.description,
		inputSchema,
		lifecycle: config.lifecycle,
		timeoutMs: config.timeoutMs ?? 30_000,
		retryable: config.retryable ?? true,
		maxRetries: config.maxRetries ?? 3,
		execute: config.execute,
	};
}
