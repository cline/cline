/**
 * Readiness for local-CLI providers (Codex CLI, Claude Code, OpenCode). They
 * borrow credentials from a vendor CLI on this machine, so the CLI being
 * installed is the only evidence a turn can succeed. The CLI app probes for
 * it before letting a user connect (apps/cli/src/utils/local-cli.ts); the
 * desktop never did, so it showed these as Configured on machines without
 * the CLI and the user only found out mid-turn. For Codex the vendor package
 * reports the missing executable by throwing from a child-process "error"
 * listener, which escapes as an uncaught exception and shuts down the shared
 * hub daemon along with every client's sessions.
 */

import { accessSync, constants as fsConstants } from "node:fs";
import { delimiter, join } from "node:path";
import { Llms } from "@cline/core";
import type { ProviderListItem } from "@cline/shared";

export type LocalCliStatus = {
	command: string;
	installed: boolean;
	docsUrl?: string;
};

function isOnPath(command: string): boolean {
	const extensions =
		process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		if (!dir) continue;
		for (const ext of extensions) {
			try {
				accessSync(join(dir, `${command}${ext}`), fsConstants.X_OK);
				return true;
			} catch {
				// not here; keep looking
			}
		}
	}
	return false;
}

/** CLI status for a provider, or `undefined` when it names no local CLI. */
export function getLocalCliStatus(
	providerId: string,
): LocalCliStatus | undefined {
	const cli = Llms.resolveProviderLocalCli(providerId);
	return cli && { ...cli, installed: isOnPath(cli.command) };
}

/**
 * Attach CLI status to catalog entries and withdraw `configured` from the
 * ones whose CLI is missing, so the settings badge and composer stay honest.
 */
export function withLocalCliStatus(
	providers: ProviderListItem[],
): Array<ProviderListItem & { localCli?: LocalCliStatus }> {
	return providers.map((provider) => {
		const localCli = getLocalCliStatus(provider.id);
		return localCli
			? {
					...provider,
					localCli,
					configured: provider.configured === true && localCli.installed,
				}
			: provider;
	});
}

/** Refuse a turn on a local-CLI provider whose CLI is missing. */
export function assertLocalCliAvailable(providerId: string): void {
	const status = getLocalCliStatus(providerId);
	if (!status || status.installed) return;
	const name =
		Llms.MODEL_COLLECTIONS_BY_PROVIDER_ID[providerId]?.provider.name ??
		providerId;
	throw new Error(
		`${name} signs in through the \`${status.command}\` CLI, which was not found on PATH. ` +
			`Install it and run \`${status.command}\` once to sign in` +
			`${status.docsUrl ? `: ${status.docsUrl}` : "."}`,
	);
}
