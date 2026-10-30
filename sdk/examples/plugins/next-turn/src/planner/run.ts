import { execFile } from "node:child_process";
import { promisify } from "node:util";

export type RunCommand = (
	file: string,
	args: readonly string[],
	cwd: string,
) => Promise<string>;

const COMMAND_TIMEOUT_MS = 2_000;
const COMMAND_MAX_BUFFER = 2_097_152;

const execFileAsync = promisify(execFile);

/**
 * Runs a read-only command the way the #15095 plugin did (`run.ts`): no
 * shell, prompts off, bounded time and output. Rejects with the child's
 * `code` so callers can tell "not a repository" from a real failure.
 */
export const runCommand: RunCommand = async (file, args, cwd) => {
	const { stdout } = await execFileAsync(file, args, {
		cwd,
		encoding: "utf8",
		timeout: COMMAND_TIMEOUT_MS,
		maxBuffer: COMMAND_MAX_BUFFER,
		env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
	});
	return stdout.trim();
};

export function errorCode(error: unknown): unknown {
	return typeof error === "object" && error !== null && "code" in error
		? error.code
		: undefined;
}
