/**
 * Bash Executor
 *
 * Built-in implementation for running shell commands using Node.js spawn.
 */

import { spawn } from "node:child_process";
import {
	getDefaultShell,
	getShellArgs,
	type ToolContext,
} from "@clinebot/shared";
import type { BashExecutor } from "../types.js";

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
	 * Maximum output size in bytes
	 * @default 1_000_000 (1MB)
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

function spawnAndCollect(
	config: SpawnConfig,
	context: ToolContext,
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
		});
		const childPid = child.pid;

		let stdout = "";
		let stderr = "";
		let outputSize = 0;
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
					{ stdio: "ignore", windowsHide: true },
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
			() => killAndReject(new Error(`Command timed out after ${timeoutMs}ms`)),
			timeoutMs,
		);

		const abortHandler = () => killAndReject(new Error("Command was aborted"));

		if (context.abortSignal) {
			context.abortSignal.addEventListener("abort", abortHandler);
		}

		const cleanup = () => {
			clearTimeout(timeout);
			context.abortSignal?.removeEventListener("abort", abortHandler);
		};

		child.stdout?.on("data", (data: Buffer) => {
			outputSize += data.length;
			if (outputSize <= maxOutputBytes) stdout += data.toString();
		});

		child.stderr?.on("data", (data: Buffer) => {
			outputSize += data.length;
			if (outputSize <= maxOutputBytes) stderr += data.toString();
		});

		child.on("close", (code) => {
			cleanup();
			if (killed) return;

			let output = combineOutput
				? stdout + (stderr ? `\n[stderr]\n${stderr}` : "")
				: stdout;

			if (outputSize > maxOutputBytes) {
				output += `\n\n[Output truncated: ${outputSize} bytes total, showing first ${maxOutputBytes} bytes]`;
			}

			if (code !== 0) {
				settle(() =>
					reject(new Error(stderr || `Command exited with code ${code}`)),
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
		maxOutputBytes = 1_000_000,
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
