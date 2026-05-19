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
		return new Error(
			`Failed to execute hook command "${commandLabel}" (EACCES). Configure hooks with an explicit interpreter/command array (for example: ["bash", "/path/to/script"]) or make the script executable with a valid shebang.`,
		);
	}
	return new Error(
		`Failed to execute hook command "${commandLabel}": ${err.message}`,
	);
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
		const onError = (error: Error) => {
			stdin.off("error", onError);
			const code = (error as Error & { code?: string }).code;
			if (code === "EPIPE" || code === "ERR_STREAM_DESTROYED") {
				resolve();
				return;
			}
			reject(error);
		};
		stdin.once("error", onError);
		stdin.end(payload, (error?: Error | null) => {
			stdin.off("error", onError);
			if (error) {
				const code = (error as Error & { code?: string }).code;
				if (code === "EPIPE" || code === "ERR_STREAM_DESTROYED") {
					resolve();
					return;
				}
				reject(error);
				return;
			}
			resolve();
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
	});
	const spawned = new Promise<void>((resolve) => {
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
	});
	const childError = new Promise<never>((_, reject) => {
		child.once("error", (error) => {
			reject(formatSpawnError(error, command));
		});
	});

	await writeToChildStdin(child, JSON.stringify(payload));

	if (detached) {
		await Promise.race([spawned, childError]);
		child.unref();
		return;
	}

	if (!child.stdout || !child.stderr) {
		throw new Error("runSubprocessEvent failed to create stdout/stderr pipes");
	}

	let stdout = "";
	let stderr = "";
	let timedOut = false;
	let timeoutId: NodeJS.Timeout | undefined;

	child.stdout.on("data", (chunk: Buffer | string) => {
		stdout += chunk.toString();
	});
	child.stderr.on("data", (chunk: Buffer | string) => {
		stderr += chunk.toString();
	});

	const result = new Promise<RunSubprocessEventResult>((resolve) => {
		if ((options.timeoutMs ?? 0) > 0) {
			timeoutId = setTimeout(() => {
				timedOut = true;
				child.kill("SIGKILL");
			}, options.timeoutMs);
		}
		child.once("close", (exitCode) => {
			if (timeoutId) {
				clearTimeout(timeoutId);
			}
			const { parsedJson, parseError } = parseStdout(stdout);
			resolve({
				exitCode,
				stdout,
				stderr,
				parsedJson,
				parseError,
				timedOut,
			});
		});
	});
	return await Promise.race([result, childError]);
}
