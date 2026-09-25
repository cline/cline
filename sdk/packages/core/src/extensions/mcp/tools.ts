import { type AgentTool, createTool } from "@cline/shared";
import { defaultMcpToolNameTransform } from "./name-transform";
import type { CreateMcpToolsOptions, McpToolDescriptor } from "./types";

function defaultMcpDescription(
	serverName: string,
	tool: McpToolDescriptor,
): string {
	const base = tool.description?.trim();
	if (base) {
		return base;
	}
	return `Execute MCP tool "${tool.name}" from server "${serverName}".`;
}

const REGEX_LOOKAROUND = /\(\?<?[=!]/;

/**
 * OpenAI-backed models reject any request whose tool schemas contain a
 * `pattern` using regex lookaround (e.g. Zod v4's `z.email()`), which blocks
 * the whole conversation even when the tool is never called. `pattern` is only
 * advisory to the model and the MCP server still validates arguments, so
 * dropping just the offending patterns is lossless.
 */
export function stripLookaroundPatterns<T>(schema: T): T {
	if (Array.isArray(schema)) {
		return schema.map(stripLookaroundPatterns) as T;
	}
	if (!schema || typeof schema !== "object") {
		return schema;
	}
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(schema)) {
		if (
			key === "pattern" &&
			typeof value === "string" &&
			REGEX_LOOKAROUND.test(value)
		) {
			continue;
		}
		result[key] = stripLookaroundPatterns(value);
	}
	return result as T;
}

export async function createMcpTools(
	options: CreateMcpToolsOptions,
): Promise<AgentTool[]> {
	const descriptors = await options.provider.listTools(options.serverName);
	const nameTransform = options.nameTransform ?? defaultMcpToolNameTransform;

	return descriptors.map((descriptor) => {
		const agentToolName = nameTransform({
			serverName: options.serverName,
			toolName: descriptor.name,
		});

		return createTool({
			name: agentToolName,
			description: defaultMcpDescription(options.serverName, descriptor),
			inputSchema: stripLookaroundPatterns(descriptor.inputSchema),
			timeoutMs: options.timeoutMs,
			retryable: options.retryable,
			maxRetries: options.maxRetries,
			execute: async (input: unknown, context) =>
				options.provider.callTool({
					serverName: options.serverName,
					toolName: descriptor.name,
					arguments:
						input && typeof input === "object" && !Array.isArray(input)
							? (input as Record<string, unknown>)
							: undefined,
					context,
				}),
		});
	});
}
