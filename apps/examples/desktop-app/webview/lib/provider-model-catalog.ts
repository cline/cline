"use client";

import { desktopClient } from "@/lib/desktop-client";
import type {
	Provider,
	ProviderCatalogResponse,
	ProviderMode,
	ProviderModel,
	ProviderModelsResponse,
	ProviderModesSettings,
	RealtimeVoiceModeSettings,
	VoiceInputModeSettings,
	VoiceOutputModeSettings,
} from "@/lib/provider-schema";

export type ProviderModelCatalog = {
	providers: Provider[];
	enabledProviderIds: string[];
	providerModels: Record<string, string[]>;
	providerReasoningModels: Record<string, string[]>;
	modes: ProviderModeModelTargets;
};

export type TranscriptionModelTarget = {
	providerId: string;
	providerName: string;
	modelId: string;
	modelName: string;
	supportsStreaming: boolean;
};

export type SpeechGenerationModelTarget = {
	providerId: string;
	providerName: string;
	modelId: string;
	modelName: string;
	voice?: string;
};

export type RealtimeVoiceModelTarget = {
	providerId: string;
	providerName: string;
	modelId: string;
	modelName: string;
	supportsTools: boolean;
	voice?: string;
};

export interface ProviderModeModelTargetMap {
	voiceInput: TranscriptionModelTarget;
	voiceOutput: SpeechGenerationModelTarget;
	realtimeVoice: RealtimeVoiceModelTarget;
}

export type ProviderModeModelTargets = {
	[Mode in ProviderMode]: ProviderModeModelTargetMap[Mode] | null;
};

export function isDedicatedTranscriptionModel(model: ProviderModel): boolean {
	return (
		model.inputModalities?.length === 1 &&
		model.inputModalities[0] === "audio" &&
		model.outputModalities?.length === 1 &&
		model.outputModalities[0] === "text"
	);
}

export function supportsAudio(model: ProviderModel): boolean {
	return (
		model.inputModalities?.includes("audio") === true ||
		model.outputModalities?.includes("audio") === true
	);
}

export function isSpeechGenerationModel(model: ProviderModel): boolean {
	return (
		model.inputModalities?.length === 1 &&
		model.inputModalities[0] === "text" &&
		model.outputModalities?.length === 1 &&
		model.outputModalities[0] === "audio"
	);
}

export function isRealtimeVoiceModel(model: ProviderModel): boolean {
	if (
		model.inputModalities?.includes("audio") !== true ||
		model.outputModalities?.includes("audio") !== true
	) {
		return false;
	}
	return /(?:^|[/_.\s-])(realtime|live|voice)(?:$|[/_.\s-])/i.test(
		`${model.id} ${model.name}`,
	);
}

export function hasRealtimeVoiceTransport(providerId: string): boolean {
	return (
		providerId === "vercel-ai-gateway" ||
		providerId === "gemini" ||
		providerId === "openai-native" ||
		providerId === "openai"
	);
}

export function selectTranscriptionModel(
	providers: Provider[],
	selection: VoiceInputModeSettings | undefined,
): TranscriptionModelTarget | null {
	if (!selection) return null;
	const provider = providers.find(
		(candidate) => candidate.enabled && candidate.id === selection.providerId,
	);
	const model = provider?.modelList?.find(
		(candidate) =>
			candidate.id === selection.modelId &&
			isDedicatedTranscriptionModel(candidate),
	);
	return provider && model
		? {
				providerId: provider.id,
				providerName: provider.name,
				modelId: model.id,
				modelName: model.name,
				supportsStreaming: model.supportsStreamingTranscription === true,
			}
		: null;
}

export function selectSpeechGenerationModel(
	providers: Provider[],
	selection: VoiceOutputModeSettings | undefined,
): SpeechGenerationModelTarget | null {
	if (!selection) return null;
	const provider = providers.find(
		(candidate) => candidate.enabled && candidate.id === selection.providerId,
	);
	const model = provider?.modelList?.find(
		(candidate) =>
			candidate.id === selection.modelId && isSpeechGenerationModel(candidate),
	);
	return provider && model
		? {
				providerId: provider.id,
				providerName: provider.name,
				modelId: model.id,
				modelName: model.name,
				voice: selection.voice,
			}
		: null;
}

