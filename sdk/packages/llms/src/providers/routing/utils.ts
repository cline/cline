import { isClineProvider } from "@cline/shared";
import { inferProviderOptionsTarget } from "./provider-options-types";

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
 * Resolve the `providerOptions` bucket name the AI SDK reads for a provider
 * id.
 *
 * Providers served by `@ai-sdk/openai-compatible` (the `openai-compatible`
 * options target: the generic `openai-compatible` provider, gateways such as
 * `vercel-ai-gateway`, and user-defined ids) read `providerOptions[<name>]`
 * and its camelCase alias, and since `@ai-sdk/openai-compatible` 3.0.30 they
 * log a deprecation warning on every stream chunk for a hyphenated raw name
 * (`providerOptions key 'openai-compatible'`, `Use 'openaiCompatible'
 * instead.`). Those providers are therefore written under the camelCase
 * alias only; the SDK reads that alias for every provider name, so no
 * request-body passthrough is lost. Every other target keeps its raw id so
 * the native and community vendor packages see the buckets they expect.
 */
export function toProviderOptionsBucket(providerId: string): string {
	return inferProviderOptionsTarget(providerId) === "openai-compatible"
		? toProviderOptionsKey(providerId)
		: providerId;
}

/**
 * Target the AI SDK provider-name bucket for the provider id and, when
 * distinct, its camelCase alias bucket (e.g. `openai-codex` +
 * `openaiCodex`). Hyphenated openai-compatible ids collapse to the alias
 * alone (see `toProviderOptionsBucket`).
 *
 * The bucket name must match the AI SDK provider `name`, because the
 * openai-compatible model only applies request-body passthrough from
 * `providerOptions[<name>]` (and its camelCase alias). For almost every
 * provider the name is the gateway provider id, but both Cline gateway ids
 * (`cline` and `cline-pass`) are served by the shared "cline" AI SDK provider
 * (see `createClineProviderModule`) and hit the same Cline API, so their
 * options key to the shared `cline` bucket.
 */
export function buildProviderAndAliasPatch(options: {
	providerId: string;
	providerOptionsKey: string;
	bucketOptions: Record<string, unknown>;
}): ProviderOptionsPatch {
	const { bucketOptions } = options;
	const providerBucket = isClineProvider(options.providerId)
		? "cline"
		: toProviderOptionsBucket(options.providerId);
	const aliasBucket = isClineProvider(options.providerId)
		? "cline"
		: options.providerOptionsKey;
	const needsAlias =
		aliasBucket !== providerBucket && aliasBucket !== "anthropic";
	return {
		[providerBucket]: bucketOptions,
		...(needsAlias ? { [aliasBucket]: bucketOptions } : {}),
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
