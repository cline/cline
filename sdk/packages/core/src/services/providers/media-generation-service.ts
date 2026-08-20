import * as LlmsModels from "@cline/llms";
import {
	type AgentUsage,
	MEDIA_GENERATION_TYPES,
	type MediaContent,
	type MediaGenerationModelCatalog,
	type MediaGenerationSettings,
	type MediaGenerationType,
	type MediaModelSelection,
	modelProducesImages,
	type TextContent,
} from "@cline/shared";
import type {
	ModelInfo,
	ProviderConfig,
} from "../../services/llms/provider-settings";
import type { ProviderSettingsManager } from "../storage/provider-settings-manager";
import { resolveProviderModelMap } from "./provider-model-map";

/**
 * Media-generation concerns for locally configured providers: model
 * eligibility, selection resolution, the authoritative model catalog,
 * settings persistence, and execution. Image is the only executable media
 * type; audio and video participate only through the extensible
 * configuration contract.
 */

export interface GenerateConfiguredMediaRequest {
	mediaType: "image";
	prompt: string;
	abortSignal?: AbortSignal;
}

export interface GenerateConfiguredMediaResult {
	content: Array<TextContent | MediaContent>;
	usage?: AgentUsage;
}

export interface ResolvedMediaGenerationTarget {
	mediaType: "image";
	selection: MediaModelSelection;
	providerConfig: ProviderConfig;
	model: ModelInfo;
}

// --- Eligibility ---

/**
 * Whether a catalog model is image-generation eligible and has an executable
 * provider operation. Explicit image-generation models remain eligible when
 * external modality metadata is stale; mixed language models must advertise
 * text input and image output. The transport check deliberately fails closed
 * for providers without a matching image-capable operation.
 */
export function isUsableImageGenerationModel(
	providerId: string,
	model: ModelInfo,
): boolean {
	const operation = model.operation ?? "language";
	if (operation !== "language" && operation !== "image-generation") {
		return false;
	}
	if (operation !== "image-generation" && !modelProducesImages(model)) {
		return false;
	}
	const family = model.metadata?.family;
	return LlmsModels.builtinProviderSupportsModelOperation({
		providerId,
		modelId: model.id,
		operation: model.operation,
		operationModes: model.operationModes,
		modalities: model.modalities,
		family: typeof family === "string" ? family : undefined,
		capabilities: model.capabilities,
	});
}

// --- Catalog ---

/**
 * Build the server-authoritative media-generation model catalog: for every
 * provider, the model IDs eligible per media type. Clients must not offer
 * selections outside this catalog.
 */
export function buildMediaGenerationModelCatalog(
	entries: ReadonlyArray<{
		providerId: string;
		models: Record<string, ModelInfo>;
	}>,
): MediaGenerationModelCatalog {
	const imageModelsByProvider: Record<string, string[]> = {};
	for (const entry of entries) {
		imageModelsByProvider[entry.providerId] = Object.entries(entry.models)
			.filter(([, model]) =>
				isUsableImageGenerationModel(entry.providerId, model),
			)
			.map(([modelId]) => modelId)
			.sort((a, b) => a.localeCompare(b));
	}
	return {
		audio: {},
		image: imageModelsByProvider,
		video: {},
	};
}

// --- Resolution ---

async function resolveMediaGenerationSelection(
	manager: ProviderSettingsManager,
	mediaType: MediaGenerationType,
	selection: MediaModelSelection | undefined,
): Promise<ResolvedMediaGenerationTarget | undefined> {
	if (mediaType !== "image") return undefined;
	if (!selection) return undefined;

	const providerId = selection.providerId.trim();
	const modelId = selection.modelId.trim();
	if (!providerId || !modelId) return undefined;

	try {
		const state = manager.read();
		if (!state.providers[providerId]) return undefined;
		const config = manager.getProviderConfig(providerId, {
			includeKnownModels: false,
		});
		if (!config) return undefined;

		const modelMap = await resolveProviderModelMap(providerId, config);
		const model = modelMap[modelId];
		if (!model || !isUsableImageGenerationModel(providerId, model)) {
			return undefined;
		}

		return {
			mediaType,
			selection: { providerId, modelId },
			providerConfig: {
				...config,
				modelId,
				modelInfo: model,
				knownModels: {
					...(config.knownModels ?? {}),
					[modelId]: model,
				},
			},
			model,
		};
	} catch {
		return undefined;
	}
}

