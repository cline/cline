/**
 * Custom Plugin Example
 *
 * Shows how to extend @clinebot/core with your own plugins.
 * A plugin can register custom tools and hook into the session lifecycle.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... bun run apps/examples/cline-plugin/index.ts
 */

import { createSessionHost, createTool } from "@clinebot/core";

type SessionHost = Awaited<ReturnType<typeof createSessionHost>>;
type SessionStartConfig = Parameters<SessionHost["start"]>[0]["config"];
type Plugin = NonNullable<SessionStartConfig["extensions"]>[number];

// =============================================================================
// Plugin 1: Custom Tool
// =============================================================================
// Register tools the agent can call. Tools are discovered and invoked
// automatically — just describe what they do and implement execute().

const weatherPlugin: Plugin = {
	name: "weather-plugin",
	manifest: {
		capabilities: ["tools"],
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
					// Replace with a real weather API call in production.
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
};

// =============================================================================
// Plugin 2: Lifecycle Hooks
// =============================================================================
// Hooks let you observe (and optionally influence) the agent at key points.
// Every stage you use must be listed in manifest.hookStages.

const metricsPlugin: Plugin = {
	name: "metrics-plugin",
	manifest: {
		capabilities: ["hooks"],
		hookStages: ["run_start", "tool_call_before", "tool_call_after", "run_end"],
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
			`[metrics] tokens — in: ${usage.inputTokens}, out: ${usage.outputTokens}`,
		);
	},
};

// =============================================================================
// Wire it up
// =============================================================================

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
			extensions: [weatherPlugin, metricsPlugin],
		},
		prompt: "What's the weather like in Tokyo and Paris?",
		interactive: false,
	});

	console.log(`\n${result.result?.text ?? ""}`);
} finally {
	await sessionManager.dispose();
}
