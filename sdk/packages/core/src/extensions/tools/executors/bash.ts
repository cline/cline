/**
 * Bash Executor
 *
 * Built-in implementation for running shell commands using Node.js spawn.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	createWriteStream,
	type Dirent,
	mkdtempSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { appendFile, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import {
	type AgentToolContext,
	getDefaultShell,
	getShellInvocation,
} from "@cline/shared";
import {
	type ProcessStartTokenProbeResult,
	probeProcessStartTokenAsync,
} from "../../../runtime/process-start-token";
import { TimeoutError } from "../helpers";
import type { ShellExecutionLimits, ShellExecutor } from "../types";
import {
	MAX_COMMAND_OUTPUT_CHARS,
	truncateCommandOutput,
} from "./output-limits";
import type {
	RunCommandDetachKind,
	RunCommandExecutionController,
} from "./run-command-execution-controller";

const MAX_DETACHED_LOG_BYTES = 10 * 1024 * 1024;
const DEFAULT_DETACHED_LOG_RETENTION_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_ACTIVE_COMMAND_POLL_INTERVAL_MS = 60_000;
const DETACHED_LOG_DIRECTORY_PREFIX = "cline-command-";
const DETACHED_LOG_FILENAME = "output.log";
const DETACHED_LOG_ACTIVE_COMMAND_FILENAME = "active-command.json";
const DETACHED_LOG_COMPLETED_FILENAME = "completed-at";
const COMMAND_PROGRESS_FLUSH_INTERVAL_MS = 48;

type CommandProgressStream = "stdout" | "stderr";

export type ProcessStartTokenProbe = (
	pid: number,
) => ProcessStartTokenProbeResult | Promise<ProcessStartTokenProbeResult>;

export interface DetachedCommandLogCleanupOptions {
	tempDirectory?: string;
	retentionMs?: number;
	nowMs?: number;
	processStartTokenProbe?: ProcessStartTokenProbe;
	activeCommandPollIntervalMs?: number;
	killProcessTree?: (pid: number) => void | Promise<void>;
}

type DetachedCommandMarker = {
	version: 1;
	executionId: string;
	pid: number;
	processStartToken: string;
	detachedAtMs: number;
	hardKillAtMs?: number;
};

function resolveDetachedLogRetentionMs(value: number | undefined): number {
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(0, value)
		: DEFAULT_DETACHED_LOG_RETENTION_MS;
}

function resolveActiveCommandPollIntervalMs(value: number | undefined): number {
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(1, value)
		: DEFAULT_ACTIVE_COMMAND_POLL_INTERVAL_MS;
}

type ResolvedDetachedCommandLogCleanupOptions = {
	retentionMs: number;
	nowMs: number;
	probeProcessStartToken: ProcessStartTokenProbe;
	activeCommandPollIntervalMs: number;
	killProcessTree: (pid: number) => Promise<void>;
};

function parseDetachedCommandMarker(
	text: string,
): DetachedCommandMarker | undefined {
	try {
		const marker = JSON.parse(text) as Partial<DetachedCommandMarker>;
		if (
			marker.version !== 1 ||
			typeof marker.executionId !== "string" ||
			marker.executionId.length === 0 ||
			!Number.isSafeInteger(marker.pid) ||
			(marker.pid ?? 0) <= 0 ||
			typeof marker.processStartToken !== "string" ||
			marker.processStartToken.length === 0 ||
			typeof marker.detachedAtMs !== "number" ||
			!Number.isFinite(marker.detachedAtMs) ||
			marker.detachedAtMs < 0
		) {
			return undefined;
		}
		if (
			marker.hardKillAtMs !== undefined &&
			(!Number.isFinite(marker.hardKillAtMs) || marker.hardKillAtMs < 0)
		) {
			return undefined;
		}
		return marker as DetachedCommandMarker;
	} catch {
		return undefined;
	}
}

function writeLifecycleMarker(path: string, text: string): void {
	const temporaryPath = `${path}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporaryPath, text, "utf8");
		try {
			renameSync(temporaryPath, path);
		} catch (error) {
			// Windows does not replace an existing destination atomically. Existing
			// lifecycle markers are only replaced when corrupt, so remove that
			// unusable generation before installing the valid one.
			if (
				error instanceof Error &&
				"code" in error &&
				["EEXIST", "EPERM"].includes(
					String((error as NodeJS.ErrnoException).code),
				)
			) {
				rmSync(path, { force: true });
				renameSync(temporaryPath, path);
			} else {
				throw error;
			}
		}
	} finally {
		rmSync(temporaryPath, { force: true });
	}
}

function parseCompletedAtMs(
	text: string | undefined,
	nowMs: number,
): number | undefined {
	const normalized = text?.trim();
	if (!normalized) return undefined;
	const value = Number(normalized);
	if (!Number.isFinite(value) || value < 0) return undefined;
	// Clock rollback or corrupt future timestamps must not retain a log beyond
	// one full inspection window from this reconciliation.
	return Math.min(value, nowMs);
}

async function readOptionalTextFile(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (
			error instanceof Error &&
			"code" in error &&
			(error as NodeJS.ErrnoException).code === "ENOENT"
		) {
			return undefined;
		}
		throw error;
	}
}

async function reconcileDetachedCommandLogDirectory(
	directory: string,
	options: ResolvedDetachedCommandLogCleanupOptions,
): Promise<boolean> {
	const activeCommandPath = join(
		directory,
		DETACHED_LOG_ACTIVE_COMMAND_FILENAME,
	);
	const completedAtPath = join(directory, DETACHED_LOG_COMPLETED_FILENAME);
	const completedAtText = await readOptionalTextFile(completedAtPath);
	let retentionStartedAtMs = parseCompletedAtMs(completedAtText, options.nowMs);
	const activeCommandText = await readOptionalTextFile(activeCommandPath);
	if (retentionStartedAtMs !== undefined) {
		// Completion is written before the active marker is removed. Treat it as
		// authoritative after a host crash between those two operations.
		if (activeCommandText !== undefined) {
			await rm(activeCommandPath, { force: true });
		}
	} else if (activeCommandText !== undefined) {
		const marker = parseDetachedCommandMarker(activeCommandText);
		if (marker) {
			let probe: ProcessStartTokenProbeResult;
			try {
				probe = await options.probeProcessStartToken(marker.pid);
			} catch {
				// Custom identity providers can fail by rejecting instead of returning
				// an explicit unavailable result. Preserve the same conservative
				// lifecycle semantics and keep polling in either case.
				probe = { status: "unavailable" };
			}
			if (
				probe.status === "found" &&
				probe.token === marker.processStartToken
			) {
				if (
					marker.hardKillAtMs !== undefined &&
					options.nowMs >= marker.hardKillAtMs
				) {
					await appendFile(
						join(directory, DETACHED_LOG_FILENAME),
						"\n[Command reached its hard deadline]\n",
						"utf8",
					).catch(() => undefined);
					await options.killProcessTree(marker.pid).catch(() => undefined);
				}
				// The detached command, rather than the host that launched it, owns the
				// active lifecycle. Matching both PID and kernel start token prevents a
				// later process that reuses the PID from extending this log's lifetime.
				scheduleActiveCommandLogReconciliation(directory, options);
				return false;
			}
			if (probe.status === "unavailable") {
				// An unavailable identity provider is not evidence that the command
				// exited. Keep the advertised log and retry until the provider can
				// prove either the same identity, a replacement process, or absence.
				scheduleActiveCommandLogReconciliation(directory, options);
				return false;
			}
		}
		// A missing process, mismatched identity, or malformed marker begins
		// bounded retention. Never fall back to PID-only polling.
		writeLifecycleMarker(completedAtPath, String(options.nowMs));
		await rm(activeCommandPath, { force: true });
		retentionStartedAtMs = options.nowMs;
	}

	if (retentionStartedAtMs === undefined) {
		// Logs without lifecycle markers use their last write as a best-effort
		// fallback so malformed or interrupted state cannot accumulate forever.
		try {
			retentionStartedAtMs = (
				await stat(join(directory, DETACHED_LOG_FILENAME))
			).mtimeMs;
		} catch {
			retentionStartedAtMs = (await stat(directory)).mtimeMs;
		}
	}
	const cutoffMs = options.nowMs - options.retentionMs;
	if (retentionStartedAtMs > cutoffMs) {
		scheduleDetachedLogCleanup(
			directory,
			Math.max(0, retentionStartedAtMs + options.retentionMs - options.nowMs),
		);
		return false;
	}
	await rm(directory, { recursive: true, force: true });
	return true;
}

function scheduleActiveCommandLogReconciliation(
	directory: string,
	options: ResolvedDetachedCommandLogCleanupOptions,
	delayMs = options.activeCommandPollIntervalMs,
): void {
	const timer = setTimeout(() => {
		void reconcileDetachedCommandLogDirectory(directory, {
			...options,
			nowMs: Date.now(),
		}).catch(() => undefined);
	}, delayMs);
	timer.unref();
}

/**
 * Reaps completed detached command logs outside the retention window,
 * schedules retained logs for their remaining lifetime, and follows active
 * command identities until they exit. Local runtime hosts call this at startup
 * so cleanup survives host exits and restarts instead of depending only on the
 * process that launched the command.
 */
