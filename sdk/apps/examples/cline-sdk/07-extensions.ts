/**
 * 07-extensions.ts
 *
 * Learn how to extend agent capabilities with extensions.
 *
 * This example shows how to:
 * - Create agent extensions
 * - Add custom capabilities
 * - Integrate external services
 * - Implement middleware patterns
 *
 * Extensions can:
 * - Add new tools
 * - Modify agent behavior
 * - Integrate with external systems
 * - Implement cross-cutting concerns
 *
 * Prerequisites:
 * - Set ANTHROPIC_API_KEY environment variable
 *
 * Run: bun run 07-extensions.ts
 */

import { type AgentConfig, ClineCore, type Tool } from "@clinebot/core";

type AgentExtension = NonNullable<AgentConfig["extensions"]>[number];

// Example 1: Analytics extension
const analyticsExtension: AgentExtension = {
	name: "analytics",
	manifest: {
		capabilities: ["hooks"],
		hookStages: ["tool_call_after", "run_end"],
	},
	onToolResult: async (ctx) => {
		const ok = !ctx.record.error;
		console.log(
			`📊 Analytics: ${ctx.record.name} ${ok ? "succeeded" : "failed"} in ${ctx.record.durationMs}ms`,
		);
		return undefined;
	},
	onRunEnd: async (ctx) => {
		console.log(
			`📊 Analytics: run complete, tokens=${ctx.result.usage.inputTokens + ctx.result.usage.outputTokens}`,
		);
	},
};

// Example 2: Caching extension
const cachingExtension: AgentExtension = {
	name: "caching",
	manifest: {
		capabilities: ["tools"],
	},
	setup: (api) => {
		const cacheGet: Tool = {
			name: "cache_get",
			description: "Get a value from cache",
			inputSchema: {
				type: "object",
				properties: {
					key: { type: "string", description: "Cache key" },
				},
				required: ["key"],
			},
			execute: async (input: unknown) => {
				const args = input as { key: string };
				// Simulated cache
				const cache: Record<string, string> = {
					"weather:sf": "18°C, Foggy",
					"user:count": "42",
				};

				const value = cache[args.key];
				if (value) {
					return { success: true, output: `Cached value: ${value}` };
				}
				return {
					success: false,
					output: `No cached value for key: ${args.key}`,
				};
			},
		};

		const cacheSet: Tool = {
			name: "cache_set",
			description: "Store a value in cache",
			inputSchema: {
				type: "object",
				properties: {
					key: { type: "string", description: "Cache key" },
					value: { type: "string", description: "Value to cache" },
					ttl: {
						type: "number",
						description: "Time to live in seconds (optional)",
					},
				},
				required: ["key", "value"],
			},
			execute: async (input: unknown) => {
				const args = input as { key: string; value: string; ttl?: number };
				console.log(
					`💾 Cache set: ${args.key} = ${args.value} (TTL: ${args.ttl || "∞"}s)`,
				);
				return { success: true, output: `Cached ${args.key}` };
			},
		};

		api.registerTool(cacheGet);
		api.registerTool(cacheSet);
	},
};

// Example 3: Rate limiting extension
const rateLimitExtension: AgentExtension = {
	name: "rate_limiter",
	manifest: {
		capabilities: ["hooks"],
		hookStages: ["tool_call_before"],
	},
	onToolCall: async (ctx) => {
		if (ctx.call.name === "fetch_web_content") {
			console.log("🚦 Rate limit check: fetch_web_content (OK)");
		}
		return undefined;
	},
};

// Example 4: Notification extension with tools
const notificationExtension: AgentExtension = {
	name: "notifications",
	manifest: {
		capabilities: ["tools"],
	},
	setup: (api) => {
		const sendNotification: Tool = {
			name: "send_notification",
			description: "Send a notification to a specified channel",
			inputSchema: {
				type: "object",
				properties: {
					channel: {
						type: "string",
						enum: ["email", "slack", "sms"],
						description: "Notification channel",
					},
					message: {
						type: "string",
						description: "Notification message",
					},
					priority: {
						type: "string",
						enum: ["low", "normal", "high", "urgent"],
						description: "Priority level",
					},
				},
				required: ["channel", "message"],
			},
			execute: async (input: unknown) => {
				const args = input as {
					channel: string;
					message: string;
					priority?: string;
				};
				// Simulate sending notification
				const priority = args.priority || "normal";
				console.log(
					`\n📬 Notification sent via ${args.channel} [${priority}]:`,
				);
				console.log(`   ${args.message}\n`);

				return {
					success: true,
					output: `Notification sent via ${args.channel}`,
				};
			},
		};

		api.registerTool(sendNotification);
	},
};

