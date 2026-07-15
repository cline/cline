import { CommandExitError } from "@cline/core"
import { EventEmitter } from "events"
import { describe, expect, it } from "vitest"
import type { VscodeTerminalManager } from "@/hosts/vscode/terminal/VscodeTerminalManager"
import type { TerminalCompletionDetails } from "@/integrations/terminal/types"
import { executeForeground, formatCommandForTerminal } from "./vscode-run-commands-tool"

/**
 * Minimal fake of the process object returned by VscodeTerminalManager.runCommand():
 * an EventEmitter that is also awaitable (mirroring mergePromise in
 * VscodeTerminalProcess.ts), emitting the given lines then completing.
 */
function createFakeTerminalProcess(options: { lines?: string[]; completionDetails?: TerminalCompletionDetails } = {}) {
	const emitter = new EventEmitter()
	// Emit on a macrotask (not a microtask) so executeForeground's
	// `await terminalManager.getOrCreateTerminal(cwd)` and subsequent
	// `process.on("line", ...)` registration are guaranteed to run first,
	// matching the ordering a real terminal process provides.
	const promise = new Promise<void>((resolve) => {
		setTimeout(() => {
			for (const line of options.lines ?? []) {
				emitter.emit("line", line)
			}
			emitter.emit("completed", options.completionDetails)
			emitter.emit("continue")
			resolve()
		}, 0)
	})
	const fakeProcess = Object.assign(emitter, {
		then: promise.then.bind(promise),
		catch: promise.catch.bind(promise),
		finally: promise.finally.bind(promise),
		getCompletionDetails: () => options.completionDetails ?? {},
	})
	return fakeProcess as unknown as ReturnType<VscodeTerminalManager["runCommand"]>
}

function createFakeTerminalManager(process: ReturnType<VscodeTerminalManager["runCommand"]>): VscodeTerminalManager {
	return {
		getOrCreateTerminal: async () => ({ terminal: { show: () => {} } }) as never,
		runCommand: () => process,
	} as unknown as VscodeTerminalManager
}

describe("formatCommandForTerminal", () => {
	it.each([
		{
			name: "raw shell command",
			input: "which git",
			expected: "which git",
		},
		{
			name: "raw shell command with pipes and quotes",
			input: "git status --short | sed -n '1,20p'",
			expected: "git status --short | sed -n '1,20p'",
		},
		{
			name: "structured command with omitted args",
			input: { command: "which git" },
			expected: "which git",
		},
		{
			name: "structured shell command with omitted args and metacharacters",
			input: { command: "git status --short | head -20" },
			expected: "git status --short | head -20",
		},
		{
			name: "structured executable with explicit empty args",
			input: { command: "/tmp/path with spaces/tool", args: [] },
			expected: "'/tmp/path with spaces/tool'",
		},
		{
			name: "structured executable with simple args",
			input: { command: "which", args: ["git"] },
			expected: "which git",
		},
		{
			name: "structured executable with spaced args",
			input: { command: "echo", args: ["hello world", "again"] },
			expected: "echo 'hello world' again",
		},
		{
			name: "structured executable with apostrophe args",
			input: { command: "printf", args: ["it's ok"] },
			expected: "printf 'it'\\''s ok'",
		},
		{
			name: "structured executable with empty arg",
			input: { command: "printf", args: [""] },
			expected: "printf ''",
		},
		{
			name: "structured executable with shell metacharacters in args",
			input: { command: "echo", args: ["$HOME", "a&b", "semi;colon", "paren(value)"] },
			expected: "echo '$HOME' 'a&b' 'semi;colon' 'paren(value)'",
		},
		{
			name: "structured executable with quoted args",
			input: { command: "node", args: ["-e", 'console.log("hi")'] },
			expected: "node -e 'console.log(\"hi\")'",
		},
	])("$name", ({ input, expected }) => {
		expect(formatCommandForTerminal(input)).toBe(expected)
	})

	it("quotes multiple structured args that need shell escaping", () => {
		expect(formatCommandForTerminal({ command: "echo", args: ["hello world", "it's ok"] })).toBe(
			"echo 'hello world' 'it'\\''s ok'",
		)
	})
})

describe("executeForeground", () => {
	it("returns output as-is on success (no exit code captured)", async () => {
		const process = createFakeTerminalProcess({ lines: ["hello"] })
		const terminalManager = createFakeTerminalManager(process)

		const result = await executeForeground("echo hello", "/workspace", terminalManager, 1000)

		expect(result).toBe("hello")
	})

	it("returns output as-is when the exit code is 0", async () => {
		const process = createFakeTerminalProcess({ lines: ["hello"], completionDetails: { exitCode: 0 } })
		const terminalManager = createFakeTerminalManager(process)

		const result = await executeForeground("echo hello", "/workspace", terminalManager, 1000)

		expect(result).toBe("hello")
	})

	it("throws CommandExitError with the exit code on non-zero exit", async () => {
		const terminalManager = createFakeTerminalManager(
			createFakeTerminalProcess({ lines: ["boom"], completionDetails: { exitCode: 127 } }),
		)

		try {
			await executeForeground("nonexistent-cmd", "/workspace", terminalManager, 1000)
			expect.unreachable("expected executeForeground to throw")
		} catch (error) {
			expect(error).toBeInstanceOf(CommandExitError)
			expect((error as InstanceType<typeof CommandExitError>).exitCode).toBe(127)
			expect((error as InstanceType<typeof CommandExitError>).output).toContain("boom")
		}
	})

	it("caps buffered output lines instead of accumulating without bound", async () => {
		// One more line than the cap — the earliest line must be dropped rather
		// than growing the buffer indefinitely.
		const manyLines = Array.from({ length: 10_001 }, (_, i) => `line-${i}`)
		const terminalManager = createFakeTerminalManager(createFakeTerminalProcess({ lines: manyLines }))

		const result = await executeForeground("noisy-cmd", "/workspace", terminalManager, 10_000_000)

		expect(result).not.toContain("line-0\n")
		expect(result).toContain("line-10000")
		expect(result).toContain("dropped")
	})

	it("throws CommandExitError when the terminal closes mid-command, even with no exit code", async () => {
		const process = createFakeTerminalProcess({
			lines: ["partial output"],
			completionDetails: { terminalClosed: true },
		})
		const terminalManager = createFakeTerminalManager(process)

		try {
			await executeForeground("long-running-cmd", "/workspace", terminalManager, 1000)
			expect.unreachable("expected executeForeground to throw when the terminal closed mid-command")
		} catch (error) {
			expect(error).toBeInstanceOf(CommandExitError)
			expect((error as InstanceType<typeof CommandExitError>).output).toContain("Terminal closed")
		}
	})
})
