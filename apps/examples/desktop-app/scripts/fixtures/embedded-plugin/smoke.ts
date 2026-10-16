import { writeFileSync } from "node:fs";
import { isMainThread } from "node:worker_threads";
import { getAllProviders } from "@cline/llms/browser";
import { type AgentPlugin, createTool } from "@cline/sdk";
import { CLINE_DEFAULT_MODEL_ID } from "@cline/shared/browser";

export default {
	name: "embedded-smoke",
	manifest: { capabilities: ["tools"] },
	async setup(api) {
		if (
			typeof CLINE_DEFAULT_MODEL_ID !== "string" ||
			typeof getAllProviders !== "function"
		) {
			throw new Error("Missing browser SDK exports");
		}
		const marker = process.env.CLINE_TEST_PLUGIN_RESULT_PATH;
		if (!marker) {
			throw new Error("Missing CLINE_TEST_PLUGIN_RESULT_PATH");
		}
		const tool = createTool({
			name: "embedded_ping",
			description: "Packaged SDK tool",
			inputSchema: { type: "object", properties: {} },
			execute: async () => ({
				pong: true,
				execPath: process.execPath,
				isMainThread,
			}),
		});
		writeFileSync(
			marker,
			JSON.stringify(
				await tool.execute({}, { agentId: "embedded-smoke", iteration: 0 }),
			),
		);
		api.registerTool(tool);
	},
} satisfies AgentPlugin;
