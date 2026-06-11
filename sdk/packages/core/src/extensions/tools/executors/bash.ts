/**
 * Bash Executor
 *
 * Built-in implementation for running shell commands using Node.js spawn.
 */

import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import {
	type AgentToolContext,
	getDefaultShell,
	getShellArgs,
} from "@cline/shared";
import { TimeoutError } from "../helpers";
import type { BashExecutor } from "../types";
import { MAX_COMMAND_OUTPUT_CHARS } from "./output-limits";

/**
 * Options for the bash executor
 */
export interface BashExecutorOptions {
	/**
	 * Shell to use for execution
	 * @default "/bin/bash" on Unix, "powershell" on Windows
	 */
	shell?: string;

	/**
	 * Timeout for command execution in milliseconds
	 * @default 30000 (30 seconds)
	 */
	timeoutMs?: number;

	/**
	 * Maximum output size, measured in characters (approximately bytes for
	 * ASCII-dominant output). Output beyond this is middle-truncated: the
	 * head and tail are preserved and the middle is elided, since build and
	 * test failures usually live at the end of the output.
	 * @default 51_200 (~50KB)
	 */
	maxOutputBytes?: number;

	/**
	 * Environment variables to add/override
	 */
	env?: Record<string, string>;

	/**
	 * Whether to combine stdout and stderr
	 * @default true
	 */
	combineOutput?: boolean;
}

interface SpawnConfig {
	executable: string;
	args: string[];
	cwd: string;
	env: Record<string, string>;
}

/**
 * Collects stream output with bounded memory: the first half of the budget
 * is kept verbatim, the rest rolls so the latest output always survives.
 */
function createRollingCollector(maxChars: number) {
	const headLimit = Math.ceil(maxChars / 2);
	const tailLimit = Math.max(1, maxChars - headLimit);
	// StringDecoder keeps multibyte UTF-8 sequences split across stream
	// chunks intact instead of corrupting them at chunk boundaries.
	const decoder = new StringDecoder("utf8");
	let head = "";
	let tail = "";
	let totalChars = 0;

	return {
		append(data: Buffer): void {
			const text = decoder.write(data);
			totalChars += text.length;
			const headRoom = headLimit - head.length;
			if (headRoom > 0) {
				head += text.slice(0, headRoom);
				tail = (tail + text.slice(headRoom)).slice(-tailLimit);
				return;
			}
			tail = (tail + text).slice(-tailLimit);
		},
		snapshot() {
			return {
				text: head + tail,
				totalChars,
				dropped: totalChars > head.length + tail.length,
			};
		},
	};
}

function truncateMiddle(
	text: string,
	maxChars: number,
	totalChars: number,
): string {
	const headLimit = Math.ceil(maxChars / 2);
	const tailLimit = Math.max(1, maxChars - headLimit);
	return (
		`${text.slice(0, headLimit)}\n` +
		`[... output truncated: ${totalChars} chars total. ` +
		"Refine the command (grep, head, tail) to view the elided middle ...]\n" +
		text.slice(-tailLimit)
	);
}

function spawnAndCollect(
	config: SpawnConfig,
	context: AgentToolContext,
	timeoutMs: number,
	maxOutputBytes: number,
	combineOutput: boolean,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const isWindows = process.platform === "win32";

		const child = spawn(config.executable, config.args, {
			cwd: config.cwd,
			env: { ...process.env, ...config.env },
			stdio: ["pipe", "pipe", "pipe"],
			detached: !isWindows,
			// Prevent a console window from flashing on Windows when the
			// parent process has no console (or a different console).
			// No-op on non-Windows platforms.
			windowsHide: true,
		});
		const childPid = child.pid;

		const stdout = createRollingCollector(maxOutputBytes);
		const stderr = createRollingCollector(maxOutputBytes);
		let killed = false;
		let settled = false;

		const settle = (fn: () => void) => {
			if (settled) return;
			settled = true;
			fn();
		};

		const killProcessTree = () => {
			if (!childPid) return;
			if (isWindows) {
				const killer = spawn(
					"taskkill",
					["/pid", String(childPid), "/T", "/F"],
					{ stdio: "ignore", shell: true, windowsHide: true },
				);
				killer.unref();
				return;
			}
			try {
				process.kill(-childPid, "SIGKILL");
			} catch {
				child.kill("SIGKILL");
			}
		};

		const killAndReject = (error: Error) => {
			killed = true;
			killProcessTree();
			settle(() => reject(error));
		};

		const timeout = setTimeout(
			() =>
				killAndReject(
					new TimeoutError(`Command timed out after ${timeoutMs}ms`, timeoutMs),
				),
			timeoutMs,
		);

		const abortHandler = () => killAndReject(new Error("Command was aborted"));

		if (context.signal) {
			context.signal.addEventListener("abort", abortHandler);
		}

		const cleanup = () => {
			clearTimeout(timeout);
			context.signal?.removeEventListener("abort", abortHandler);
		};

		child.stdout?.on("data", (data: Buffer) => {
			stdout.append(data);
		});

		child.stderr?.on("data", (data: Buffer) => {
			stderr.append(data);
		});

		child.on("close", (code) => {
			cleanup();
			if (killed) return;

			const out = stdout.snapshot();
			const err = stderr.snapshot();
			let output = combineOutput
				? out.text + (err.text ? `\n[stderr]\n${err.text}` : "")
				: out.text;
			const dropped = out.dropped || (combineOutput && err.dropped);
			if (dropped || output.length > maxOutputBytes) {
				const totalChars = combineOutput
					? out.totalChars + err.totalChars
					: out.totalChars;
				output = truncateMiddle(output, maxOutputBytes, totalChars);
			}

			if (code !== 0) {
				const stderrText = err.dropped
					? truncateMiddle(err.text, maxOutputBytes, err.totalChars)
					: err.text;
				settle(() =>
					reject(new Error(stderrText || `Command exited with code ${code}`)),
				);
			} else {
				settle(() => resolve(output));
			}
		});

		child.on("error", (error) => {
			cleanup();
			settle(() =>
				reject(new Error(`Failed to execute command: ${error.message}`)),
			);
		});
	});
}

/**
 * Create a bash executor using Node.js spawn
 *
 * @example
 * ```typescript
 * const bash = createBashExecutor({
 *   timeoutMs: 60000, // 1 minute timeout
 *   shell: "/bin/zsh",
 * })
 *
 * const output = await bash("ls -la", "/path/to/project", context)
 * ```
 */
export function createBashExecutor(
	options: BashExecutorOptions = {},
): BashExecutor {
	const {
		shell = getDefaultShell(process.platform),
		timeoutMs = 30000,
		maxOutputBytes = MAX_COMMAND_OUTPUT_CHARS,
		env = {},
		combineOutput = true,
	} = options;

	return (command, cwd, context) => {
		const isStructured = typeof command !== "string";
		return spawnAndCollect(
			{
				executable: isStructured ? command.command : shell,
				args: isStructured
					? (command.args ?? [])
					: getShellArgs(shell, command),
				cwd,
				env,
			},
			context,
			timeoutMs,
			maxOutputBytes,
			combineOutput,
		);
	};
}
