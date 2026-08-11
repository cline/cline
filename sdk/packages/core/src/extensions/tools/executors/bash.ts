/**
 * Bash Executor
 *
 * Built-in implementation for running shell commands using Node.js spawn.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream, type Dirent, mkdtempSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import {
	type AgentToolContext,
	getDefaultShell,
	getShellInvocation,
} from "@cline/shared";
import { TimeoutError } from "../helpers";
import type { ShellExecutor } from "../types";
import {
	MAX_COMMAND_OUTPUT_CHARS,
	truncateCommandOutput,
} from "./output-limits";
import type { RunCommandExecutionController } from "./run-command-execution-controller";

const MAX_DETACHED_LOG_BYTES = 10 * 1024 * 1024;
const DEFAULT_DETACHED_LOG_RETENTION_MS = 24 * 60 * 60 * 1_000;
const DETACHED_LOG_DIRECTORY_PREFIX = "cline-command-";
const DETACHED_LOG_FILENAME = "output.log";

export interface DetachedCommandLogCleanupOptions {
	tempDirectory?: string;
	retentionMs?: number;
	nowMs?: number;
}

function resolveDetachedLogRetentionMs(value: number | undefined): number {
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(0, value)
		: DEFAULT_DETACHED_LOG_RETENTION_MS;
}

/**
 * Reaps detached command logs whose last write is outside the retention
 * window and schedules retained logs for their remaining lifetime. The Hub
 * calls this at startup so cleanup survives daemon exits and restarts instead
 * of depending only on timers created by the original process.
 */
export async function cleanupStaleDetachedCommandLogs(
	options: DetachedCommandLogCleanupOptions = {},
): Promise<number> {
	const tempDirectory = options.tempDirectory ?? tmpdir();
	const retentionMs = resolveDetachedLogRetentionMs(options.retentionMs);
	const nowMs = options.nowMs ?? Date.now();
	const cutoffMs = nowMs - retentionMs;
	let entries: Dirent[];
	try {
		entries = await readdir(tempDirectory, { withFileTypes: true });
	} catch {
		return 0;
	}

	let removed = 0;
	for (const entry of entries) {
		if (
			!entry.isDirectory() ||
			!entry.name.startsWith(DETACHED_LOG_DIRECTORY_PREFIX)
		) {
			continue;
		}
		const directory = join(tempDirectory, entry.name);
		try {
			let modifiedAtMs: number;
			try {
				modifiedAtMs = (await stat(join(directory, DETACHED_LOG_FILENAME)))
					.mtimeMs;
			} catch {
				modifiedAtMs = (await stat(directory)).mtimeMs;
			}
			if (modifiedAtMs > cutoffMs) {
				scheduleDetachedLogCleanup(
					directory,
					Math.max(0, modifiedAtMs + retentionMs - nowMs),
				);
				continue;
			}
			await rm(directory, { recursive: true, force: true });
			removed += 1;
		} catch {
			// Cleanup is best effort: one inaccessible or concurrently removed log
			// must not prevent the Hub from starting or other logs from being reaped.
		}
	}
	return removed;
}

export class CommandExitError extends Error {
	constructor(
		readonly exitCode: number,
		readonly output: string,
	) {
		super(`Command exited with code ${exitCode}`);
		this.name = "CommandExitError";
	}
}

/**
 * Options for the shell executor
 */
export interface ShellExecutorOptions {
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
	 * Maximum output kept, in characters. Output beyond this is
	 * middle-truncated: the head and tail are preserved and the middle is
	 * elided, since build and test failures usually live at the end of the
	 * output.
	 * @default 48_000 — see MAX_COMMAND_OUTPUT_CHARS in output-limits.ts
	 */
	maxOutputChars?: number;

	/**
	 * @deprecated Misnamed — the limit was always enforced in characters,
	 * not bytes. Use {@link maxOutputChars}; this alias is honored when
	 * maxOutputChars is not set.
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

	/**
	 * Optional host-scoped controller that can release an in-flight command
	 * from its tool call while continuing to drain output to a bounded log.
	 */
	executionController?: RunCommandExecutionController;