export async function cleanupStaleDetachedCommandLogs(
	options: DetachedCommandLogCleanupOptions = {},
): Promise<number> {
	const tempDirectory = options.tempDirectory ?? tmpdir();
	const retentionMs = resolveDetachedLogRetentionMs(options.retentionMs);
	const nowMs = options.nowMs ?? Date.now();
	const probeProcessStartToken =
		options.processStartTokenProbe ?? probeProcessStartTokenAsync;
	const activeCommandPollIntervalMs = resolveActiveCommandPollIntervalMs(
		options.activeCommandPollIntervalMs,
	);
	const killProcessTree = async (pid: number): Promise<void> => {
		if (options.killProcessTree) {
			await options.killProcessTree(pid);
			return;
		}
		if (process.platform === "win32") {
			await new Promise<void>((resolve) => {
				const killer = spawn(
					"taskkill.exe",
					["/PID", String(pid), "/T", "/F"],
					{
						stdio: "ignore",
						shell: false,
						windowsHide: true,
					},
				);
				killer.once("error", () => resolve());
				killer.once("close", () => resolve());
			});
			return;
		}
		try {
			process.kill(-pid, "SIGKILL");
		} catch {
			process.kill(pid, "SIGKILL");
		}
	};
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
			if (
				await reconcileDetachedCommandLogDirectory(directory, {
					retentionMs,
					nowMs,
					probeProcessStartToken,
					activeCommandPollIntervalMs,
					killProcessTree,
				})
			) {
				removed += 1;
			}
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
	 * Automatically release the tool call after this duration. Per-invocation
	 * limits override this value. Infinity disables the timer.
	 * @default Infinity
	 */
	detachAfterMs?: number;

	/**
	 * Forcefully terminate the process tree after this duration. Per-invocation
	 * limits override this value, then legacy `timeoutMs` is used as fallback.
	 * Infinity disables the timer.
	 * @default 30000
	 */
	killAfterMs?: number;

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

	/** Process identity provider used to enable safe command detachment. */
	processStartTokenProbe?: ProcessStartTokenProbe;
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

/**
 * Coalesces high-volume process output before it enters the runtime event
 * pipeline. Each stream keeps only a bounded pending tail and produces at
 * most one update per flush interval, preventing a noisy child process from
 * creating an unbounded queue of Hub and websocket events.
 */
function createCommandProgressEmitter(
	context: AgentToolContext,
	executionId: string,
	isDetachable: () => boolean,
	maxOutputChars: number,
) {
	const emitUpdate = context.emitUpdate;
	const maxPendingChars =
		typeof maxOutputChars === "number" && Number.isFinite(maxOutputChars)
			? Math.max(
					1,
					Math.floor(Math.min(MAX_COMMAND_OUTPUT_CHARS, maxOutputChars)),
				)
			: MAX_COMMAND_OUTPUT_CHARS;
	let pending: Partial<
		Record<CommandProgressStream, { chunk: string; droppedChars: number }>
	> = {};
	let streamOrder: CommandProgressStream[] = [];
	let flushTimer: NodeJS.Timeout | undefined;
	let stopped = false;

	const clearFlushTimer = () => {
		if (!flushTimer) return;
		clearTimeout(flushTimer);
		flushTimer = undefined;
	};

	const flush = () => {
		clearFlushTimer();
		if (!emitUpdate) {
			pending = {};
			streamOrder = [];
			return;
		}
		const buffered = pending;
		const order = streamOrder;
		pending = {};
		streamOrder = [];
		for (const stream of order) {
			const entry = buffered[stream];
			if (!entry?.chunk) continue;
			const marker =
				entry.droppedChars > 0
					? `\u001b[0m[${entry.droppedChars} command-output characters skipped while streaming]\n`
					: "";
			const markerFits = marker.length < maxPendingChars;
			const chunk = markerFits
				? marker + entry.chunk.slice(-(maxPendingChars - marker.length))
				: entry.chunk.slice(-maxPendingChars);
			emitUpdate({
				stream,
				chunk,
				executionId,
				detachable: isDetachable(),
				...(entry.droppedChars > 0
					? { truncated: true, droppedChars: entry.droppedChars }
					: {}),
			});
		}
	};

	const scheduleFlush = () => {
		if (!emitUpdate || flushTimer || stopped) return;
		flushTimer = setTimeout(flush, COMMAND_PROGRESS_FLUSH_INTERVAL_MS);
		flushTimer.unref();
	};

	return {
		append(stream: CommandProgressStream, text: string): void {
			if (!emitUpdate || stopped || !text) return;
			let entry = pending[stream];
			if (!entry) {
				entry = { chunk: "", droppedChars: 0 };
				pending[stream] = entry;
				streamOrder.push(stream);
			}
			if (text.length >= maxPendingChars) {
				entry.droppedChars +=
					entry.chunk.length + text.length - maxPendingChars;
				entry.chunk = text.slice(-maxPendingChars);
			} else {
				const overflow = entry.chunk.length + text.length - maxPendingChars;
				if (overflow > 0) {
					entry.droppedChars += overflow;
					entry.chunk = entry.chunk.slice(overflow);
				}
				entry.chunk += text;
			}
			scheduleFlush();
		},
		flush,
		stop(options: { flush?: boolean } = {}): void {
			if (stopped) return;
			if (options.flush) {
				flush();
			} else {
				clearFlushTimer();
				pending = {};
				streamOrder = [];
			}
			stopped = true;
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

function createDetachedLog(retentionMs: number, marker: DetachedCommandMarker) {
	const directory = mkdtempSync(join(tmpdir(), DETACHED_LOG_DIRECTORY_PREFIX));
	const path = join(directory, DETACHED_LOG_FILENAME);
	const activeCommandPath = join(
		directory,
		DETACHED_LOG_ACTIVE_COMMAND_FILENAME,
	);
	const completedAtPath = join(directory, DETACHED_LOG_COMPLETED_FILENAME);
	try {
		writeLifecycleMarker(activeCommandPath, `${JSON.stringify(marker)}\n`);
	} catch (error) {
		rmSync(directory, { recursive: true, force: true });
		throw error;
	}
	const stream = createWriteStream(path, { encoding: "utf8" });
	let bytesWritten = 0;
	let capped = false;
	let writable = true;
	let streamClosed = false;
	let completed = false;
	let cleanupScheduled = false;
	const scheduleCleanup = () => {
		if (cleanupScheduled) return;
		cleanupScheduled = true;
		scheduleDetachedLogCleanup(directory, retentionMs);
	};
	stream.on("error", () => {
		// The detached command has already released its caller. A late log write
		// failure must not become an unhandled stream error in the hub process.
		writable = false;
	});
	stream.once("close", () => {
		writable = false;
		streamClosed = true;
		if (completed) scheduleCleanup();
	});

	const complete = () => {
		if (completed) return;
		completed = true;
		try {
			writeLifecycleMarker(completedAtPath, String(Date.now()));
		} catch {
			// The startup reaper can fall back to the output timestamp if the
			// completion marker cannot be persisted.
		}
		try {
			rmSync(activeCommandPath, { force: true });
		} catch {
			// Cleanup remains best effort and must not surface from a stream event.
		}
		if (streamClosed) {
			scheduleCleanup();
			return;
		}
		writable = false;
		stream.end();
	};

	return {
		path,
		write(text: string): void {
			if (!text || capped || !writable) return;
			const remaining = MAX_DETACHED_LOG_BYTES - bytesWritten;
			if (remaining <= 0) {
				capped = true;
				writable = false;
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
				writable = false;
				stream.end();
			}
		},
		complete,
	};
}

function spawnAndCollect(
	config: SpawnConfig,
	context: AgentToolContext,
	limits: Required<ShellExecutionLimits>,
	maxOutputChars: number,
	combineOutput: boolean,
	detachedLogRetentionMs: number,
	executionController?: RunCommandExecutionController,
	processStartTokenProbe: ProcessStartTokenProbe = probeProcessStartTokenAsync,
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
		const processStartedAtMs = Date.now();
		const hardKillAtMs = Number.isFinite(limits.killAfterMs)
			? processStartedAtMs + limits.killAfterMs
			: undefined;

		const stdout = createRollingCollector(maxOutputChars);
		const stderr = createRollingCollector(maxOutputChars);
		const executionId = randomUUID();
		const supportsManualDetachment = Boolean(
			executionController && context.sessionId,
		);
		const supportsImplicitDetachment =
			Number.isFinite(limits.detachAfterMs) &&
			(!Number.isFinite(limits.killAfterMs) ||
				limits.killAfterMs > limits.detachAfterMs);
		let detachable = false;
		let processStartToken: string | undefined;
		let killed = false;
		let settled = false;
		let detached = false;
		let detachKind: RunCommandDetachKind | undefined;
		let implicitDetachRequested = false;
		let detachedHardKillRequested = false;
		let detachedCompletionReported = false;
		let detachedLog: ReturnType<typeof createDetachedLog> | undefined;
		let unregisterExecution = () => {};
		const progress = createCommandProgressEmitter(
			context,
			executionId,
			() => detachable && supportsManualDetachment,
			maxOutputChars,
		);

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

		let detachTimer: NodeJS.Timeout | undefined;
		let killTimer: NodeJS.Timeout | undefined;
		const abortHandler = () => killAndReject(new Error("Command was aborted"));
		const clearDetachTimer = () => {
			if (detachTimer) clearTimeout(detachTimer);
			detachTimer = undefined;
		};
		const clearKillTimer = () => {
			if (killTimer) clearTimeout(killTimer);
			killTimer = undefined;
		};
		const cleanupForegroundOwnership = () => {
			clearDetachTimer();
			context.signal?.removeEventListener("abort", abortHandler);
			unregisterExecution();
		};
		const reportDetachedCompletion = (
			outcome:
				| { kind: "exited"; exitCode: number }
				| { kind: "signaled"; signal: string }
				| { kind: "hard_killed" }
				| { kind: "failed"; error: string },
		) => {
			if (!detached || !detachKind || detachedCompletionReported) return;
			detachedCompletionReported = true;
			clearKillTimer();
			const payload = {
				sessionId: context.sessionId ?? "",
				executionId,
				toolCallId: context.toolCallId,
				logPath: detachedLog?.path ?? "",
				detachKind,
				outcome,
				ts: Date.now(),
			};
			if (payload.sessionId && executionController) {
				executionController?.reportDetachedCommandCompleted(payload);
			} else {
				// Direct executor consumers have no runtime event bus, so completion
				// returns over the same update callback that announced detachment.
				context.emitUpdate?.({
					stream: "stdout",
					chunk: "",
					executionId,
					detached: true,
					completed: true,
					detachKind,
					logPath: payload.logPath,
					outcome,
				});
			}
		};
		const killAndReject = (error: Error) => {
			if (killed || settled) return;
			killed = true;
			progress.stop({ flush: true });
			cleanupForegroundOwnership();
			clearKillTimer();
			void killProcessTree().finally(() => settle(() => reject(error)));
		};

		if (Number.isFinite(limits.killAfterMs)) {
			killTimer = setTimeout(() => {
				if (!detached) {
					killAndReject(
						new TimeoutError(
							`Command timed out after ${limits.killAfterMs}ms`,
							limits.killAfterMs,
						),
					);
					return;
				}
				if (killed || detachedCompletionReported) return;
				detachedHardKillRequested = true;
				detachedLog?.write("\n[Command reached its hard deadline]\n");
				void killProcessTree();
			}, limits.killAfterMs);
			killTimer.unref();
		}

		if (context.signal) {
			context.signal.addEventListener("abort", abortHandler, { once: true });
			if (context.signal.aborted) abortHandler();
		}

		const detach = (kind: RunCommandDetachKind): boolean => {
			if (
				!detachable ||
				killed ||
				settled ||
				!childPid ||
				child.exitCode !== null ||
				child.signalCode !== null
			) {
				return false;
			}
			if (!processStartToken) return false;
			const log = createDetachedLog(detachedLogRetentionMs, {
				version: 1,
				executionId,
				pid: childPid,
				processStartToken,
				detachedAtMs: Date.now(),
				...(kind === "implicit" && hardKillAtMs !== undefined
					? { hardKillAtMs }
					: {}),
			});
			progress.stop({ flush: true });
			detached = true;
			detachKind = kind;
			detachedLog = log;
			const currentOut = stdout.current();
			const currentErr = stderr.current();
			detachedLog.write(currentOut.text);
			if (currentErr.text) {
				detachedLog.write(`\n[stderr]\n${currentErr.text}`);
			}
			cleanupForegroundOwnership();
			if (kind === "user") clearKillTimer();
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
			context.emitUpdate?.({
				stream: "stdout",
				chunk: "",
				executionId,
				detachable: false,
				detached: true,
				detachKind: kind,
				logPath: detachedLog.path,
			});
			return true;
		};

		if (supportsImplicitDetachment) {
			detachTimer = setTimeout(() => {
				implicitDetachRequested = true;
				detach("implicit");
			}, limits.detachAfterMs);
			detachTimer.unref();
		}

		child.once("spawn", () => {
			if (killed) return;
			context.emitUpdate?.({
				stream: "stdout",
				chunk: "",
				executionId,
				detachable: false,
			});
			const sessionId = context.sessionId;
			if (
				!childPid ||
				(!supportsImplicitDetachment && !supportsManualDetachment)
			) {
				return;
			}
			void (async () => {
				const probe = await processStartTokenProbe(childPid);
				if (
					probe.status !== "found" ||
					killed ||
					settled ||
					child.exitCode !== null ||
					child.signalCode !== null
				) {
					return;
				}
				processStartToken = probe.token;
				detachable = true;
				if (supportsManualDetachment && sessionId && executionController) {
					unregisterExecution = executionController.register({
						executionId,
						sessionId,
						toolCallId: context.toolCallId,
						detach,
					});
				}
				if (implicitDetachRequested) {
					detach("implicit");
					return;
				}
				context.emitUpdate?.({
					stream: "stdout",
					chunk: "",
					executionId,
					detachable: supportsManualDetachment,
				});
			})().catch(() => undefined);
		});

		child.stdout?.on("data", (data: Buffer) => {
			const chunk = stdout.append(data);
			if (!chunk) return;
			if (detached) {
				detachedLog?.write(chunk);
				return;
			}
			progress.append("stdout", chunk);
		});

		child.stderr?.on("data", (data: Buffer) => {
			const chunk = stderr.append(data);
			if (!chunk) return;
			if (detached) {
				detachedLog?.write(chunk);
				return;
			}
			progress.append("stderr", chunk);
		});

		child.on("close", (code, signal) => {
			if (killed) return;

			const out = stdout.snapshot();
			const err = stderr.snapshot();
			if (detached) {
				detachedLog?.write(out.finalChunk);
				detachedLog?.write(err.finalChunk);
				detachedLog?.write(`\n[Command exited with code ${code ?? 1}]\n`);
				detachedLog?.complete();
				reportDetachedCompletion(
					detachedHardKillRequested
						? { kind: "hard_killed" }
						: signal
							? { kind: "signaled", signal }
							: { kind: "exited", exitCode: code ?? 1 },
				);
				return;
			}
			if (out.finalChunk) {
				progress.append("stdout", out.finalChunk);
			}
			if (err.finalChunk) {
				progress.append("stderr", err.finalChunk);
			}
			progress.stop({ flush: true });
			cleanupForegroundOwnership();
			clearKillTimer();

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
				detachedLog?.complete();
				reportDetachedCompletion(
					detachedHardKillRequested
						? { kind: "hard_killed" }
						: { kind: "failed", error: error.message },
				);
				return;
			}
			progress.stop({ flush: true });
			cleanupForegroundOwnership();
			clearKillTimer();
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
		env = {},
		combineOutput = true,
		executionController,
		processStartTokenProbe = probeProcessStartTokenAsync,
	} = options;
	const detachedLogRetentionMs = resolveDetachedLogRetentionMs(
		options.detachedLogRetentionMs,
	);
	const maxOutputChars =
		options.maxOutputChars ??
		options.maxOutputBytes ??
		MAX_COMMAND_OUTPUT_CHARS;

	return (command, cwd, context, invocationLimits) => {
		const limits: Required<ShellExecutionLimits> = {
			detachAfterMs:
				invocationLimits?.detachAfterMs ??
				options.detachAfterMs ??
				Number.POSITIVE_INFINITY,
			killAfterMs:
				invocationLimits?.killAfterMs ??
				options.killAfterMs ??
				options.timeoutMs ??
				30_000,
		};
		// Spawn without a shell only when the args key is present (even
		// empty), marking input the caller already split. An object with no
		// args key, like { command: "echo hello" }, holds a full command
		// line, and spawning that string as an executable fails with ENOENT.
		// Same key-presence rule as the VS Code host's formatCommandForTerminal.
		const directExec = typeof command !== "string" && "args" in command;
		const invocation = directExec
			? { args: command.args ?? [] }
			: getShellInvocation(
					shell,
					typeof command === "string" ? command : command.command,
				);
		return spawnAndCollect(
			{
				executable: directExec ? command.command : shell,
				args: invocation.args,
				cwd,
				env,
				input: invocation.input,
			},
			context,
			limits,
			maxOutputChars,
			combineOutput,
			detachedLogRetentionMs,
			executionController,
			processStartTokenProbe,
		);
	};
}