export function selectRealtimeVoiceModel(
	providers: Provider[],
	selection: RealtimeVoiceModeSettings | undefined,
): RealtimeVoiceModelTarget | null {
	if (!selection) return null;
	const provider = providers.find(
		(candidate) =>
			candidate.enabled &&
			candidate.id === selection.providerId &&
			hasRealtimeVoiceTransport(candidate.id),
	);
	const model = provider?.modelList?.find(
		(candidate) =>
			candidate.id === selection.modelId && isRealtimeVoiceModel(candidate),
	);
	return provider && model
		? {
				providerId: provider.id,
				providerName: provider.name,
				modelId: model.id,
				modelName: model.name,
				supportsTools: model.supportsTools === true,
				voice: selection.voice,
			}
		: null;
}

export function isChatModel(model: ProviderModel): boolean {
	return (
		(model.inputModalities === undefined ||
			model.inputModalities.includes("text")) &&
		(model.outputModalities === undefined ||
			model.outputModalities.includes("text") ||
			model.outputModalities.includes("image") ||
			model.outputModalities.includes("video") ||
			model.outputModalities.includes("audio"))
	);
}

function toModelIds(models: ProviderModel[] | undefined): string[] {
	return (models ?? []).filter(isChatModel).map((model) => model.id);
}

function toReasoningModelIds(models: ProviderModel[] | undefined): string[] {
	return (models ?? [])
		.filter((model) => isChatModel(model) && model.supportsReasoning)
		.map((model) => model.id);
}

export function buildProviderModelCatalog(
	providers: Provider[],
	modes: ProviderModesSettings = {},
): ProviderModelCatalog {
	return {
		providers,
		enabledProviderIds: providers
			.filter(
				(provider) =>
					provider.enabled && toModelIds(provider.modelList).length > 0,
			)
			.map((provider) => provider.id),
		providerModels: Object.fromEntries(
			providers.map((provider) => [
				provider.id,
				toModelIds(provider.modelList),
			]),
		),
		providerReasoningModels: Object.fromEntries(
			providers.map((provider) => [
				provider.id,
				toReasoningModelIds(provider.modelList),
			]),
		),
		modes: {
			voiceInput: selectTranscriptionModel(providers, modes.voiceInput),
			voiceOutput: selectSpeechGenerationModel(providers, modes.voiceOutput),
			realtimeVoice: selectRealtimeVoiceModel(providers, modes.realtimeVoice),
		},
	};
}

// The provider catalog payload is large (hundreds of KB) and several
// components request it at startup (composer, onboarding, credentials sync).
// Deduplicate concurrent requests and keep the response briefly so the app
// boot issues a single round-trip instead of one per consumer.
const PROVIDER_CATALOG_CACHE_TTL_MS = 5_000;
export const MODE_SETTINGS_CHANGED_EVENT = "cline:mode-settings-changed";

let providerCatalogCache: {
	fetchedAt: number;
	promise: Promise<ProviderCatalogResponse>;
} | null = null;

type ProviderModelsListener = (
	providerId: string,
	models: ProviderModel[],
) => void;
const providerModelsListeners = new Set<ProviderModelsListener>();

export function publishProviderModels(
	providerId: string,
	models: ProviderModel[],
): void {
	invalidateProviderCatalogCache();
	for (const listener of providerModelsListeners) {
		listener(providerId, models);
	}
}

export function subscribeToProviderModels(
	listener: ProviderModelsListener,
): () => void {
	providerModelsListeners.add(listener);
	return () => providerModelsListeners.delete(listener);
}

export function fetchProviderCatalog(options?: {
	fresh?: boolean;
}): Promise<ProviderCatalogResponse> {
	const now = Date.now();
	if (
		!options?.fresh &&
		providerCatalogCache &&
		now - providerCatalogCache.fetchedAt < PROVIDER_CATALOG_CACHE_TTL_MS
	) {
		return providerCatalogCache.promise;
	}
	const promise = desktopClient
		.invoke<ProviderCatalogResponse>("list_provider_catalog")
		.catch((error) => {
			// Never cache failures.
			if (providerCatalogCache?.promise === promise) {
				providerCatalogCache = null;
			}
			throw error;
		});
	providerCatalogCache = { fetchedAt: now, promise };
	return promise;
}

export function invalidateProviderCatalogCache(): void {
	providerCatalogCache = null;
}

export function notifyModeSettingsChanged(mode: ProviderMode): void {
	invalidateProviderCatalogCache();
	if (typeof window !== "undefined") {
		window.dispatchEvent(
			new CustomEvent(MODE_SETTINGS_CHANGED_EVENT, { detail: { mode } }),
		);
	}
}

export async function loadProviderModelCatalog(): Promise<ProviderModelCatalog> {
	const payload = await fetchProviderCatalog();
	return buildProviderModelCatalog(payload.providers ?? [], payload.modes);
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
