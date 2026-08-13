import type {
	GatewayProviderFactory,
	GatewayProviderRegistration,
} from "@cline/shared";
import {
	BUILTIN_PROVIDER_MANIFESTS_BY_ID,
	BUILTIN_SPECS,
	type ProviderFamily,
} from "./builtins";

const FAMILY_FACTORY_PROMISES = new Map<
	ProviderFamily,
	Promise<GatewayProviderFactory>
>();

async function loadFamilyFactory(
	family: ProviderFamily,
): Promise<GatewayProviderFactory> {
	const cached = FAMILY_FACTORY_PROMISES.get(family);
	if (cached) {
		return cached;
	}

	const promise = (async () => {
		switch (family) {
			case "cline": {
				const module = await import("./ai-sdk");
				return module.createClineProvider;
			}
			case "openai": {
				const module = await import("./ai-sdk");
				return module.createOpenAIProvider;
			}
			case "openai-compatible": {
				const module = await import("./ai-sdk");
				return module.createOpenAICompatibleProvider;
			}
			case "anthropic": {
				const module = await import("./ai-sdk");
				return module.createAnthropicProvider;
			}
			case "google": {
				const module = await import("./ai-sdk");
				return module.createGoogleProvider;
			}
			case "vertex": {
				const module = await import("./ai-sdk");
				return module.createVertexProvider;
			}
			case "bedrock": {
				const module = await import("./ai-sdk");
				return module.createBedrockProvider;
			}
			case "mistral": {
				const module = await import("./ai-sdk");
				return module.createMistralProvider;
			}
			case "claude-code": {
				const module = await import("./ai-sdk");
				return module.createClaudeCodeProvider;
			}
			case "openai-codex": {
				const module = await import("./ai-sdk");
				return module.createOpenAICodexProvider;
			}
			case "opencode": {
				const module = await import("./ai-sdk");
				return module.createOpenCodeProvider;
			}
			case "dify": {
				const module = await import("./ai-sdk");
				return module.createDifyProvider;
			}
			case "ollama": {
				const module = await import("./ai-sdk");
				return module.createOllamaProvider;
			}
			case "sap-ai-core": {
				const module = await import("./ai-sdk");
				return module.createSapAiCoreProvider;
			}
		}
	})();

	FAMILY_FACTORY_PROMISES.set(family, promise);
	return promise;
}

function resolveRuntimeFamily(
	spec: (typeof BUILTIN_SPECS)[number],
): ProviderFamily {
	if (
		spec.family === "openai" ||
		spec.protocol === "openai-responses" ||
		spec.client === "openai"
	) {
		return "openai";
	}
	return spec.family;
}

export const BUILTIN_PROVIDER_REGISTRATIONS: GatewayProviderRegistration[] =
	BUILTIN_SPECS.map((spec) => ({
		manifest: BUILTIN_PROVIDER_MANIFESTS_BY_ID[spec.id],
		defaults: {
			...spec.defaults,
			apiKeyEnv: spec.apiKeyEnv,
			baseUrl: spec.defaults?.baseUrl,
			// Surface the regional endpoint facts as a default option so the
			// registry can resolve a base URL from a caller-selected
			// `options.apiLine` (see GatewayRegistry.createProvider).
			...(spec.apiLineBaseUrls
				? {
						options: {
							...(spec.defaults?.options ?? {}),
							apiLineBaseUrls: spec.apiLineBaseUrls,
						},
					}
				: {}),
		},
		loadProvider: async () => ({
			createProvider: await loadFamilyFactory(resolveRuntimeFamily(spec)),
		}),
	}));
