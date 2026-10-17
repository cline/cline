import { describe, expect, test } from "bun:test";
import { mcpRunner } from "./runners";

describe("a pinned read on an MCP server", () => {
	test("a connection that comes up after the read gave up on it is closed", async () => {
		let finishConnecting: () => void = () => undefined;
		let open = false;
		const resolveRunner = mcpRunner(
			"linear",
			{
				registration: async (name) => ({
					name,
					transport: {
						type: "streamableHttp",
						url: "https://mcp.linear.app/mcp",
					},
				}),
				client: async () => ({
					connect: () =>
						new Promise<void>((resolve) => {
							finishConnecting = () => {
								open = true;
								resolve();
							};
						}),
					disconnect: async () => {
						open = false;
					},
					callTool: async () => ({ content: [] }),
				}),
			},
			10,
		);
		const run = await resolveRunner();
		if (typeof run !== "function") throw new Error(run.reason);
		await expect(run("list_my_issues", {})).rejects.toThrow(
			'connecting to "linear" took longer than 10 ms',
		);
		finishConnecting();
		await Bun.sleep(0);
		expect(open).toBe(false);
	});
});
