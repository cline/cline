// Regression coverage for cline/cline#13277: "PreToolUse hook is invoked for
// a tool call" on the Next engine.
//
// These tests drive a real @cline/agents AgentRuntime with the extension's
// SDK hooks adapter (buildAgentHooks) wired in, exactly as
// SdkSessionConfigBuilder does for real sessions, and assert that a
// discovered .clinerules/hooks/PreToolUse script actually executes when the
// model makes a tool call. A break anywhere along that chain — the adapter
// not registered on the runtime, a renamed hook event, the hooksEnabled gate
// defaulting off, or discovery missing the workspace script — fails here.
import { afterEach, beforeEach, describe, it } from "bun:test"
import "should"
import { AgentRuntime } from "@cline/agents"
import type { AgentModel, AgentModelEvent, AgentModelRequest } from "@cline/shared"
import fs from "fs/promises"
import path from "path"
import { buildAgentHooks } from "../../../sdk/hooks-adapter"
import type { ClineMessage } from "../../../shared/ExtensionMessage"
import type { StateManager } from "../../storage/StateManager"
import { createHookTestEnv, HookTestEnv, writeHookScriptForPlatform } from "./test-utils"

/** Minimal scripted model: each step yields the model events for one turn. */
class ScriptedModel implements AgentModel {
	constructor(private readonly steps: Array<(request: AgentModelRequest) => AgentModelEvent[]>) {}

	async stream(request: AgentModelRequest): Promise<AsyncIterable<AgentModelEvent>> {
		const step = this.steps.shift()
		if (!step) {
			throw new Error("No scripted model step available")
		}
		const events = step(request)
		return (async function* () {
			yield* events
		})()
	}
}

function fakeStateManager(hooksEnabled: boolean | undefined): StateManager {
	return {
		getGlobalSettingsKey: (key: string) => (key === "hooksEnabled" ? hooksEnabled : undefined),
	} as unknown as StateManager
}

