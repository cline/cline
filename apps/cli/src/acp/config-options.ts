import type {
	SessionConfigOption,
	SessionConfigSelectOption,
} from "@agentclientprotocol/sdk";

/**
 * Category for the auth-provider selector.
 *
 * ACP reserves `model` for *the* model selector: when several options share a
 * category, clients break the tie by array order and treat the earliest one
 * as the model selector. The provider option is listed first, so tagging it
 * `model` too made spec-following clients write a model id into `provider`
 * (rejected by `setSessionConfigOption`). Names starting with `_` are free
 * for custom use, so the provider gets its own category instead.
 */
export const PROVIDER_CONFIG_CATEGORY = "_provider";

/** Category reserved by ACP for the model selector. Only `model` may use it. */
export const MODEL_CONFIG_CATEGORY = "model";

export function buildProviderConfigOption(
	currentProviderId: string,
	options: SessionConfigSelectOption[],
): SessionConfigOption {
	return {
		type: "select",
		id: "provider",
		name: "Provider",
		description: "The authentication provider to use",
		category: PROVIDER_CONFIG_CATEGORY,
		currentValue: currentProviderId,
		options,
	};
}

export function buildModelConfigOption(
	currentModelId: string,
	providerModels: Record<string, { name?: string; description?: string }>,
): SessionConfigOption {
	return {
		type: "select",
		id: "model",
		name: "Model",
		category: MODEL_CONFIG_CATEGORY,
		currentValue: currentModelId,
		options: Object.entries(providerModels).map(([modelId, info]) => ({
			value: modelId,
			name: info.name ?? modelId,
			description: info.description,
		})),
	};
}
