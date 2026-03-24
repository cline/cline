/**
 * Custom Plugin Example
 *
 * Shows how to author a reusable plugin module for the CLI and SDK hosts.
 *
 * CLI usage:
 *   mkdir -p .clinerules/plugins
 *   cp apps/examples/cline-plugin/index.ts .clinerules/plugins/weather-metrics.ts
 *   clite -i "What's the weather like in Tokyo and Paris?"
 *
 * Direct demo usage:
 *   ANTHROPIC_API_KEY=sk-... bun run apps/examples/cline-plugin/index.ts
 */

import { type AgentConfig, createTool } from "@clinebot/agents";
import { createSessionHost } from "@clinebot/core";

type Plugin = NonNullable<AgentConfig["extensions"]>[number];

const plugin: Plugin = {
	name: "weather-and-metrics",
	manifest: {
		capabilities: ["tools", "hooks"],
		hookStages: ["run_start", "tool_call_before", "tool_call_after", "run_end"],
	},
	setup(api) {
		api.registerTool(
			createTool({
				name: "get_weather",
				description: "Get the current weather for a city",
				inputSchema: {
					type: "object",
					properties: {
						city: { type: "string", description: "The city name" },
					},
					required: ["city"],
				},
				execute: async (input: unknown) => {
					const { city } = input as { city: string };
					return {
						city,
						temperature: "72°F",
						condition: "sunny",
						humidity: "45%",
					};
				},
			}),
		);
	},
	onRunStart({ userMessage }) {
		console.log(`\n[metrics] started: "${userMessage}"`);
		return undefined;
	},
	onToolCall({ call }) {
		console.log(`[metrics] -> ${call.name}`, call.input);
		return undefined;
	},
	onToolResult({ record }) {
		console.log(`[metrics] <- ${record.name} (${record.durationMs}ms)`);
		return undefined;
	},
	onRunEnd({ result }) {
		const { finishReason, iterations, usage } = result;
		console.log(
			`[metrics] done in ${iterations} iteration(s), reason: ${finishReason}`,
		);
		console.log(
			`[metrics] tokens - in: ${usage.inputTokens}, out: ${usage.outputTokens}`,
		);
	},
};

async function runDemo(): Promise<void> {
	const sessionManager = await createSessionHost({});

	try {
		const result = await sessionManager.start({
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: process.env.ANTHROPIC_API_KEY ?? "",
				cwd: process.cwd(),
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
				systemPrompt: "You are a helpful assistant. Use tools when needed.",
				extensions: [plugin],
			},
			prompt: "What's the weather like in Tokyo and Paris?",
			interactive: false,
		});

		console.log(`\n${result.result?.text ?? ""}`);
	} finally {
		await sessionManager.dispose();
	}
}

if (import.meta.main) {
	await runDemo();
}

export { plugin, runDemo };
export default plugin;
