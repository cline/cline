import {
	Llms,
	type ProviderSettingsManager,
	resolveProviderConfig,
} from "@cline/core";
import type { Config } from "../../utils/types";

/**
 * Resolve a provider's model catalog for the picker. Built-in providers come
 * from `resolveProviderConfig`; custom providers defined in `models.json` have
 * no built-in manifest, so it returns nothing for them and the picker falls
 * back to the registered models, like the onboarding wizard does.
 */
export async function resolveProviderKnownModels(
	manager: ProviderSettingsManager,
	providerId: string,
): Promise<Config["knownModels"]> {
	const resolved = await resolveProviderConfig(
		providerId,
		{
			loadLatestOnInit: true,
			loadPrivateOnAuth: true,
			failOnError: false,
		},
		manager.getProviderConfig(providerId, { includeKnownModels: false }),
	);
	if (resolved?.knownModels && Object.keys(resolved.knownModels).length > 0) {
		return resolved.knownModels;
	}
	const registeredModels = await Llms.getModelsForProvider(providerId, {
		filter: "chat",
	}).catch(() => ({}));
	if (Object.keys(registeredModels).length > 0) {
		return registeredModels;
	}
	return resolved?.knownModels;
}
