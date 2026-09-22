/** The local CLI a provider borrows credentials from. */
export interface ProviderLocalCli {
	command: string;
	docsUrl?: string;
}

/** Serializable authentication facts resolved by the host's provider catalog. */
export interface ProviderAuthInfo {
	providerId: string;
	capabilities?: string[];
	localCli?: ProviderLocalCli;
}

/** Extract declared CLI metadata; callers own provider lookup. */
export function resolveProviderLocalCli(
	provider:
		| { metadata?: Record<string, unknown>; docsUrl?: string }
		| undefined,
): ProviderLocalCli | undefined {
	const command = provider?.metadata?.localCliCommand;
	if (typeof command !== "string" || !command.trim()) return undefined;
	return { command: command.trim(), docsUrl: provider?.docsUrl };
}
