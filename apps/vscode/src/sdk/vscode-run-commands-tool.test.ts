import { CommandExitError } from "@cline/core"
import { EventEmitter } from "events"
import * as fs from "fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"
import type { VscodeTerminalManager } from "@/hosts/vscode/terminal/VscodeTerminalManager"
import type { TerminalCompletionDetails } from "@/integrations/terminal/types"
import { SdkForegroundCommandCoordinator } from "./sdk-foreground-command-coordinator"
import {
	createVscodeRunCommandsTool,
	executeForeground,
	formatCommandForTerminal,
	PROCEED_LOG_MAX_BYTES,
} from "./vscode-run-commands-tool"

const mocks = vi.hoisted(() => ({
	existsSync: vi.fn<(path: fs.PathLike) => boolean>(),
	getGlobalSettingsKey: vi.fn(() => "default"),
}))

vi.mock("fs", async (importOriginal) => ({
	...(await importOriginal<typeof import("fs")>()),
	existsSync: mocks.existsSync,
}))

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({ getGlobalSettingsKey: mocks.getGlobalSettingsKey }),
	},
}))

// The real telemetry proxy lazily initializes TelemetryService, which requires
// a HostProvider that unit tests don't set up.
vi.mock("@services/telemetry", () => ({
	TerminalUserInterventionAction: { PROCESS_WHILE_RUNNING: "process_while_running" },
	telemetryService: {
		captureTerminalUserIntervention: () => {},
		captureTerminalExecution: () => {},
	},
}))

const originalPlatform = process.platform
const originalEnv = { ...process.env }
const originalGetConfiguration = vscode.workspace.getConfiguration

afterEach(() => {
	Object.defineProperty(process, "platform", { value: originalPlatform })
	process.env = { ...originalEnv }
	vscode.workspace.getConfiguration = originalGetConfiguration
	mocks.existsSync.mockReset()
	mocks.getGlobalSettingsKey.mockReset()
	mocks.getGlobalSettingsKey.mockReturnValue("default")
})

describe("createVscodeRunCommandsTool", () => {
	it("constructs a cmd tool from the stock array-valued Command Prompt profile", () => {
		Object.defineProperty(process, "platform", { value: "win32" })
		process.env.windir = "C:\\Windows"
		mocks.existsSync.mockImplementation((candidate) => candidate === "C:\\Windows\\System32\\cmd.exe")
		vscode.workspace.getConfiguration = () =>
			({
				get: (key: string) => {
					if (key === "defaultProfile.windows") {
						return "Command Prompt"
					}
					if (key === "profiles.windows") {
						return {
							"Command Prompt": {
								path: [`\${env:windir}\\Sysnative\\cmd.exe`, `\${env:windir}\\System32\\cmd.exe`],
							},
						}
					}
					return undefined
				},
			}) as never

		const tool = createVscodeRunCommandsTool({
			cwd: "C:\\workspace",
			getTerminalManager: () => {
				throw new Error("Terminal manager should not be created during tool construction")
			},
			vscodeTerminalExecutionMode: "vscodeTerminal",
		})

		expect(tool.name).toBe("run_commands")
		expect(tool.description).toContain("Commands run through cmd.exe")
	})

	it("re-derives the description from the current profile on each read", () => {
		Object.defineProperty(process, "platform", { value: "win32" })
		mocks.existsSync.mockReturnValue(true)
		mocks.getGlobalSettingsKey.mockReturnValue("cmd")

		const tool = createVscodeRunCommandsTool({
			cwd: "C:\\workspace",
			getTerminalManager: () => {
				throw new Error("Terminal manager should not be created during tool construction")
			},
			vscodeTerminalExecutionMode: "vscodeTerminal",
		})
		expect(tool.description).toContain("Commands run through cmd.exe")

		// A profile change takes effect at the next description read (the
		// model-request boundary), without a session rebuild.
		mocks.getGlobalSettingsKey.mockReturnValue("powershell-7")
		expect(tool.description).toContain("Commands run through PowerShell")
	})
})

/**
 * Minimal fake of the process object returned by VscodeTerminalManager.runCommand():
 * an EventEmitter that is also awaitable (mirroring mergePromise in
 * VscodeTerminalProcess.ts), emitting the given lines then completing.
 */
function createFakeTerminalProcess(options: { lines?: string[]; completionDetails?: TerminalCompletionDetails } = {}) {
	const emitter = new EventEmitter()
	let resolvePromise!: () => void
	// Emit on a macrotask (not a microtask) so executeForeground's
	// `await terminalManager.getOrCreateTerminal(cwd)` and subsequent
	// `process.on("line", ...)` registration are guaranteed to run first,
	// matching the ordering a real terminal process provides.
	const promise = new Promise<void>((resolve) => {
		resolvePromise = resolve
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
		detach: () => {
			emitter.emit("continue")
			resolvePromise()
		},
	})
	return fakeProcess as unknown as ReturnType<VscodeTerminalManager["runCommand"]>
}

function createFakeTerminalManager(process: ReturnType<VscodeTerminalManager["runCommand"]>): VscodeTerminalManager {
	return {
		getOrCreateTerminal: async () => ({ terminal: { show: () => {} } }) as never,
		runCommand: () => process,
	} as unknown as VscodeTerminalManager
}

