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

describe("MCP Apps tool visibility", () => {
	const listTools = async () => [
		{
			name: "show_weather",
			inputSchema: { type: "object" },
			_meta: { ui: { resourceUri: "ui://weather/view.html" } },
		},
		{
			name: "refresh_view",
			inputSchema: { type: "object" },
			_meta: { ui: { visibility: ["app"] } },
		},
	];

	it("leaves app-only tools out of the model's tool list", async () => {
		const tools = await createMcpTools({
			serverName: "weather",
			provider: {
				listTools,
				callTool: async () => ({ content: [] }),
			},
		});
		expect(tools.map((tool) => tool.name)).toEqual(["weather__show_weather"]);
	});
});
