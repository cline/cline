export type ProviderOptionsPatch = Record<string, Record<string, unknown>>;

export function toProviderOptionsKey(providerId: string): string {
	return providerId.replace(/-([a-z0-9])/gi, (_match, char: string) =>
		char.toUpperCase(),
	);
}

export function createEphemeralCacheControl() {
	return {
		cache_control: { type: "ephemeral" as const },
	};
}
