/**
 * 12-custom-executors.ts
 *
 * Learn how to provide custom default tool executors.
 *
 * This example shows how to:
 * - Override default `run_commands` behavior via `bash`
 * - Add logging and safety checks around tool execution
 *
 * Run: bun run 12-custom-executors.ts
 */

import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import {
	createSessionHost,
	type ToolContext,
	type ToolExecutors,
} from "@clinebot/core";

const exec = promisify(execCb);

function createSafeBashExecutor(): NonNullable<ToolExecutors["bash"]> {
	return async (
		command: string,
		cwd: string,
		_context: ToolContext,
	): Promise<string> => {
		if (command.includes("rm -rf") || command.includes("sudo")) {
			throw new Error(`Blocked unsafe command: ${command}`);
		}

		console.log(`🔧 bash executor running: ${command}`);
		const { stdout, stderr } = await exec(command, { cwd, timeout: 30_000 });
		if (stderr.trim().length > 0) {
			return `stdout:\n${stdout}\n\nstderr:\n${stderr}`;
		}
		return stdout;
	};
}

async function runDemo() {
	const sessionManager = await createSessionHost({
		defaultToolExecutors: {
			bash: createSafeBashExecutor(),
		},
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
				"You are a helpful assistant. Use tools to run safe shell commands.",
		},
		prompt: "Run `ls -la` and summarize the output.",
		interactive: false,
	});

	await sessionManager.dispose();
}

async function main() {
	if (!process.env.ANTHROPIC_API_KEY) {
		console.error("Please set ANTHROPIC_API_KEY environment variable");
		process.exit(1);
	}

	await runDemo();
	console.log("✅ Custom executor demo completed");
}

main().catch(console.error);
