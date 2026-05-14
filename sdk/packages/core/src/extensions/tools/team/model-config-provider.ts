import type { ProviderListItem, ProviderModel } from "@cline/shared";
import { resolveProviderConfig } from "../../../services/llms/provider-defaults";
import {
	getLocalProviderModels,
	listLocalProviders,
	refreshProviderModelsFromSource,
} from "../../../services/providers/local-provider-service";
import type { ProviderSettingsManager } from "../../../services/storage/provider-settings-manager";
import type {
	DelegatedAgentConfigProvider,
	DelegatedAgentConnectionConfig,
} from "./delegated-agent";
import type {
	TeamConnectionConfigRequest,
	TeamModelCatalogResult,
	TeamModelConfigProvider,
	TeamModelListItem,
	TeamProviderListItem,
} from "./team-tools";

function toTeamModel(model: ProviderModel): TeamModelListItem {
	return {
		id: model.id,
		name: model.name,
		supportsAttachments: model.supportsAttachments,
		supportsVision: model.supportsVision,
		supportsReasoning: model.supportsReasoning,
	};
}

function toTeamProvider(provider: ProviderListItem): TeamProviderListItem {
	return {
		id: provider.id,
		name: provider.name,
		enabled: provider.enabled,
		defaultModelId: provider.defaultModelId,
		models: provider.models,
		modelList: provider.modelList?.map(toTeamModel),
	};
}

export function createLocalTeamModelConfigProvider(options: {
	manager: ProviderSettingsManager;
	fallbackConfigProvider: DelegatedAgentConfigProvider;
}): TeamModelConfigProvider {
	return {
		async listModels(input): Promise<TeamModelCatalogResult> {
			const providerId = input.providerId?.trim();
			if (input.refresh) {
				if (providerId) {
					await refreshProviderModelsFromSource(
						options.manager,
						providerId,
					).catch(() => undefined);
				} else {
					const catalog = await listLocalProviders(options.manager);
					await Promise.all(
						catalog.providers
							.filter((provider) => provider.enabled)
							.map((provider) =>
								refreshProviderModelsFromSource(
									options.manager,
									provider.id,
								).catch(() => undefined),
							),
					);
				}
			}

			const includeDisabled = input.includeDisabledProviders ?? true;
			const catalog = await listLocalProviders(options.manager);
			let providers = catalog.providers;
			if (providerId) {
				providers = providers.filter((provider) => provider.id === providerId);
			}
			if (!includeDisabled) {
				providers = providers.filter((provider) => provider.enabled);
			}

			return {
				providers: providers.map(toTeamProvider),
				settingsPath: catalog.settingsPath,
			};
		},

		async resolveConnectionConfig(
			request: TeamConnectionConfigRequest,
		): Promise<DelegatedAgentConnectionConfig> {
			const fallback = options.fallbackConfigProvider.getConnectionConfig();
			const providerId = request.providerId?.trim() || fallback.providerId;
			const modelId = request.modelId?.trim() || fallback.modelId;

			if (providerId === fallback.providerId) {
				return {
					...fallback,
					modelId,
					...(request.thinking !== undefined
						? { thinking: request.thinking }
						: {}),
					...(request.reasoningEffort
						? { reasoningEffort: request.reasoningEffort }
						: {}),
				};
			}

			const persistedConfig = options.manager.getProviderConfig(providerId, {
				includeKnownModels: false,
			});
			const resolved = await resolveProviderConfig(
				providerId,
				{
					loadLatestOnInit: false,
					loadPrivateOnAuth: false,
					failOnError: false,
				},
				persistedConfig,
			);
			const settings = options.manager.getProviderSettings(providerId);
			const knownModels =
				resolved?.knownModels ??
				(await getLocalProviderModels(providerId, persistedConfig)
					.then(({ models }) =>
						Object.fromEntries(
							models.map((model) => [
								model.id,
								{
									id: model.id,
									name: model.name,
								},
							]),
						),
					)
					.catch(() => undefined));

			return {
				providerId,
				modelId,
				apiKey: persistedConfig?.apiKey ?? settings?.apiKey,
				baseUrl: persistedConfig?.baseUrl ?? resolved?.baseUrl,
				headers: persistedConfig?.headers ?? settings?.headers,
				providerConfig: persistedConfig,
				knownModels,
				thinking:
					request.thinking ?? persistedConfig?.thinking ?? fallback.thinking,
				reasoningEffort:
					request.reasoningEffort ??
					persistedConfig?.reasoningEffort ??
					fallback.reasoningEffort,
				thinkingBudgetTokens:
					persistedConfig?.thinkingBudgetTokens ??
					fallback.thinkingBudgetTokens,
			};
		},
	};
}
