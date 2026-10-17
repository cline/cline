import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
	CONNECTOR_COMMAND_MAX_BUFFER,
	CONNECTOR_COMMAND_TIMEOUT_MS,
} from "./config";
import { isRecord } from "./values";

export type RunCommand = (
	file: string,
	args: readonly string[],
	cwd: string,
) => Promise<string>;

const execFileAsync = promisify(execFile);

/**
 * Runs a read-only command the way Cline desktop's PR bar does
 * (`sidecar/pull-request.ts` upstream): no shell, prompts off, bounded time
 * and output. Rejects with the child's `code` and `stderr` so callers can
 * tell "not installed" and "not signed in" from a real failure.
 */
export const runCommand: RunCommand = async (file, args, cwd) => {
	const { stdout } = await execFileAsync(file, args, {
		cwd,
		encoding: "utf8",
		timeout: CONNECTOR_COMMAND_TIMEOUT_MS,
		maxBuffer: CONNECTOR_COMMAND_MAX_BUFFER,
		env: {
			...process.env,
			GH_PROMPT_DISABLED: "1",
			GIT_TERMINAL_PROMPT: "0",
		},
	});
	return stdout.trim();
};

export function errorCode(error: unknown): unknown {
	return isRecord(error) ? error.code : undefined;
}
