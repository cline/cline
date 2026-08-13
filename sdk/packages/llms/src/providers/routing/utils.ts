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

/** Target the AI SDK v7 camelCase provider-options bucket. */
export function buildProviderOptionsPatch(options: {
	providerOptionsKey: string;
	bucketOptions: Record<string, unknown>;
}): ProviderOptionsPatch {
	const { providerOptionsKey, bucketOptions } = options;
	return {
		[providerOptionsKey]: bucketOptions,
	};
}

export function buildThinkingPatch(options: {
	providerOptionsKey: string;
	thinkingType: "enabled" | "disabled";
}): ProviderOptionsPatch {
	const bucketOptions = { thinking: { type: options.thinkingType } };
	return {
		...buildProviderOptionsPatch({
			providerOptionsKey: options.providerOptionsKey,
			bucketOptions,
		}),
		openaiCompatible: bucketOptions,
	};
}
