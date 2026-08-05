/**
 * End-to-end coverage for the plan-mode command guard.
 *
 * The unit tests in `command-guard-extension.test.ts` invoke the `beforeTool`
 * hook directly. These tests instead drive a real `AgentRuntime` loop with the
 * guard registered the way `DefaultRuntimeBuilder` registers it, against a
 * *host-replaced* `run_commands` tool that really touches the filesystem —
 * the shape the VS Code extension ships (`createVscodeRunCommandsTool`
 * replaces the SDK built-in under the same tool name).
 *
 * That combination is what protects users: the guard has to stop the call
 * before the host tool executes, and it has to leave read-only commands and
 * act-mode sessions alone.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRuntime } from "@cline/agents";
import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimeHooks,
	AgentTool,
} from "@cline/shared";
import { afterEach, describe, expect, it } from "vitest";
import { DefaultRuntimeBuilder } from "../../runtime/orchestration/runtime-builder";
import type { CoreSessionConfig } from "../../types/config";
import { PLAN_MODE_COMMAND_GUARD_EXTENSION_NAME } from "./command-guard-extension";

const tempDirs: string[] = [];

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "plan-guard-e2e-"));
	tempDirs.push(dir);
	return dir;
}

function makeConfig(overrides: Partial<CoreSessionConfig>): CoreSessionConfig {
	return {
		providerId: "anthropic",
		modelId: "claude-sonnet-4-6",
		apiKey: "key",
		systemPrompt: "test",
		cwd: process.cwd(),
		enableTools: true,
		enableSpawnAgent: false,
		enableAgentTeams: false,
		...overrides,
	};
}

/**
 * Stand-in for the VS Code extension's terminal-backed `run_commands`: it
 * registers under the same tool name as the SDK built-in and performs a real
 * side effect, so a guard that fails to fire is observable on disk.
 */
function createHostRunCommandsTool(sideEffectPath: string): {
	tool: AgentTool;
	executed: string[][];
} {
	const executed: string[][] = [];
	const tool: AgentTool = {
		name: "run_commands",
		description: "Host-replaced terminal tool",
		inputSchema: { type: "object", properties: {}, required: [] },
		execute: async (input: unknown) => {
			const commands = (input as { commands?: string[] }).commands ?? [];
			executed.push(commands);
			// A real shell would create the file; emulate that side effect so a
			// guard bypass leaves evidence rather than silently passing.
			writeFileSync(sideEffectPath, "created by host tool\n");
			return { ok: true };
		},
	};
	return { tool, executed };
}

class ScriptedModel implements AgentModel {
	constructor(
		private readonly steps: Array<
			(request: AgentModelRequest) => AgentModelEvent[]
		>,
	) {}

	async stream(
		request: AgentModelRequest,
	): Promise<AsyncIterable<AgentModelEvent>> {
		const step = this.steps.shift();
		if (!step) {
			throw new Error("No scripted model step available");
		}
		const events = step(request);
		return (async function* () {
			for (const event of events) {
				yield event;
			}
		})();
	}
}

/** Emits a single `run_commands` call, then ends the turn. */
function scriptCommandTurn(commands: string[]): ScriptedModel {
	return new ScriptedModel([
		() => [
			{
				type: "tool-call-delta",
				toolCallId: "call_1",
				toolName: "run_commands",
				inputText: JSON.stringify({ commands }),
			},
			{ type: "finish", reason: "tool-calls" },
		],
		() => [
			{ type: "text-delta", text: "done" },
			{ type: "finish", reason: "stop" },
		],
	]);
}

/**
 * Registers the built runtime's extension hooks the way the session
 * orchestrator does, so the guard runs through the same path as production.
 */