/**
 * A controllable fake terminal process for detach tests: the caller decides
 * when lines are emitted and when the command completes. Mirrors the real
 * VscodeTerminalProcess contract: detach() resolves the awaited promise while
 * 'line'/'completed' events keep flowing.
 */
function createControllableTerminalProcess() {
	const emitter = new EventEmitter()
	let resolvePromise!: () => void
	const promise = new Promise<void>((resolve) => {
		resolvePromise = resolve
	})
	const fakeProcess = Object.assign(emitter, {
		then: promise.then.bind(promise),
		catch: promise.catch.bind(promise),
		finally: promise.finally.bind(promise),
		getCompletionDetails: () => ({}),
		detach: () => {
			emitter.emit("continue")
			resolvePromise()
		},
	})
	return {
		process: fakeProcess as unknown as ReturnType<VscodeTerminalManager["runCommand"]>,
		emitLine: (line: string) => emitter.emit("line", line),
		complete: (details?: TerminalCompletionDetails) => {
			emitter.emit("completed", details)
			emitter.emit("continue")
			resolvePromise()
		},
	}
}

/** Poll until the predicate holds, for asserting on async log-file writes. */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
	const start = Date.now()
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error("waitFor timed out")
		}
		await new Promise((resolve) => setTimeout(resolve, 10))
	}
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

	it("passes the caller's terminal profile through to getOrCreateTerminal", async () => {
		const process = createFakeTerminalProcess({ lines: ["ok"] })
		const getOrCreateTerminal = vi.fn(async () => ({ terminal: { show: () => {} } }) as never)
		const terminalManager = {
			getOrCreateTerminal,
			runCommand: () => process,
		} as unknown as VscodeTerminalManager

		await executeForeground("echo ok", "/workspace", terminalManager, 1000, undefined, undefined, "wsl-bash")

		expect(getOrCreateTerminal).toHaveBeenCalledWith("/workspace", "wsl-bash")
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

	it("unregisters its foreground handle when the command completes normally", async () => {
		const coordinator = new SdkForegroundCommandCoordinator()
		const terminalManager = createFakeTerminalManager(createFakeTerminalProcess({ lines: ["hello"] }))

		const result = await executeForeground("echo hello", "/workspace", terminalManager, 1000, undefined, coordinator)

		expect(result).toBe("hello")
		expect(coordinator.isRunning).toBe(false)
	})
})

