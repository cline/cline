import { type AgentTool, createTool } from "@cline/shared";
import { defaultMcpToolNameTransform } from "./name-transform";
import type { CreateMcpToolsOptions, McpToolDescriptor } from "./types";

function mcpErrorMessage(result: unknown): string | undefined {
	if (
		result === null ||
		typeof result !== "object" ||
		Array.isArray(result) ||
		(result as { isError?: unknown }).isError !== true
	) {
		return undefined;
	}
	const content = (result as { content?: unknown }).content;
	if (!Array.isArray(content)) return "MCP tool returned an error";
	const text = content
		.flatMap((part) =>
			part !== null &&
			typeof part === "object" &&
			(part as { type?: unknown }).type === "text" &&
			typeof (part as { text?: unknown }).text === "string"
				? [(part as { text: string }).text]
				: [],
		)
		.join("\n");
	return text || "MCP tool returned an error";
}

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
			inputSchema: descriptor.inputSchema,
			timeoutMs: options.timeoutMs,
			retryable: options.retryable,
			maxRetries: options.maxRetries,
			execute: async (input: unknown, context) => {
				const result = await options.provider.callTool({
					serverName: options.serverName,
					toolName: descriptor.name,
					arguments:
						input && typeof input === "object" && !Array.isArray(input)
							? (input as Record<string, unknown>)
							: undefined,
					context,
				});
				const error = mcpErrorMessage(result);
				if (error) throw new Error(error);
				return result;
			},
		});
	});
}
