import { spawn } from "node:child_process";
import {
	augmentNodeCommandForDebug,
	withResolvedClineBuildEnv,
} from "@cline/shared";

export interface RunSubprocessEventOptions {
	command: string[];
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	detached?: boolean;
	timeoutMs?: number;
	onSpawn?: (event: {
		command: string[];
		pid?: number;
		detached: boolean;
	}) => void;
	/**
	 * Called when a detached hook process exits, with how long it ran. The run
	 * never waits on this: detached hooks are fire-and-forget by contract, and
	 * this only observes them so hosts can measure how long they actually take.
	 * Not called if the parent exits first — a hook still running at that point
	 * is itself the signal, reported as `exited: false`.
	 */
	onDetachedSettled?: (event: {
		command: string[];
		durationMs: number;
		exitCode: number | null;
		exited: boolean;
	}) => void;
}

export interface RunSubprocessEventResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	parsedJson?: unknown;
	parseError?: string;
	timedOut?: boolean;
}

function parseStdout(stdout: string): {
	parsedJson?: unknown;
	parseError?: string;
} {
	const trimmed = stdout.trim();
	if (!trimmed) {
		return {};
	}

	const lines = trimmed
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	const prefixed = lines
		.filter((line) => line.startsWith("HOOK_CONTROL\t"))
		.map((line) => line.slice("HOOK_CONTROL\t".length));

	const candidate =
		prefixed.length > 0 ? prefixed[prefixed.length - 1] : trimmed;
	try {
		return { parsedJson: JSON.parse(candidate) };
	} catch (error) {
		return {
			parseError:
				error instanceof Error
					? error.message
					: "Failed to parse subprocess stdout JSON",
		};
	}
}

function formatSpawnError(error: unknown, command: string[]): Error {
	const err = error instanceof Error ? error : new Error(String(error));
	const withCode = err as Error & { code?: string };
	const commandLabel = command.join(" ");
	if (withCode.code === "EACCES") {
		const formatted = new Error(
			`Failed to execute hook command "${commandLabel}" (EACCES). Configure hooks with an explicit interpreter/command array (for example: ["bash", "/path/to/script"]) or make the script executable with a valid shebang.`,
		);
		(formatted as Error & { code?: string }).code = withCode.code;
		return formatted;
	}
	const formatted = new Error(
		`Failed to execute hook command "${commandLabel}": ${err.message}`,
	);
	(formatted as Error & { code?: string }).code = withCode.code;
	return formatted;
}

async function writeToChildStdin(
	child: ReturnType<typeof spawn>,
	payload: string,
): Promise<void> {
	const stdin = child.stdin;
	if (!stdin) {
		throw new Error("runSubprocessEvent failed to create stdin pipe");
	}

	await new Promise<void>((resolve, reject) => {
		let settled = false;
		const settle = (fn: () => void) => {
			if (settled) return;
			settled = true;
			fn();
		};
		const isClosedPipeError = (error: Error) => {
			const code = (error as Error & { code?: string }).code;
			return (
				code === "EPIPE" || code === "EOF" || code === "ERR_STREAM_DESTROYED"
			);
		};
		const onError = (error: Error) => {
			if (isClosedPipeError(error)) {
				settle(resolve);
				return;
			}
			settle(() => reject(error));
		};
		// The end callback can run before a late pipe error is emitted. Keep the
		// observer through close so a child that exits without reading stdin cannot
		// leak EPIPE (Unix) or EOF (Windows) as an uncaught exception.
		stdin.on("error", onError);
		stdin.once("close", () => stdin.off("error", onError));
		stdin.end(payload, (error?: Error | null) => {
			if (error) {
				if (isClosedPipeError(error)) {
					settle(resolve);
					return;
				}
				settle(() => reject(error));
				return;
			}
			settle(resolve);
		});
	});
}

