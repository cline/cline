import * as LlmsModels from "@cline/llms";
import { resolveProviderConfig } from "../../services/llms/provider-defaults";
import type {
	ModelInfo,
	ProviderConfig,
} from "../../services/llms/provider-settings";

export const CLINE_PASS_PROVIDER_ID = "cline-pass";

/**
 * Resolve the effective model map for a provider: registered models merged
 * with any config-derived known models. LiteLLM and ClinePass replace the
 * registered set entirely because their catalogs are config-authoritative.
 */
export async function resolveProviderModelMap(
	providerId: string,
	config?: ProviderConfig,
): Promise<Record<string, ModelInfo>> {
	const registeredModels = await LlmsModels.getModelsForProvider(providerId);
	const isClinePass = providerId === CLINE_PASS_PROVIDER_ID;
	if (!config && !isClinePass) {
		return registeredModels;
	}

	const resolved = await resolveProviderConfig(
		providerId,
		{
			loadLatestOnInit: isClinePass,
			loadPrivateOnAuth: true,
			failOnError: false,
		},
		config,
	);

	if (providerId === "litellm" && resolved?.knownModels) {
		return resolved.knownModels;
	}
	if (isClinePass && resolved?.knownModels) {
		return resolved.knownModels;
	}

	return resolved?.knownModels
		? {
				...registeredModels,
				...resolved.knownModels,
			}
		: registeredModels;
}
