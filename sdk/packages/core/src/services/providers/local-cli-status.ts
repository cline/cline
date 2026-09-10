import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ProviderLocalCli } from "@cline/llms";

const execFileAsync = promisify(execFile);

export type LocalCliStatus =
	| { installed: true; version: string }
	| { installed: false; reason: string };

/**
 * Probe whether the CLI a `local-auth` provider borrows credentials from is
 * runnable on this machine. Hosts show the result before "connecting" such a
 * provider so a missing `claude`/`codex`/`opencode` surfaces up front rather
 * than as the first turn's failure. The probe only looks on PATH, so a miss
 * means "not on PATH", not "unusable" (the runtime also accepts explicit
 * executable paths and bundled binaries); callers should report, not block.
 */
export async function checkLocalCliInstalled(
	cli: ProviderLocalCli,
): Promise<LocalCliStatus> {
	try {
		const result = await execFileAsync(cli.command, ["--version"], {
			timeout: 3000,
			windowsHide: true,
		});
		const version = (result.stdout || result.stderr).trim();
		return { installed: true, version: version || cli.command };
	} catch (error) {
		const details = error as NodeJS.ErrnoException | undefined;
		if (details?.code === "ENOENT") {
			return {
				installed: false,
				reason: `The ${cli.command} executable was not found on PATH.`,
			};
		}
		return {
			installed: false,
			reason:
				error instanceof Error
					? error.message
					: `Could not run ${cli.command} --version.`,
		};
	}
}
