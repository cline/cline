import { createTool } from "../tools/create.js";
import type { Tool } from "../types.js";
import { defaultMcpToolNameTransform } from "./name-transform.js";
import type { CreateMcpToolsOptions, McpToolDescriptor } from "./types.js";

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

/**
 * Convert tools exposed by an MCP server into regular Agent tools.
 *
 * The adapter is intentionally thin: the provider remains the source of truth
 * for connectivity, authorization, caching, and execution behavior.
 */
export async function createMcpTools(
	options: CreateMcpToolsOptions,
): Promise<Tool[]> {
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
			inputSchema: descriptor.inputSchema,
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
