/**
 * Projection from the provider registry to the wire's `HubModelCatalog`.
 *
 * Pure, so the mapping rules are testable without a runtime host: disabled
 * providers are kept (a client may want to show "configure me"), providers are
 * keyed by id, and a provider with no registered models still appears with an
 * empty list rather than vanishing.
 */

import type {
	HubModelCatalog,
	HubModelCatalogModel,
	ProviderListItem,
} from "@cline/shared";

export function buildHubModelCatalog(
	providers: readonly ProviderListItem[],
): HubModelCatalog {
	const modelsByProvider: Record<string, HubModelCatalogModel[]> = {};
	for (const provider of providers) {
		modelsByProvider[provider.id] = (provider.modelList ?? []).map((model) => ({
			id: model.id,
			...(model.name?.trim() ? { name: model.name } : {}),
			...(model.supportsReasoning !== undefined
				? { supportsThinking: model.supportsReasoning }
				: {}),
		}));
	}
	return {
		providers: providers.map((provider) => ({
			id: provider.id,
			name: provider.name,
			enabled: provider.enabled,
			...(provider.defaultModelId?.trim()
				? { defaultModelId: provider.defaultModelId }
				: {}),
		})),
		modelsByProvider,
	};
}