	/**
	 * How long a completed detached command log remains available before its
	 * temporary directory is removed.
	 *
	 * @default 24 hours
	 */
	detachedLogRetentionMs?: number;
}

interface SpawnConfig {
	executable: string;
	args: string[];
	cwd: string;
	env: Record<string, string>;
	input?: string;
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

	const appendText = (text: string): void => {
		if (!text) return;
		totalChars += text.length;
		const headRoom = headLimit - head.length;
		if (headRoom > 0) {
			head += text.slice(0, headRoom);
			tail = (tail + text.slice(headRoom)).slice(-tailLimit);
			return;
		}
		tail = (tail + text).slice(-tailLimit);
	};

	return {
		append(data: Buffer): string {
			const text = decoder.write(data);
			appendText(text);
			return text;
		},
		current() {
			return {
				text: head + tail,
				totalChars,
				dropped: totalChars > head.length + tail.length,
			};
		},
		snapshot() {
			// Flush bytes the decoder buffered for an incomplete multibyte
			// sequence at end-of-stream; otherwise the final characters of
			// non-ASCII output are silently dropped.
			const finalChunk = decoder.end();
			appendText(finalChunk);
			return {
				text: head + tail,
				totalChars,
				dropped: totalChars > head.length + tail.length,
				finalChunk,
			};
		},
	};
}

function scheduleDetachedLogCleanup(
	directory: string,
	retentionMs: number,
): void {
	const cleanupTimer = setTimeout(() => {
		void rm(directory, { recursive: true, force: true }).catch(() => undefined);
	}, retentionMs);
	cleanupTimer.unref();
}

function createDetachedLog(retentionMs: number) {
	const directory = mkdtempSync(join(tmpdir(), DETACHED_LOG_DIRECTORY_PREFIX));
	const path = join(directory, DETACHED_LOG_FILENAME);
	const stream = createWriteStream(path, { encoding: "utf8" });
	let bytesWritten = 0;
	let capped = false;
	let closed = false;
	stream.on("error", () => {
		// The detached command has already released its caller. A late log write
		// failure must not become an unhandled stream error in the hub process.
		closed = true;
	});
	stream.once("close", () => {
		scheduleDetachedLogCleanup(directory, retentionMs);
	});

	return {
		path,
		write(text: string): void {
			if (!text || capped || closed) return;
			const remaining = MAX_DETACHED_LOG_BYTES - bytesWritten;
			if (remaining <= 0) {
				capped = true;
				closed = true;
				stream.end();
				return;
			}
			const data = Buffer.from(text, "utf8");
			const accepted =
				data.length <= remaining ? data : data.subarray(0, remaining);
			stream.write(accepted);
			bytesWritten += accepted.length;
			if (
				accepted.length < data.length ||
				bytesWritten >= MAX_DETACHED_LOG_BYTES
			) {
				capped = true;
				closed = true;
				stream.end();
			}
		},
		close(): void {
			if (closed) return;
			closed = true;
			stream.end();
		},
	};
}