async function buildGuardHooks(
	mode: CoreSessionConfig["mode"],
): Promise<{ hooks: Partial<AgentRuntimeHooks>; guardRegistered: boolean }> {
	const runtime = await new DefaultRuntimeBuilder().build({
		config: makeConfig({ mode }),
	});
	const extensionHooks = (runtime.extensions ?? [])
		.map((extension) => extension.hooks)
		.filter((hooks): hooks is NonNullable<typeof hooks> => hooks !== undefined);
	const guardRegistered = (runtime.extensions ?? []).some(
		(extension) => extension.name === PLAN_MODE_COMMAND_GUARD_EXTENSION_NAME,
	);

	const hooks: Partial<AgentRuntimeHooks> = {
		beforeTool: async (ctx) => {
			for (const hook of extensionHooks) {
				const result = await hook.beforeTool?.(ctx);
				if (result?.stop || result?.skip) {
					return result;
				}
			}
			return undefined;
		},
	};
	return { hooks, guardRegistered };
}

function lastToolResultText(
	runtimeResult: Awaited<ReturnType<AgentRuntime["run"]>>,
): string {
	const toolMessage = runtimeResult.messages.find(
		(message) => message.role === "tool",
	);
	return JSON.stringify(toolMessage?.content ?? []);
}

describe("plan-mode command guard (end-to-end through the agent loop)", () => {
	it("blocks a host-replaced run_commands tool before it can touch the filesystem", async () => {
		const dir = makeTempDir();
		const sideEffectPath = join(dir, "scratch_probe.txt");
		const { tool, executed } = createHostRunCommandsTool(sideEffectPath);
		const { hooks, guardRegistered } = await buildGuardHooks("plan");
		expect(guardRegistered).toBe(true);

		const runtime = new AgentRuntime({
			model: scriptCommandTurn(["touch src/scratch_probe.txt"]),
			tools: [tool],
			hooks,
		});

		const result = await runtime.run("Please run the command");

		// The host tool must never have run, so no file was created.
		expect(executed).toEqual([]);
		expect(existsSync(sideEffectPath)).toBe(false);

		// The model is told why, and the run continues (skip, not stop).
		const toolResult = lastToolResultText(result);
		expect(toolResult).toContain("Command not executed");
		expect(toolResult).toContain("`touch`");
		expect(toolResult).toContain("PLAN MODE");
		expect(result.status).toBe("completed");
	});

	it("still lets read-only commands reach the host tool in plan mode", async () => {
		const dir = makeTempDir();
		const sideEffectPath = join(dir, "readonly-marker.txt");
		const { tool, executed } = createHostRunCommandsTool(sideEffectPath);
		const { hooks } = await buildGuardHooks("plan");

		const runtime = new AgentRuntime({
			model: scriptCommandTurn(["git status", "ls -la", "grep -rn foo src/"]),
			tools: [tool],
			hooks,
		});

		const result = await runtime.run("Please inspect the repo");

		expect(executed).toEqual([["git status", "ls -la", "grep -rn foo src/"]]);
		expect(result.status).toBe("completed");
	});

	it("does not block the same mutating command in act mode", async () => {
		const dir = makeTempDir();
		const sideEffectPath = join(dir, "act-mode-file.txt");
		const { tool, executed } = createHostRunCommandsTool(sideEffectPath);
		const { hooks, guardRegistered } = await buildGuardHooks("act");
		expect(guardRegistered).toBe(false);

		const runtime = new AgentRuntime({
			model: scriptCommandTurn(["touch src/scratch_probe.txt"]),
			tools: [tool],
			hooks,
		});

		const result = await runtime.run("Please run the command");

		expect(executed).toEqual([["touch src/scratch_probe.txt"]]);
		expect(existsSync(sideEffectPath)).toBe(true);
		expect(result.status).toBe("completed");
	});

	it("rejects an entire batch when a later command is mutating", async () => {
		const dir = makeTempDir();
		const sideEffectPath = join(dir, "batch-file.txt");
		const { tool, executed } = createHostRunCommandsTool(sideEffectPath);
		const { hooks } = await buildGuardHooks("plan");

		const runtime = new AgentRuntime({
			model: scriptCommandTurn(["git status", "rm -rf build"]),
			tools: [tool],
			hooks,
		});

		const result = await runtime.run("Please run these");

		expect(executed).toEqual([]);
		expect(existsSync(sideEffectPath)).toBe(false);
		expect(lastToolResultText(result)).toContain("`rm`");
	});
});
