import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Llms } from "@cline/core";

const execFileAsync = promisify(execFile);

export type ProviderLocalCli = Llms.ProviderLocalCli;

export type LocalCliStatus =
	| {
			installed: true;
			version: string;
	  }
	| {
			installed: false;
			reason: string;
	  };

/**
 * The CLI a `local-auth` provider borrows credentials from, as declared in
 * the provider catalog. `undefined` for providers that name none — those are
 * connected without a readiness check rather than probing a guessed command.
 */
export function getLocalCliInfo(
	providerId: string,
): ProviderLocalCli | undefined {
	return Llms.resolveProviderLocalCli(providerId);
}

export async function checkLocalCliInstalled(
	cli: ProviderLocalCli,
): Promise<LocalCliStatus> {
	try {
		const result = await execFileAsync(cli.command, ["--version"], {
			timeout: 3000,
			windowsHide: true,
		});
		const version = (result.stdout || result.stderr).trim();
		return {
			installed: true,
			version: version || cli.command,
		};
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
