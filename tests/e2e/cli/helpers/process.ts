// ---------------------------------------------------------------------------
// Process-level helpers for headless / contract-style CLI tests.
//
// These helpers spawn cline as a child process and return stdout, stderr,
// and exit code — without going through the TUI harness. Use these for:
//   - Exit code assertions
//   - Pure stdout/stderr contract tests
//   - Piped stdin tests (echo "..." | cline -y ...)
//   - JSON output validation
//   - Timeout behavior
// ---------------------------------------------------------------------------

import { SpawnSyncOptions, spawnSync } from "child_process"
import { CLINE_BIN } from "./constants.js"
import { clineEnv } from "./env.js"

export interface RunResult {
	stdout: string
	stderr: string
	exitCode: number | null
	combined: string
}

export interface RunOptions {
	/** Named config dir under `configs/`, or absolute path */
	config?: string
	/** Additional env vars */
	env?: NodeJS.ProcessEnv
	/** Stdin to pipe into the process */
	stdin?: string
	/** Timeout in ms (default: 30_000) */
	timeout?: number
	/** Working directory for the spawned process */
	cwd?: string
}

/**
 * Run `cline [args]` synchronously and return stdout/stderr/exitCode.
 *
 * Suitable for deterministic, fast-exiting commands like:
 *   cline --help, cline --version, cline auth -p ... -k ..., etc.
 */
export function runCline(args: string[], opts: RunOptions = {}): RunResult {
	const { config = "default", env: extraEnv = {}, stdin, timeout = 30_000, cwd = process.cwd() } = opts

	const spawnOpts: SpawnSyncOptions = {
		encoding: "utf8",
		timeout,
		cwd,
		env: { ...clineEnv(config), ...extraEnv },
		input: stdin,
	}

	const result = spawnSync(CLINE_BIN, args, spawnOpts)

	const stdout = (result.stdout as string) ?? ""
	const stderr = (result.stderr as string) ?? ""

	return {
		stdout,
		stderr,
		exitCode: result.status,
		combined: stdout + stderr,
	}
}

/**
 * Assert that a runCline result exited with the expected code.
 * Throws a descriptive error if the code doesn't match.
 */
export function assertExitCode(result: RunResult, expected: number, label = ""): void {
	if (result.exitCode !== expected) {
		const prefix = label ? `[${label}] ` : ""
		throw new Error(
			`${prefix}Expected exit code ${expected}, got ${result.exitCode}.\n` +
				`stdout: ${result.stdout}\n` +
				`stderr: ${result.stderr}`,
		)
	}
}

/**
 * Assert that stdout/stderr contains a given string or matches a regex.
 */
export function assertOutput(
	result: RunResult,
	pattern: string | RegExp,
	stream: "stdout" | "stderr" | "combined" = "combined",
	label = "",
): void {
	const text = result[stream]
	const matches = typeof pattern === "string" ? text.includes(pattern) : pattern.test(text)

	if (!matches) {
		const prefix = label ? `[${label}] ` : ""
		throw new Error(
			`${prefix}Expected ${stream} to match ${pattern}.\n` + `stdout: ${result.stdout}\n` + `stderr: ${result.stderr}`,
		)
	}
}
