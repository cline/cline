export type ProviderOptionsPatch = Record<string, Record<string, unknown>>;

/**
 * AI SDK 7 `@ai-sdk/openai-compatible` deprecates the kebab-case
 * `providerOptions` bucket in favor of camelCase `openaiCompatible`.
 * Never emit the deprecated key — only the stable alias.
 */
const DEPRECATED_PROVIDER_OPTION_KEYS = new Set(["openai-compatible"]);

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
 *
 * Exception: `openai-compatible` only emits `openaiCompatible` (AI SDK 7
 * deprecation).
 */
export function buildProviderAndAliasPatch(options: {
	providerId: string;
	providerOptionsKey: string;
	bucketOptions: Record<string, unknown>;
}): ProviderOptionsPatch {
	const { providerId, providerOptionsKey, bucketOptions } = options;
	if (DEPRECATED_PROVIDER_OPTION_KEYS.has(providerId)) {
		return { [providerOptionsKey]: bucketOptions };
	}
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
