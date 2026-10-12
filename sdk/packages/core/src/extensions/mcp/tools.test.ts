import { describe, expect, it } from "vitest";
import { createMcpTools } from "./tools";

describe("MCP result policy", () => {
	it("opts in independently of naming and preserves the provider response", async () => {
		const output = { content: [{ type: "text", text: "original" }] };
		const tools = await createMcpTools({
			serverName: "github",
			nameTransform: () => "custom_name",
			provider: {
				listTools: async () => [
					{ name: "get_diff", inputSchema: { type: "object" } },
				],
				callTool: async () => output,
			},
		});
		expect(tools[0].resultPolicy).toBe("cache-oversized");
		expect(await tools[0].execute({}, { agentId: "agent", iteration: 1 })).toBe(
			output,
		);
	});
});