describe("PreToolUse hook on the runtime tool-call path", () => {
	let env: HookTestEnv
	let logPath: string

	// The issue's repro script, in portable Node form: append every firing to
	// a log file, then allow the tool call.
	const firingHookScript = (logFile: string) => `#!/usr/bin/env node
const fs = require('fs');
const input = fs.readFileSync(0, 'utf-8');
fs.appendFileSync(${JSON.stringify(logFile)}, 'FIRED\\n' + input + '\\n');
console.log(JSON.stringify({ cancel: false }));
`

	const writePreToolUseHook = async (script: string): Promise<void> => {
		await writeHookScriptForPlatform(path.join(env.hooksDir, "PreToolUse"), script)
	}

	const readFiredEntries = async (): Promise<string[]> => {
		try {
			const raw = await fs.readFile(logPath, "utf-8")
			return raw.split("\n").filter((line) => line === "FIRED")
		} catch {
			return []
		}
	}

	/** One model turn that calls read_files, then a closing text turn. */
	const toolCallingModel = () =>
		new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "call_1",
					toolName: "read_files",
					inputText: '{"path":"AGENTS.md"}',
				},
				{ type: "finish", reason: "tool-calls" },
			],
			() => [
				{ type: "text-delta", text: "done" },
				{ type: "finish", reason: "stop" },
			],
		])

	const createReadFilesTool = () => {
		const calls: unknown[] = []
		return {
			calls,
			tool: {
				name: "read_files",
				description: "Read files",
				inputSchema: { type: "object" } as const,
				execute: async (input: unknown) => {
					calls.push(input)
					return { content: "AGENTS.md contents" }
				},
			},
		}
	}

	beforeEach(async () => {
		env = await createHookTestEnv()
		logPath = path.join(env.tempDir, "hook-log.jsonl")
	})

	afterEach(async () => {
		await env.cleanup()
	})

	it("invokes the PreToolUse hook script for a tool call", async () => {
		await writePreToolUseHook(firingHookScript(logPath))
		const { calls, tool } = createReadFilesTool()
		const hookMessages: ClineMessage[] = []

		const runtime = new AgentRuntime({
			model: toolCallingModel(),
			tools: [tool],
			hooks: buildAgentHooks(fakeStateManager(true), (message) => hookMessages.push(message)),
		})

		const result = await runtime.run("Read AGENTS.md and summarize it")

		result.status.should.equal("completed")
		calls.length.should.equal(1)

		// The hook fired exactly once, before the tool ran.
		const firings = await readFiredEntries()
		firings.length.should.equal(1)

		// The payload carried the PreToolUse contract: hook name, tool name,
		// and stringified parameters.
		const raw = await fs.readFile(logPath, "utf-8")
		const payload = JSON.parse(raw.split("\n")[1])
		payload.hookName.should.equal("PreToolUse")
		payload.preToolUse.toolName.should.equal("read_files")
		payload.preToolUse.parameters.path.should.equal("AGENTS.md")

		// The adapter surfaced running -> completed hook status to the UI.
		const statuses = hookMessages
			.filter((message) => message.say === "hook_status")
			.map((message) => JSON.parse(message.text ?? "{}"))
			.filter((status) => status.hookName === "PreToolUse")
			.map((status) => status.status)
		statuses.should.deepEqual(["running", "completed"])
	})

	it("blocks the tool call and aborts the run when the hook cancels", async () => {
		await writePreToolUseHook(`#!/usr/bin/env node
const fs = require('fs');
fs.readFileSync(0, 'utf-8');
fs.appendFileSync(${JSON.stringify(logPath)}, 'FIRED\\n');
console.log(JSON.stringify({ cancel: true, errorMessage: "blocked by policy hook" }));
`)
		const { calls, tool } = createReadFilesTool()

		const runtime = new AgentRuntime({
			model: toolCallingModel(),
			tools: [tool],
			hooks: buildAgentHooks(fakeStateManager(true)),
		})

		const result = await runtime.run("Read AGENTS.md")

		const firings = await readFiredEntries()
		firings.length.should.equal(1)
		calls.length.should.equal(0)
		result.status.should.equal("aborted")
	})

	it("does not invoke the hook when hooks are disabled in settings", async () => {
		await writePreToolUseHook(firingHookScript(logPath))
		const { calls, tool } = createReadFilesTool()

		const runtime = new AgentRuntime({
			model: toolCallingModel(),
			tools: [tool],
			hooks: buildAgentHooks(fakeStateManager(false)),
		})

		const result = await runtime.run("Read AGENTS.md")

		result.status.should.equal("completed")
		calls.length.should.equal(1)
		const firings = await readFiredEntries()
		firings.length.should.equal(0)
	})

	// Characterizes the root cause of cline/cline#13277: tools executed by the
	// provider itself (claude-code / codex CLIs, provider web search) surface
	// only as execution-tagged observational events and never enter the
	// runtime tool pipeline, so runtime beforeTool hooks cannot fire for them.
	// Gating those tools happens at the provider boundary instead
	// (onProviderToolPermission); if that boundary changes such that provider
	// tool calls start flowing through the runtime pipeline, this test should
	// be updated alongside it.
	it("does not reach the hook for provider-executed tool activity", async () => {
		await writePreToolUseHook(firingHookScript(logPath))

		const runtime = new AgentRuntime({
			model: new ScriptedModel([
				() => [
					{
						type: "tool-call-delta",
						toolCallId: "call_provider",
						toolName: "Read",
						input: { file_path: "AGENTS.md" },
						execution: "client",
					},
					{ type: "text-delta", text: "done" },
					{ type: "finish", reason: "stop" },
				],
			]),
			tools: [],
			hooks: buildAgentHooks(fakeStateManager(true)),
		})

		const result = await runtime.run("Read AGENTS.md")

		result.status.should.equal("completed")
		const firings = await readFiredEntries()
		firings.length.should.equal(0)
	})
})
