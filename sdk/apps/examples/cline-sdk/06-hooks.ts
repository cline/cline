/**
 * 06-hooks.ts
 *
 * Learn how to use hooks to observe and react to agent lifecycle events.
 *
 * This example shows how to:
 * - Hook into different lifecycle stages
 * - Track tool calls and completions
 * - Monitor token usage
 * - Log agent behavior
 * - Implement custom analytics
 *
 * Hook stages:
 * - pre_config: Before agent configuration
 * - post_config: After agent configuration
 * - pre_prompt: Before processing user prompt
 * - post_prompt: After processing prompt
 * - pre_tool_call: Before each tool execution
 * - post_tool_call: After each tool execution
 * - pre_response: Before agent response
 * - post_response: After agent response
 *
 * Prerequisites:
 * - Set ANTHROPIC_API_KEY environment variable
 *
 * Run: bun run 06-hooks.ts
 */

import { type AgentConfig, ClineCore } from "@clinebot/core";

type AgentHooksConfig = NonNullable<AgentConfig["hooks"]>;

const loggingHooks: AgentHooksConfig = {
	onRunStart: async (ctx) => {
		console.log(`🚀 Run started (conversation=${ctx.conversationId})`);
		return undefined;
	},
	onToolCallStart: async (ctx) => {
		console.log(`🔧 Tool start: ${ctx.call.name}`);
		return undefined;
	},
	onToolCallEnd: async (ctx) => {
		const ok = !ctx.record.error;
		console.log(
			`✅ Tool end: ${ctx.record.name} (${ok ? "success" : "error"}) in ${ctx.record.durationMs}ms`,
		);
		return undefined;
	},
	onRunEnd: async (ctx) => {
		const usage = ctx.result.usage;
		console.log(
			`📊 Usage: input=${usage.inputTokens}, output=${usage.outputTokens}`,
		);
	},
	onError: async (ctx) => {
		console.error(`❌ Hook observed error: ${ctx.error.message}`);
	},
};

const performanceHooks: AgentHooksConfig = {
	onIterationStart: async (ctx) => {
		console.log(`⏱️ Iteration ${ctx.iteration} started`);
		return undefined;
	},
	onIterationEnd: async (ctx) => {
		console.log(
			`⏱️ Iteration ${ctx.iteration} ended (toolCalls=${ctx.toolCallCount})`,
		);
	},
	onToolCallEnd: async (ctx) => {
		console.log(`⚡ ${ctx.record.name} took ${ctx.record.durationMs}ms`);
		return undefined;
	},
};

const securityHooks: AgentHooksConfig = {
	onToolCallStart: async (ctx) => {
		if (ctx.call.name !== "run_commands") {
			return undefined;
		}
		const input = ctx.call.input;
		const command =
			typeof input === "object" && input !== null
				? (input as { command?: string }).command
				: undefined;
		if (!command) {
			return undefined;
		}
		if (
			command.includes("rm -rf") ||
			command.includes("sudo") ||
			command.includes("chmod 777")
		) {
			console.warn(`⚠️ Potentially dangerous command detected: ${command}`);
		}
		return undefined;
	},
};

const contextHooks: AgentHooksConfig = {
	onRunStart: async () => ({
		context: `[System Context]\n- Node: ${process.version}\n- Platform: ${process.platform}\n- Arch: ${process.arch}\n- CWD: ${process.cwd()}`,
	}),
};

async function demoLoggingHook() {
	console.log("\n=== Logging Hook ===\n");

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

			// Add hooks to configuration
			hooks: loggingHooks,

			systemPrompt: "You are a helpful assistant.",
		},
		prompt: "Read the package.json and tell me the project name.",
		interactive: false,
	});

	await sessionManager.dispose();
}

async function demoPerformanceHook() {
	console.log("\n=== Performance Monitoring Hook ===\n");

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
			hooks: performanceHooks,
			systemPrompt: "You are a helpful assistant.",
		},
		prompt: "List all TypeScript files in this directory.",
		interactive: false,
	});

	await sessionManager.dispose();
}

async function demoSecurityHook() {
	console.log("\n=== Security Audit Hook ===\n");

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
			hooks: securityHooks,
			systemPrompt:
				"You are a helpful assistant. For demo purposes, try to run 'ls -la' command.",
		},
		prompt: "List files in the current directory using a shell command.",
		interactive: false,
	});

	await sessionManager.dispose();
}

async function demoMultipleHooks() {
	console.log("\n=== Multiple Hooks Combined ===\n");

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

			// Combine multiple concerns in one hooks object
			hooks: {
				...loggingHooks,
				...performanceHooks,
				...securityHooks,
			},

			systemPrompt: "You are a helpful assistant.",
		},
		prompt:
			"Read package.json and search for any TODO comments in TypeScript files.",
		interactive: false,
	});

	await sessionManager.dispose();
}

async function demoContextEnrichment() {
	console.log("\n=== Context Enrichment Hook ===\n");

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
			hooks: contextHooks,
			systemPrompt:
				"You are a helpful assistant. Use the system context provided.",
		},
		prompt: "What system are you running on?",
		interactive: false,
	});

	await sessionManager.dispose();
}

async function main() {
	if (!process.env.ANTHROPIC_API_KEY) {
		console.error("Please set ANTHROPIC_API_KEY environment variable");
		process.exit(1);
	}

	await demoLoggingHook();
	await demoPerformanceHook();
	await demoSecurityHook();
	await demoMultipleHooks();
	await demoContextEnrichment();

	console.log("\n✅ All hook demos completed!");
}

main().catch(console.error);
