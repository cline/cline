import type { AgentToolContext } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { createMcpTools } from "./tools";

const context: AgentToolContext = {
	agentId: "agent-1",
	conversationId: "conversation-1",
	iteration: 1,
};

describe("createMcpTools", () => {
	it("promotes MCP error responses to tool execution failures", async () => {
		const provider = {
			listTools: vi.fn(async () => [
				{
					name: "poll",
					inputSchema: { type: "object", properties: {} },
				},
			]),
			callTool: vi.fn(async () => ({
				content: [{ type: "text", text: "job failed" }],
				isError: true,
			})),
		};
		const [tool] = await createMcpTools({ serverName: "server", provider });

		await expect(tool.execute({}, context)).rejects.toThrow("job failed");
	});
});
