/**
 * 13-full-control.ts
 *
 * A complete "full-control" example that combines:
 * - custom tools
 * - custom hooks
 * - custom extensions
 * - custom default tool executors
 *
 * Run: bun run 13-full-control.ts
 */

import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import type { AgentConfig, Tool, ToolContext } from "@clinebot/agents";
import { createSessionHost, type ToolExecutors } from "@clinebot/core";

const exec = promisify(execCb);

type AgentExtension = NonNullable<AgentConfig["extensions"]>[number];

const timestampTool: Tool = {
	name: "get_timestamp",
	description: "Returns the current timestamp",
	inputSchema: {
		type: "object",
		properties: {
			format: { type: "string", enum: ["iso", "unix"] },
		},
	},
	execute: async (input: unknown, _context: ToolContext) => {
		const args = input as { format?: "iso" | "unix" };
		const now = new Date();
		if (args.format === "unix") {
			return {
				success: true,
				output: String(Math.floor(now.getTime() / 1000)),
			};
		}
		return { success: true, output: now.toISOString() };
	},
};

const analyticsExtension: AgentExtension = {
	name: "analytics_extension",
	manifest: {
		capabilities: ["hooks", "tools"],
		hookStages: ["tool_call_after", "run_end"],
	},
	setup: (api) => {
		api.registerTool(timestampTool);
	},
	onToolResult: async (ctx) => {
		console.log(
			`[analytics] tool=${ctx.record.name} durationMs=${ctx.record.durationMs} error=${ctx.record.error ?? "none"}`,
		);
		return undefined;
	},
	onRunEnd: async (ctx) => {
		const usage = ctx.result.usage;
		console.log(
			`[analytics] done iterations=${ctx.result.iterations} input=${usage.inputTokens} output=${usage.outputTokens}`,
		);
	},
};

const hooks: NonNullable<AgentConfig["hooks"]> = {
	onRunStart: async (ctx) => {
		console.log(`[hooks] run start conversation=${ctx.conversationId}`);
		return undefined;
	},
	onToolCallStart: async (ctx) => {
		console.log(`[hooks] tool start ${ctx.call.name}`);
		return undefined;
	},
	onToolCallEnd: async (ctx) => {
		console.log(`[hooks] tool end ${ctx.record.name}`);
		return undefined;
	},
	onError: async (ctx) => {
		console.error(`[hooks] error ${ctx.error.message}`);
	},
};

const executors: Partial<ToolExecutors> = {
	bash: async (command, cwd) => {
		if (command.includes("rm -rf") || command.includes("sudo")) {
			throw new Error(`Blocked unsafe command: ${command}`);
		}
		const { stdout, stderr } = await exec(command, { cwd, timeout: 30_000 });
		return stderr ? `stdout:\n${stdout}\n\nstderr:\n${stderr}` : stdout;
	},
};

async function main() {
	if (!process.env.ANTHROPIC_API_KEY) {
		console.error("Please set ANTHROPIC_API_KEY environment variable");
		process.exit(1);
	}

	const backendMode =
		process.env.CLINE_BACKEND_MODE === "local" ? "local" : "auto";

	const sessionManager = await createSessionHost({
		backendMode,
		defaultToolExecutors: executors,
	});

	await sessionManager.start({
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: process.env.ANTHROPIC_API_KEY ?? "",
			cwd: process.cwd(),
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
			systemPrompt:
				"You are a production-style assistant with custom hooks, extension capabilities, and safe command execution.",
			hooks,
			extensions: [analyticsExtension],
			extraTools: [timestampTool],
			maxIterations: 10,
		},
		prompt:
			"Call get_timestamp, then read package.json, then run `ls -la`, and summarize what happened.",
		interactive: false,
	});

	await sessionManager.dispose();
	console.log("✅ Full-control demo completed");
}

main().catch(console.error);
