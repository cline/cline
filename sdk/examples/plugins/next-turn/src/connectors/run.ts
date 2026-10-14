import { execFile } from "node:child_process";
import {
	CONNECTOR_COMMAND_MAX_BUFFER,
	CONNECTOR_COMMAND_TIMEOUT_MS,
} from "../config";

/**
 * Runs a read-only command the way Cline desktop's PR bar does
 * (`sidecar/pull-request.ts` upstream): no shell, prompts off, bounded time
 * and output. Rejects with the child's `code` and `stderr` so callers can
 * tell "not installed" and "not signed in" from a real failure.
 */
export type RunCommand = (
	file: string,
	args: readonly string[],
	cwd: string,
) => Promise<string>;

export type CommandError = Error & { code?: number | string; stderr?: string };

export const runCommand: RunCommand = (file, args, cwd) =>
	new Promise((resolve, reject) => {
		execFile(
			file,
			[...args],
			{
				cwd,
				encoding: "utf8",
				timeout: CONNECTOR_COMMAND_TIMEOUT_MS,
				maxBuffer: CONNECTOR_COMMAND_MAX_BUFFER,
				env: {
					...process.env,
					GH_PROMPT_DISABLED: "1",
					GIT_TERMINAL_PROMPT: "0",
				},
			},
			(error, stdout, stderr) => {
				if (error) {
					reject(
						Object.assign(error, { stderr: String(stderr) }) as CommandError,
					);
					return;
				}
				resolve(String(stdout).trim());
			},
		);
	});

export function errorCode(error: unknown): number | string | undefined {
	return error && typeof error === "object" && "code" in error
		? (error as CommandError).code
		: undefined;
}
