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

/**
 * Target the concrete provider id and, when distinct, its camelCase alias
 * bucket (e.g. `vercel-ai-gateway` + `vercelAiGateway`).
 */
export function buildProviderAndAliasPatch(options: {
	providerId: string;
	providerOptionsKey: string;
	bucketOptions: Record<string, unknown>;
}): ProviderOptionsPatch {
	const { providerId, providerOptionsKey, bucketOptions } = options;
	const needsAlias =
		providerOptionsKey !== providerId && providerOptionsKey !== "anthropic";
	return {
		[providerId]: bucketOptions,
		...(needsAlias ? { [providerOptionsKey]: bucketOptions } : {}),
	};
}

export function buildThinkingPatch(options: {
	providerId: string;
	providerOptionsKey: string;
	thinkingType: "enabled" | "disabled";
}): ProviderOptionsPatch {
	const bucketOptions = { thinking: { type: options.thinkingType } };
	return {
		...buildProviderAndAliasPatch({
			providerId: options.providerId,
			providerOptionsKey: options.providerOptionsKey,
			bucketOptions,
		}),
		openaiCompatible: bucketOptions,
	};
}