describe("executeForeground — Proceed While Running", () => {
	it("detach returns the partial output with the log file path, and later output lands in the log", async () => {
		const coordinator = new SdkForegroundCommandCoordinator()
		const { process, emitLine, complete } = createControllableTerminalProcess()
		const terminalManager = createFakeTerminalManager(process)

		const resultPromise = executeForeground("devserver", "/workspace", terminalManager, 100_000, undefined, coordinator)

		await waitFor(() => coordinator.isRunning)
		emitLine("listening on :3000")

		expect(coordinator.proceedWhileRunning()).toBe(1)
		const result = await resultPromise

		expect(result).toContain("still running")
		expect(result).toContain("listening on :3000")
		const logFilePath = /redirected to this file[^:]*: (.+)$/m.exec(result)?.[1]?.trim()
		expect(logFilePath).toBeTruthy()

		// The handle is unregistered once the tool call returns.
		expect(coordinator.isRunning).toBe(false)

		// Output emitted after detach is appended to the log file, and
		// completion closes it out with a completion marker.
		emitLine("compiled successfully")
		complete({ exitCode: 0 })
		await waitFor(() => {
			try {
				return fs.readFileSync(logFilePath!, "utf8").includes("[Command completed with exit code 0]")
			} catch {
				return false
			}
		})
		const log = fs.readFileSync(logFilePath!, "utf8")
		expect(log).toContain("listening on :3000") // buffered lines flushed at detach
		expect(log).toContain("compiled successfully") // streamed after detach
		fs.rmSync(logFilePath!, { force: true })
	})

	it("detaches each parallel command into its own log file", async () => {
		const coordinator = new SdkForegroundCommandCoordinator()
		const first = createControllableTerminalProcess()
		const second = createControllableTerminalProcess()

		const firstPromise = executeForeground(
			"first-cmd",
			"/workspace",
			createFakeTerminalManager(first.process),
			100_000,
			undefined,
			coordinator,
		)
		const secondPromise = executeForeground(
			"second-cmd",
			"/workspace",
			createFakeTerminalManager(second.process),
			100_000,
			undefined,
			coordinator,
		)

		await waitFor(() => coordinator.isRunning)
		first.emitLine("first output")
		second.emitLine("second output")

		expect(coordinator.proceedWhileRunning()).toBe(2)
		const [firstResult, secondResult] = await Promise.all([firstPromise, secondPromise])

		const firstLog = /redirected to this file[^:]*: (.+)$/m.exec(firstResult)?.[1]?.trim()
		const secondLog = /redirected to this file[^:]*: (.+)$/m.exec(secondResult)?.[1]?.trim()
		expect(firstLog).toBeTruthy()
		expect(secondLog).toBeTruthy()
		expect(firstLog).not.toBe(secondLog)
		expect(coordinator.isRunning).toBe(false)

		first.complete()
		second.complete()
		await waitFor(() => {
			try {
				return (
					fs.readFileSync(firstLog!, "utf8").includes("[Command completed]") &&
					fs.readFileSync(secondLog!, "utf8").includes("[Command completed]")
				)
			} catch {
				return false
			}
		})
		expect(fs.readFileSync(firstLog!, "utf8")).toContain("first output")
		expect(fs.readFileSync(secondLog!, "utf8")).toContain("second output")
		fs.rmSync(firstLog!, { force: true })
		fs.rmSync(secondLog!, { force: true })
	})

	it("stops logging before a line that would exceed the size cap", async () => {
		const coordinator = new SdkForegroundCommandCoordinator()
		const { process, emitLine, complete } = createControllableTerminalProcess()
		const terminalManager = createFakeTerminalManager(process)

		const resultPromise = executeForeground("devserver", "/workspace", terminalManager, 100_000, undefined, coordinator)
		await waitFor(() => coordinator.isRunning)

		expect(coordinator.proceedWhileRunning()).toBe(1)
		const result = await resultPromise
		const logFilePath = /redirected to this file[^:]*: (.+)$/m.exec(result)?.[1]?.trim()
		expect(logFilePath).toBeTruthy()

		// A single line larger than the whole cap must not be written at all —
		// the cap is checked before writing, so one huge line (e.g. a dumped
		// blob) cannot blow the log far past PROCEED_LOG_MAX_BYTES.
		emitLine("small line before the blob")
		emitLine("x".repeat(PROCEED_LOG_MAX_BYTES))
		emitLine("after the cap")
		complete({ exitCode: 0 })

		await waitFor(() => {
			try {
				return fs.readFileSync(logFilePath!, "utf8").includes("[Command completed with exit code 0]")
			} catch {
				return false
			}
		})
		const log = fs.readFileSync(logFilePath!, "utf8")
		expect(log).toContain("small line before the blob")
		expect(log).toContain(`[Log size cap of ${PROCEED_LOG_MAX_BYTES} bytes reached`)
		expect(log).not.toContain("xxxx")
		expect(log).not.toContain("after the cap")
		expect(log.length).toBeLessThan(PROCEED_LOG_MAX_BYTES)
		fs.rmSync(logFilePath!, { force: true })
	})

	it("applies the size cap to lines buffered before detach", async () => {
		const coordinator = new SdkForegroundCommandCoordinator()
		const { process, emitLine, complete } = createControllableTerminalProcess()
		const terminalManager = createFakeTerminalManager(process)

		const resultPromise = executeForeground("devserver", "/workspace", terminalManager, 100_000, undefined, coordinator)
		await waitFor(() => coordinator.isRunning)
		emitLine("x".repeat(PROCEED_LOG_MAX_BYTES))

		expect(coordinator.proceedWhileRunning()).toBe(1)
		const result = await resultPromise
		const logFilePath = /redirected to this file[^:]*: (.+)$/m.exec(result)?.[1]?.trim()
		expect(logFilePath).toBeTruthy()
		complete({ exitCode: 0 })

		await waitFor(() => {
			try {
				return fs.readFileSync(logFilePath!, "utf8").includes("[Command completed with exit code 0]")
			} catch {
				return false
			}
		})
		const log = fs.readFileSync(logFilePath!, "utf8")
		expect(log).toContain(`[Log size cap of ${PROCEED_LOG_MAX_BYTES} bytes reached`)
		expect(log).not.toContain("xxxx")
		expect(Buffer.byteLength(log)).toBeLessThanOrEqual(PROCEED_LOG_MAX_BYTES)
		fs.rmSync(logFilePath!, { force: true })
	})

	it("freezes the partial output at detach while later output still reaches the log", async () => {
		const coordinator = new SdkForegroundCommandCoordinator()
		const { process, emitLine, complete } = createControllableTerminalProcess()
		const terminalManager = createFakeTerminalManager(process)

		const resultPromise = executeForeground("devserver", "/workspace", terminalManager, 100_000, undefined, coordinator)
		await waitFor(() => coordinator.isRunning)
		emitLine("before detach")

		expect(coordinator.proceedWhileRunning()).toBe(1)
		// Emitted after detach but before the tool call's result is built:
		// must appear only in the log, never in the partial output.
		emitLine("after detach")
		const result = await resultPromise

		expect(result).toContain("before detach")
		expect(result).not.toContain("after detach")

		const logFilePath = /redirected to this file[^:]*: (.+)$/m.exec(result)?.[1]?.trim()
		complete({ exitCode: 0 })
		await waitFor(() => {
			try {
				return fs.readFileSync(logFilePath!, "utf8").includes("[Command completed with exit code 0]")
			} catch {
				return false
			}
		})
		const log = fs.readFileSync(logFilePath!, "utf8")
		expect(log).toContain("before detach")
		expect(log).toContain("after detach")
		fs.rmSync(logFilePath!, { force: true })
	})
})
