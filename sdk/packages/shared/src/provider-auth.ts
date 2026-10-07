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
	/** The provider accepts a missing API key (`metadata.apiKeyOptional`). */
	apiKeyOptional?: boolean;
}

/** Whether the provider declares its API key optional; callers own provider lookup. */
export function resolveProviderApiKeyOptional(
	provider: { metadata?: Record<string, unknown> } | undefined,
): boolean {
	return provider?.metadata?.apiKeyOptional === true;
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
