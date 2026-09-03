import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CloudAgentSpawner } from "./cloud-agent.js";

export function createCloudAgentMcpServer(
	spawner = new CloudAgentSpawner(),
): McpServer {
	const server = new McpServer({
		name: "cline-cloud-agent-spawner",
		version: "0.1.0",
	});
	server.registerTool(
		"start_cline_oauth",
		{
			description:
				"Start Cline device-code sign-in. Immediately show verificationUrl and userCode to the user. Keep this MCP server running, then poll get_cline_oauth_status with flowId about every 3 seconds until authenticated or failed. Do not call spawn_cloud_agent while OAuth is pending.",
		},
		async () => {
			try {
				const result = await spawner.startOAuth();
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
					structuredContent: result,
				};
			} catch (error) {
				return toolError(error);
			}
		},
	);
	server.registerTool(
		"get_cline_oauth_status",
		{
			description:
				"Check Cline sign-in. If pending, tell the user you are still waiting and poll again after about 3 seconds without starting another OAuth flow. If authenticated, proceed to spawn_cloud_agent. If failed, show the error and offer to start a new flow.",
			inputSchema: {
				flowId: z.string().uuid(),
			},
		},
		async ({ flowId }) => {
			const result = spawner.getOAuthStatus(flowId);
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				structuredContent: result,
				...(result.status === "failed" ? { isError: true } : {}),
			};
		},
	);
	server.registerTool(
		"spawn_cloud_agent",
		{
			description:
				"Begin creating one autonomous Cline Cloud agent. Call exactly once per requested agent. Returns immediately with an operationId; it does not mean the agent is running yet. Tell the user provisioning has started, then poll get_cloud_agent_spawn_status using operationId and pollAfterMs. Never retry this tool merely because provisioning is slow, because that can create duplicate cloud workspaces.",
			inputSchema: {
				prompt: z.string().trim().min(1).describe("Task for the cloud agent."),
				repoUrl: z
					.string()
					.url()
					.describe(
						"GitHub repository URL accessible to the connected Cline account.",
					),
				modelId: z
					.string()
					.trim()
					.min(1)
					.describe("Cline model ID for the cloud agent."),
				branch: z.string().trim().min(1).optional(),
				organizationId: z
					.string()
					.trim()
					.min(1)
					.nullable()
					.optional()
					.describe(
						"Organization ID, null for Personal, or omit for the active Cline scope.",
					),
				reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
				thinking: z.boolean().optional(),
				autoApproveTools: z.boolean().optional().default(true),
			},
		},
		async (input) => {
			try {
				const result = spawner.startSpawn(input);
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
					structuredContent: result,
				};
			} catch (error) {
				return toolError(error);
			}
		},
	);
	server.registerTool(
		"get_cloud_agent_spawn_status",
		{
			description:
				"Poll a cloud-agent spawn operation. While pending, briefly report stage/message only when useful and poll again after pollAfterMs; do not call spawn_cloud_agent again. On running, give the user dashboardUrl plus both session IDs and explain that the cloud agent continues independently. On failed, report error; if cloudSessionId/dashboardUrl is present, explain that the workspace was created but its inner agent failed.",
			inputSchema: {
				operationId: z.string().uuid(),
			},
		},
		async ({ operationId }) => {
			const result = spawner.getSpawnStatus(operationId);
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				structuredContent: result,
				...(result.status === "failed" ? { isError: true } : {}),
			};
		},
	);
	return server;
}

function toolError(error: unknown) {
	return {
		isError: true as const,
		content: [
			{
				type: "text" as const,
				text: error instanceof Error ? error.message : String(error),
			},
		],
	};
}

export async function main(): Promise<void> {
	const server = createCloudAgentMcpServer();
	await server.connect(new StdioServerTransport());
	console.error("Cline Cloud Agent MCP server running on stdio");
}

if (import.meta.main) {
	main().catch((error: unknown) => {
		console.error("Cline Cloud Agent MCP server failed:", error);
		process.exitCode = 1;
	});
}