export async function runSubprocessEvent(
	payload: unknown,
	options: RunSubprocessEventOptions,
): Promise<RunSubprocessEventResult | undefined> {
	const command = augmentNodeCommandForDebug(options.command, {
		env: options.env,
		debugRole: "hook",
	});
	if (!Array.isArray(command) || command.length === 0) {
		throw new Error("runSubprocessEvent requires a non-empty command");
	}

	const detached = !!options.detached;
	const child = spawn(command[0], command.slice(1), {
		cwd: options.cwd,
		env: withResolvedClineBuildEnv(options.env),
		stdio: detached ? ["pipe", "ignore", "ignore"] : ["pipe", "pipe", "pipe"],
		detached,
		// Prevent a console window from flashing on Windows (especially when
		// detached, which would otherwise allocate a new console).
		windowsHide: true,
	});
	let stdout = "";
	let stderr = "";
	let timedOut = false;
	let timeoutId: NodeJS.Timeout | undefined;

	if (!detached && (!child.stdout || !child.stderr)) {
		child.kill("SIGKILL");
		throw new Error("runSubprocessEvent failed to create stdout/stderr pipes");
	}
	child.stdout?.on("data", (chunk: Buffer | string) => {
		stdout += chunk.toString();
	});
	child.stderr?.on("data", (chunk: Buffer | string) => {
		stderr += chunk.toString();
	});

	// Install all lifecycle listeners before yielding. Fast commands can close
	// while stdin is being flushed, especially on Windows; attaching the result
	// listener afterwards loses that event and leaves the caller pending forever.
	const spawned = new Promise<void>((resolve, reject) => {
		child.once("spawn", () => {
			try {
				options.onSpawn?.({
					command,
					pid: child.pid ?? undefined,
					detached,
				});
			} catch {
				// Logging callbacks must not break subprocess execution.
			}
			resolve();
		});
		child.once("error", (error) => reject(formatSpawnError(error, command)));
	});
	const completed = new Promise<RunSubprocessEventResult>((resolve, reject) => {
		const settle = (exitCode: number | null) => {
			if (timeoutId) clearTimeout(timeoutId);
			const { parsedJson, parseError } = parseStdout(stdout);
			resolve({
				exitCode,
				stdout,
				stderr,
				parsedJson,
				parseError,
				timedOut,
			});
		};
		child.once("error", (error) => {
			if (timeoutId) clearTimeout(timeoutId);
			reject(formatSpawnError(error, command));
		});
		child.once("close", (exitCode) => settle(exitCode));
		// "close" waits for the stdio pipes to reach EOF, and a hook that spawned
		// a background child sharing its stdout keeps the pipe open after the
		// hook itself exits — without a fallback the caller would wait on that
		// grandchild forever (the timeout's SIGKILL only reaches the direct
		// child). Settle shortly after process exit with whatever output arrived;
		// a resolved promise ignores the eventual "close".
		if (!detached) {
			child.once("exit", (exitCode) => {
				const fallback = setTimeout(() => settle(exitCode), 1_000);
				fallback.unref?.();
			});
		}
	});
	// Avoid an unhandled rejection from the completion observer when a detached
	// process reports a late spawn error after ownership has been handed off.
	if (detached) void completed.catch(() => undefined);

	if (!detached && (options.timeoutMs ?? 0) > 0) {
		timeoutId = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, options.timeoutMs);
	}

	await Promise.race([
		Promise.all([spawned, writeToChildStdin(child, JSON.stringify(payload))]),
		completed,
	]);

	if (detached) {
		if (options.onDetachedSettled) {
			const startedAt = Date.now();
			const report = options.onDetachedSettled;
			// Observe only: `completed` is already wired, and the listener is
			// not what keeps the process alive (the child is unref'd below), so
			// a hook that outlives the parent simply never reports.
			void completed
				.then((result) =>
					report({
						command,
						durationMs: Date.now() - startedAt,
						exitCode: result.exitCode,
						exited: true,
					}),
				)
				.catch(() => undefined);
		}
		child.unref();
		return;
	}
	return await completed;
}