function spawnAndCollect(
	config: SpawnConfig,
	context: AgentToolContext,
	timeoutMs: number,
	maxOutputChars: number,
	combineOutput: boolean,
	detachedLogRetentionMs: number,
	executionController?: RunCommandExecutionController,
): Promise<string> {
	if (context.signal?.aborted) {
		return Promise.reject(new Error("Command was aborted"));
	}
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

		const stdout = createRollingCollector(maxOutputChars);
		const stderr = createRollingCollector(maxOutputChars);
		const executionId = randomUUID();
		const detachable = Boolean(executionController && context.sessionId);
		let killed = false;
		let settled = false;
		let detached = false;
		let detachedLog: ReturnType<typeof createDetachedLog> | undefined;
		let unregisterExecution = () => {};

		const settle = (fn: () => void) => {
			if (settled) return;
			settled = true;
			fn();
		};

		const killProcessTree = async (): Promise<void> => {
			if (!childPid) return;
			if (isWindows) {
				await new Promise<void>((done) => {
					let finished = false;
					let killer: ReturnType<typeof spawn>;
					const finish = () => {
						if (finished) return;
						finished = true;
						clearTimeout(watchdog);
						done();
					};
					try {
						killer = spawn(
							"taskkill.exe",
							["/PID", String(childPid), "/T", "/F"],
							{ stdio: "ignore", shell: false, windowsHide: true },
						);
					} catch {
						child.kill();
						done();
						return;
					}
					const watchdog = setTimeout(() => {
						killer.kill();
						child.kill();
						finish();
					}, 5_000);
					killer.once("error", () => {
						child.kill();
						finish();
					});
					killer.once("close", (code) => {
						if (code !== 0) child.kill();
						finish();
					});
				});
				return;
			}
			try {
				process.kill(-childPid, "SIGKILL");
			} catch {
				child.kill("SIGKILL");
			}
		};

		let timeout: NodeJS.Timeout;
		const abortHandler = () => killAndReject(new Error("Command was aborted"));
		const cleanup = () => {
			clearTimeout(timeout);
			context.signal?.removeEventListener("abort", abortHandler);
			unregisterExecution();
		};
		const killAndReject = (error: Error) => {
			if (killed || settled) return;
			killed = true;
			cleanup();
			void killProcessTree().finally(() => settle(() => reject(error)));
		};

		timeout = setTimeout(
			() =>
				killAndReject(
					new TimeoutError(`Command timed out after ${timeoutMs}ms`, timeoutMs),
				),
			timeoutMs,
		);

		if (context.signal) {
			context.signal.addEventListener("abort", abortHandler, { once: true });
			if (context.signal.aborted) abortHandler();
		}

		const detach = (): boolean => {
			if (!detachable || killed || settled) return false;
			const log = createDetachedLog(detachedLogRetentionMs);
			detached = true;
			detachedLog = log;
			const currentOut = stdout.current();
			const currentErr = stderr.current();
			detachedLog.write(currentOut.text);
			if (currentErr.text) {
				detachedLog.write(`\n[stderr]\n${currentErr.text}`);
			}
			cleanup();
			child.unref();
			(
				child.stdout as (typeof child.stdout & { unref?: () => void }) | null
			)?.unref?.();
			(
				child.stderr as (typeof child.stderr & { unref?: () => void }) | null
			)?.unref?.();
			const notice = [
				`[Command is still running. Output will continue in ${detachedLog.path}]`,
				combineOutput
					? currentOut.text +
						(currentErr.text ? `\n[stderr]\n${currentErr.text}` : "")
					: currentOut.text,
			]
				.filter(Boolean)
				.join("\n");
			settle(() => resolve(notice));
			return true;
		};

		child.once("spawn", () => {
			if (killed) return;
			if (detachable && context.sessionId && executionController) {
				unregisterExecution = executionController.register({
					executionId,
					sessionId: context.sessionId,
					toolCallId: context.toolCallId,
					detach,
				});
			}
			context.emitUpdate?.({
				stream: "stdout",
				chunk: "",
				executionId,
				detachable,
			});
		});

		child.stdout?.on("data", (data: Buffer) => {
			const chunk = stdout.append(data);
			if (!chunk) return;
			if (detached) {
				detachedLog?.write(chunk);
				return;
			}
			context.emitUpdate?.({
				stream: "stdout",
				chunk,
				executionId,
				detachable,
			});
		});

		child.stderr?.on("data", (data: Buffer) => {
			const chunk = stderr.append(data);
			if (!chunk) return;
			if (detached) {
				detachedLog?.write(chunk);
				return;
			}
			context.emitUpdate?.({
				stream: "stderr",
				chunk,
				executionId,
				detachable,
			});
		});

		child.on("close", (code) => {
			if (killed) return;

			const out = stdout.snapshot();
			const err = stderr.snapshot();
			if (detached) {
				detachedLog?.write(out.finalChunk);
				detachedLog?.write(err.finalChunk);
				detachedLog?.write(`\n[Command exited with code ${code ?? 1}]\n`);
				detachedLog?.close();
				return;
			}
			cleanup();
			if (out.finalChunk) {
				context.emitUpdate?.({
					stream: "stdout",
					chunk: out.finalChunk,
					executionId,
					detachable,
				});
			}
			if (err.finalChunk) {
				context.emitUpdate?.({
					stream: "stderr",
					chunk: err.finalChunk,
					executionId,
					detachable,
				});
			}

			if (code !== 0) {
				const exitCode = code ?? 1;
				let failureOutput = combineOutput
					? out.text + (err.text ? `\n[stderr]\n${err.text}` : "")
					: out.text;
				const dropped = out.dropped || (combineOutput && err.dropped);
				const totalChars = combineOutput
					? out.totalChars + err.totalChars
					: out.totalChars;
				if (dropped || failureOutput.length > maxOutputChars) {
					failureOutput = truncateCommandOutput(failureOutput, {
						maxChars: maxOutputChars,
						totalChars,
					});
				}
				const result =
					failureOutput.length > 0
						? `[Command exited with code ${exitCode}]\n${failureOutput}`
						: `[Command exited with code ${exitCode}]`;
				settle(() => reject(new CommandExitError(exitCode, result)));
			} else {
				let output = combineOutput
					? out.text + (err.text ? `\n[stderr]\n${err.text}` : "")
					: out.text;
				const dropped = out.dropped || (combineOutput && err.dropped);
				if (dropped || output.length > maxOutputChars) {
					const totalChars = combineOutput
						? out.totalChars + err.totalChars
						: out.totalChars;
					output = truncateCommandOutput(output, {
						maxChars: maxOutputChars,
						totalChars,
					});
				}
				settle(() => resolve(output));
			}
		});

		child.on("error", (error) => {
			if (killed) return;
			if (detached) {
				detachedLog?.write(`\n[Command failed: ${error.message}]\n`);
				detachedLog?.close();
				return;
			}
			cleanup();
			settle(() =>
				reject(new Error(`Failed to execute command: ${error.message}`)),
			);
		});

		child.stdin?.on("error", (error) => {
			if (killed || settled) return;
			killAndReject(
				new Error(`Failed to write command input: ${error.message}`),
			);
		});
		child.stdin?.end(config.input, "utf8");
	});
}

