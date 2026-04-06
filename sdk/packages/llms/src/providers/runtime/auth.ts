import { BUILT_IN_PROVIDER, normalizeProviderId } from "../config/provider-ids";
import { getBuiltInProviderEnvKeys } from "./builtin-manifests";

const DEFAULT_FALLBACK_PROVIDER_IDS = [
	BUILT_IN_PROVIDER.CLINE,
	BUILT_IN_PROVIDER.ANTHROPIC,
	BUILT_IN_PROVIDER.OPENAI_NATIVE,
	BUILT_IN_PROVIDER.GEMINI,
	BUILT_IN_PROVIDER.OPENROUTER,
] as const;

function dedupe(values: readonly string[]): string[] {
	return [...new Set(values)];
}

function buildProviderEnvKeys(): Record<string, readonly string[]> {
	const envKeysByProvider: Record<string, readonly string[]> = {};
	for (const providerId of Object.values(BUILT_IN_PROVIDER)) {
		envKeysByProvider[providerId] = dedupe(
			getBuiltInProviderEnvKeys(providerId),
		);
	}
	return envKeysByProvider;
}

const ENV_KEYS_BY_PROVIDER = buildProviderEnvKeys();
const DEFAULT_FALLBACK_ENV_KEYS = dedupe(
	DEFAULT_FALLBACK_PROVIDER_IDS.flatMap(
		(providerId) => ENV_KEYS_BY_PROVIDER[providerId] ?? [],
	),
);

function readTrimmed(
	env: Record<string, string | undefined>,
	key: string,
): string | undefined {
	const value = env[key];
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function resolveFromKeys(
	keys: readonly string[],
	env: Record<string, string | undefined>,
): string | undefined {
	for (const key of keys) {
		const value = readTrimmed(env, key);
		if (value) {
			return value;
		}
	}
	return undefined;
}

export { normalizeProviderId };

export function getProviderEnvKeys(providerId: string): readonly string[] {
	return ENV_KEYS_BY_PROVIDER[normalizeProviderId(providerId)] ?? [];
}

export function resolveApiKeyForProvider(
	providerId: string,
	explicitApiKey: string | undefined,
	env: Record<string, string | undefined> = process.env,
): string | undefined {
	const normalizedProviderId = normalizeProviderId(providerId);
	const explicit = explicitApiKey?.trim();
	if (explicit) {
		return explicit;
	}

	const providerKey = resolveFromKeys(
		getProviderEnvKeys(normalizedProviderId),
		env,
	);
	if (providerKey) {
		return providerKey;
	}

	// LM Studio local runtime typically does not require auth.
	if (normalizedProviderId === BUILT_IN_PROVIDER.LMSTUDIO) {
		return "noop";
	}

	return resolveFromKeys(DEFAULT_FALLBACK_ENV_KEYS, env);
}

export function getMissingApiKeyError(providerId: string): string {
	const expectedKeys = [
		...new Set([
			...getProviderEnvKeys(providerId),
			...DEFAULT_FALLBACK_ENV_KEYS,
		]),
	];
	const keysMessage =
		expectedKeys.length > 0
			? expectedKeys.join(", ")
			: "provider-specific API key env var";
	return `Missing API key for provider "${normalizeProviderId(providerId)}". Set apiKey explicitly or one of: ${keysMessage}.`;
}