/** Resolve a currently executable configured media target without mutating settings. */
export async function resolveConfiguredMediaGenerationTarget(
	manager: ProviderSettingsManager,
	mediaType: MediaGenerationType,
): Promise<ResolvedMediaGenerationTarget | undefined> {
	try {
		return await resolveMediaGenerationSelection(
			manager,
			mediaType,
			manager.getMediaGenerationSettings()?.[mediaType],
		);
	} catch {
		return undefined;
	}
}

/**
 * Resolve the persisted media selections that are currently executable and
 * whose provider is enabled. Stale selections are omitted from the result
 * (so clients render "setup required") but are never mutated here.
 */
export async function resolveActiveMediaGenerationSettings(
	manager: ProviderSettingsManager,
	enabledProviderIds: ReadonlySet<string>,
): Promise<MediaGenerationSettings | undefined> {
	const resolvedImageTarget = await resolveConfiguredMediaGenerationTarget(
		manager,
		"image",
	);
	if (
		!resolvedImageTarget ||
		!enabledProviderIds.has(resolvedImageTarget.selection.providerId)
	) {
		return undefined;
	}
	return { image: resolvedImageTarget.selection };
}

// --- Persistence ---

export async function saveMediaGenerationSettings(
	manager: ProviderSettingsManager,
	mediaType: MediaGenerationType,
	selection: MediaModelSelection | undefined,
): Promise<{
	settingsPath: string;
	mediaGeneration?: MediaGenerationSettings;
}> {
	if (mediaType !== "image") {
		throw new Error(
			`Media generation type "${mediaType}" is not supported yet`,
		);
	}

	const current = { ...manager.getMediaGenerationSettings() };
	if (!selection) {
		delete current[mediaType];
		const mediaGeneration =
			Object.keys(current).length > 0 ? current : undefined;
		manager.setMediaGenerationSettings(mediaGeneration);
		return { settingsPath: manager.getFilePath(), mediaGeneration };
	}

	const providerId = selection.providerId.trim();
	const modelId = selection.modelId.trim();
	if (!providerId || !modelId) {
		throw new Error("Image generation provider and model are required");
	}
	const target = await resolveMediaGenerationSelection(manager, "image", {
		providerId,
		modelId,
	});
	if (!target) {
		throw new Error(
			`Model "${modelId}" is not an executable image-generation model for provider "${providerId}"`,
		);
	}

	const mediaGeneration = { ...current, [mediaType]: target.selection };
	manager.setMediaGenerationSettings(mediaGeneration);
	return { settingsPath: manager.getFilePath(), mediaGeneration };
}

/**
 * Drop persisted media selections that reference a provider being removed
 * or disabled. Mutates the passed settings state in place and reports
 * whether anything changed; the caller owns persisting the state.
 */
export function clearMediaGenerationSelections(
	state: ReturnType<ProviderSettingsManager["read"]>,
	providerId: string,
): boolean {
	let mutated = false;
	const mediaGeneration = state.modes.mediaGeneration;
	for (const mediaType of MEDIA_GENERATION_TYPES) {
		if (mediaGeneration?.[mediaType]?.providerId !== providerId) {
			continue;
		}
		delete mediaGeneration[mediaType];
		if (Object.keys(mediaGeneration).length === 0) {
			delete state.modes.mediaGeneration;
		}
		mutated = true;
	}
	return mutated;
}

// --- Execution ---

/**
 * Generate media with the provider and model selected in server-side settings.
 *
 * The selection is revalidated immediately before each request so a removed,
 * disabled, or newly incompatible model cannot be invoked from stale session
 * state. Provider credentials never enter the tool input or result.
 */
export async function generateConfiguredMedia(
	manager: ProviderSettingsManager,
	request: GenerateConfiguredMediaRequest,
): Promise<GenerateConfiguredMediaResult> {
	const target = await resolveConfiguredMediaGenerationTarget(
		manager,
		request.mediaType,
	);
	if (!target) {
		throw new Error(
			"The configured image generation provider or model is unavailable; choose one in Settings",
		);
	}

	const result = await LlmsModels.generateMedia({
		providerConfig: target.providerConfig,
		modelId: target.selection.modelId,
		prompt: request.prompt,
		mediaType: request.mediaType,
		abortSignal: request.abortSignal,
	});

	const mediaLabel = result.media.length === 1 ? "image" : "images";
	return {
		content: [
			{
				type: "text",
				text: `Generated ${result.media.length} ${mediaLabel} with ${target.selection.providerId}/${target.selection.modelId}.`,
			},
			...result.media.map((media): MediaContent => ({ type: "media", media })),
		],
		...(result.usage ? { usage: result.usage } : {}),
	};
}