// Example 5: Logging extension
const loggingExtension: AgentExtension = {
	name: "structured_logger",
	manifest: {
		capabilities: ["hooks"],
		hookStages: ["tool_call_before", "tool_call_after", "run_end"],
	},
	onToolCall: async (ctx) => {
		console.log(
			`📝 Log: ${JSON.stringify({ stage: "tool_call_before", tool: ctx.call.name, iteration: ctx.iteration })}`,
		);
		return undefined;
	},
	onToolResult: async (ctx) => {
		console.log(
			`📝 Log: ${JSON.stringify({ stage: "tool_call_after", tool: ctx.record.name, durationMs: ctx.record.durationMs })}`,
		);
		return undefined;
	},
	onRunEnd: async (ctx) => {
		console.log(
			`📝 Log: ${JSON.stringify({ stage: "run_end", iterations: ctx.result.iterations })}`,
		);
	},
};

async function demoAnalyticsExtension() {
	console.log("\n=== Analytics Extension ===\n");

	const sessionManager = await ClineCore.create({});

	await sessionManager.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,

			// Add extension via extensions config
			extensions: [analyticsExtension],

			systemPrompt: "You are a helpful assistant.",
		},
		prompt: "Read the README.md file.",
		interactive: false,
	});

	await sessionManager.dispose();
}

async function demoCachingExtension() {
	console.log("\n=== Caching Extension ===\n");

	const sessionManager = await ClineCore.create({});

	await sessionManager.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
			extensions: [cachingExtension],
			systemPrompt:
				"You are a helpful assistant with access to a cache. You can use cache_get to retrieve cached values.",
		},
		prompt:
			"Check if there's a cached weather value for San Francisco (key: weather:sf)",
		interactive: false,
	});

	await sessionManager.dispose();
}

async function demoNotificationExtension() {
	console.log("\n=== Notification Extension ===\n");

	const sessionManager = await ClineCore.create({});

	await sessionManager.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
			extensions: [notificationExtension],
			systemPrompt:
				"You are a helpful assistant. You can send notifications. Send a notification to confirm task completion.",
		},
		prompt: "Send me a slack notification saying 'Task completed successfully'",
		interactive: false,
	});

	await sessionManager.dispose();
}

async function demoMultipleExtensions() {
	console.log("\n=== Multiple Extensions Combined ===\n");

	const sessionManager = await ClineCore.create({});

	await sessionManager.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,

			// Load multiple extensions
			extensions: [
				analyticsExtension,
				cachingExtension,
				rateLimitExtension,
				notificationExtension,
				loggingExtension,
			],

			systemPrompt:
				"You are a helpful assistant with analytics, caching, notifications, and logging capabilities.",
		},
		prompt:
			"Check cache for user:count, then read package.json, and send a slack notification with the result.",
		interactive: false,
	});

	await sessionManager.dispose();
}

async function main() {
	if (!process.env.ANTHROPIC_API_KEY) {
		console.error("Please set ANTHROPIC_API_KEY environment variable");
		process.exit(1);
	}

	await demoAnalyticsExtension();
	await demoCachingExtension();
	await demoNotificationExtension();
	await demoMultipleExtensions();

	console.log("\n✅ All extension demos completed!");
	console.log(
		"\n💡 Tip: Extensions are powerful for adding cross-cutting concerns like:",
	);
	console.log("   • Analytics and monitoring");
	console.log("   • Caching and performance optimization");
	console.log("   • Security and compliance");
	console.log("   • Integration with external services");
}

main().catch(console.error);
