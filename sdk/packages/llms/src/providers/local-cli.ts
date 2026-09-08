import { normalizeProviderId } from "./ids";
import { getProviderCollectionSync } from "./model-registry";

/**
 * The local CLI a `local-auth` provider borrows credentials from. Providers
 * declare it in the catalog (`metadata.localCliCommand` plus `docsUrl`), so
 * hosts can check readiness and point at an install page without knowing any
 * provider ids.
 */
export interface ProviderLocalCli {
	/** Executable to probe, e.g. `codex` or `claude`. */
	command: string;
	/** Where to send someone whose machine does not have it yet. */
	docsUrl?: string;
}

/**
 * Resolves the local CLI a provider authenticates through, or `undefined`
 * when it names none — including `local-auth` providers whose credentials
 * come from somewhere a host cannot probe.
 */
export function resolveProviderLocalCli(
	providerId: string,
): ProviderLocalCli | undefined {
	const provider = getProviderCollectionSync(
		normalizeProviderId(providerId.trim()),
	)?.provider;
	const command = provider?.metadata?.localCliCommand;
	if (typeof command !== "string" || command.trim().length === 0) {
		return undefined;
	}
	return { command: command.trim(), docsUrl: provider?.docsUrl };
}
