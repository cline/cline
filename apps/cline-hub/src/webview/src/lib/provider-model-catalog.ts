"use client";

import { isChatCompatibleModel } from "@cline/shared";
import { desktopClient } from "@/lib/desktop-client";
import type {
	Provider,
	ProviderCatalogResponse,
	ProviderModel,
	ProviderModelsResponse,
} from "@/lib/provider-schema";

export type ProviderModelCatalog = {
	providers: Provider[];
	enabledProviderIds: string[];
	providerModels: Record<string, string[]>;
	providerReasoningModels: Record<string, string[]>;
};

export function filterChatModels(
	models: ProviderModel[] | undefined,
): ProviderModel[] {
	return (models ?? []).filter((model) =>
		isChatCompatibleModel({
			operation: model.operation,
			modalities: {
				input: model.inputModalities,
				output: model.outputModalities,
			},
		}),
	);
}

export function buildProviderModelCatalog(
	providers: Provider[],
): ProviderModelCatalog {
	const providerEntries = providers.map((provider) => {
		const chatModels = filterChatModels(provider.modelList);
		return {
			provider,
			modelIds: chatModels.map((model) => model.id),
			reasoningModelIds: chatModels
				.filter((model) => model.supportsReasoning)
				.map((model) => model.id),
		};
	});

	return {
		providers,
		enabledProviderIds: providerEntries
			.filter(
				({ provider, modelIds }) => provider.enabled && modelIds.length > 0,
			)
			.map(({ provider }) => provider.id),
		providerModels: Object.fromEntries(
			providerEntries.map(({ provider, modelIds }) => [provider.id, modelIds]),
		),
		providerReasoningModels: Object.fromEntries(
			providerEntries.map(({ provider, reasoningModelIds }) => [
				provider.id,
				reasoningModelIds,
			]),
		),
	};
}

export async function loadProviderModelCatalog(): Promise<ProviderModelCatalog> {
	const payload = await desktopClient.invoke<ProviderCatalogResponse>(
		"list_provider_catalog",
	);
	return buildProviderModelCatalog(payload.providers ?? []);
}

export async function loadProviderModels(
	providerId: string,
): Promise<ProviderModel[]> {
	const payload = await desktopClient.invoke<ProviderModelsResponse>(
		"list_provider_models",
		{
			provider: providerId,
		},
	);
	return payload.models ?? [];
}