/**
 * Create a shell executor using Node.js spawn
 *
 * @example
 * ```typescript
 * const shell = createShellExecutor({
 *   timeoutMs: 60000, // 1 minute timeout
 *   shell: "/bin/zsh",
 * })
 *
 * const output = await shell("ls -la", "/path/to/project", context)
 * ```
 */
export function createShellExecutor(
	options: ShellExecutorOptions = {},
): ShellExecutor {
	const {
		shell = getDefaultShell(process.platform),
		timeoutMs = 30000,
		env = {},
		combineOutput = true,
		executionController,
	} = options;
	const detachedLogRetentionMs = resolveDetachedLogRetentionMs(
		options.detachedLogRetentionMs,
	);
	const maxOutputChars =
		options.maxOutputChars ??
		options.maxOutputBytes ??
		MAX_COMMAND_OUTPUT_CHARS;

	return (command, cwd, context) => {
		const isStructured = typeof command !== "string";
		const invocation = isStructured
			? { args: command.args ?? [] }
			: getShellInvocation(shell, command);
		return spawnAndCollect(
			{
				executable: isStructured ? command.command : shell,
				args: invocation.args,
				cwd,
				env,
				input: invocation.input,
			},
			context,
			timeoutMs,
			maxOutputChars,
			combineOutput,
			detachedLogRetentionMs,
			executionController,
		);
	};
}
