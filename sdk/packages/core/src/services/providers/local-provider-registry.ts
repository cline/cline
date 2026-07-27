import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as LlmsModels from "@cline/llms";
import {
	ApiFormatSchema,
	type ModelCapability,
	ModelCapabilitySchema,
	type ModelInfo,
	type ProviderCapability,
	ProviderCapabilitySchema,
	type ProviderClient,
	ProviderClientSchema,
	type ProviderModel,
	type ProviderProtocol,
	ProviderProtocolSchema,
} from "@cline/shared";
import { z } from "zod";
import { sdkDebug } from "../../logging/early-logger";
import type {
	ProviderSettings,
	StoredProviderSettings,
} from "../../types/provider-settings";
import type { ProviderSettingsManager } from "../storage/provider-settings-manager";

const OptionalPositiveFiniteNumberSchema = z
	.number()
	.finite()
	.positive()
	.optional()
	.catch(undefined);
const OptionalNonNegativeFiniteNumberSchema = z
	.number()
	.finite()
	.nonnegative()
	.optional()
	.catch(undefined);

export const StoredModelEntrySchema = z
	.object({
		id: z.string().optional(),
		name: z.string().optional(),
		maxTokens: OptionalPositiveFiniteNumberSchema,
		contextWindow: OptionalPositiveFiniteNumberSchema,
		maxInputTokens: OptionalPositiveFiniteNumberSchema,
		capabilities: z.array(ModelCapabilitySchema).optional(),
		supportsVision: z.boolean().optional(),
		supportsAttachments: z.boolean().optional(),
		supportsReasoning: z.boolean().optional(),
		inputPrice: OptionalNonNegativeFiniteNumberSchema,
		outputPrice: OptionalNonNegativeFiniteNumberSchema,
		cacheReadsPrice: OptionalNonNegativeFiniteNumberSchema,
		cacheWritesPrice: OptionalNonNegativeFiniteNumberSchema,
		temperature: OptionalNonNegativeFiniteNumberSchema,
		apiFormat: ApiFormatSchema.optional(),
		isR1FormatRequired: z.boolean().optional(),
	})
	.passthrough();

export type StoredModelEntry = z.infer<typeof StoredModelEntrySchema>;

export const StoredProviderMetadataSchema = z
	.object({
		name: z.string(),
		baseUrl: z.string(),
		defaultModelId: z.string().optional(),
		protocol: ProviderProtocolSchema.optional(),
		client: ProviderClientSchema.optional(),
		capabilities: z.array(ProviderCapabilitySchema).optional(),
		modelsSourceUrl: z.string().optional(),
	})
	.passthrough();

export const StoredProviderEntrySchema = z
	.object({
		provider: StoredProviderMetadataSchema.optional(),
		models: z.record(z.string(), StoredModelEntrySchema).optional(),
	})
	.passthrough();

export type StoredProviderEntry = z.infer<typeof StoredProviderEntrySchema>;

export const StoredModelsFileSchema = z.object({
	version: z.literal(1),
	providers: z.record(z.string(), StoredProviderEntrySchema),
});

export type StoredModelsFile = z.infer<typeof StoredModelsFileSchema>;

const StoredModelsFileEnvelopeSchema = z.object({
	version: z.literal(1),
	providers: z.record(z.string(), z.unknown()),
});

const LOADED_MODELS_REGISTRY_PATHS = new Set<string>();

function titleCaseFromId(id: string): string {
	return id
		.split(/[-_]/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

export function resolveModelsRegistryPath(
	manager: ProviderSettingsManager,
): string {
	return join(dirname(manager.getFilePath()), "models.json");
}

export function emptyModelsFile(): StoredModelsFile {
	return { version: 1, providers: {} };
}

export function parseModelsFile(input: unknown): StoredModelsFile {
	const result = StoredModelsFileEnvelopeSchema.safeParse(input);
	if (!result.success) {
		sdkDebug(
			"models.json content is not a valid models file envelope; starting from an empty registry",
		);
		return emptyModelsFile();
	}

	const providers: StoredModelsFile["providers"] = {};
	for (const [providerId, entry] of Object.entries(result.data.providers)) {
		const provider = StoredProviderEntrySchema.safeParse(entry);
		if (provider.success) {
			providers[providerId] = provider.data;
		} else {
			sdkDebug(
				`models.json: dropping invalid entry for provider=${providerId}`,
			);
		}
	}
	return { version: 1, providers };
}

export function readModelsFileSync(filePath: string): StoredModelsFile {
	if (!existsSync(filePath)) {
		return emptyModelsFile();
	}
	try {
		const raw = readFileSync(filePath, "utf8");
		return parseModelsFile(JSON.parse(raw) as unknown);
	} catch {
		// The file exists but could not be read/parsed. Falling back to an
		// empty registry is required for reads, but callers that then WRITE
		// the empty state back would permanently destroy the user's data —
		// leave a trace so that is diagnosable.
		sdkDebug(
			`models.json at ${filePath} exists but is unreadable or invalid JSON; treating as an empty registry`,
		);
	}
	return emptyModelsFile();
}

export async function readModelsFile(
	filePath: string,
): Promise<StoredModelsFile> {
	try {
		const raw = await readFile(filePath, "utf8");
		return parseModelsFile(JSON.parse(raw) as unknown);
	} catch (error) {
		if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
			sdkDebug(
				`models.json at ${filePath} exists but is unreadable or invalid JSON; treating as an empty registry`,
			);
		}
	}
	return emptyModelsFile();
}

// Stage to a pid-unique temp file and rename into place (mirrors
// ProviderSettingsManager.write). Concurrent Cline processes (CLI, extension,
// hub) share models.json; a bare writeFileSync lets readers catch a partial
// file, which read paths treat as an empty registry — and the next
// read-modify-write would persist that loss.
export function writeModelsFileSync(
	filePath: string,
	state: StoredModelsFile,
): void {
	mkdirSync(dirname(filePath), { recursive: true });
	const parsed = StoredModelsFileSchema.parse(state);
	const tempPath = `${filePath}.${process.pid}.tmp`;
	try {
		writeFileSync(tempPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
		renameSync(tempPath, filePath);
	} catch (error) {
		rmSync(tempPath, { force: true });
		throw error;
	}
}

export async function writeModelsFile(
	filePath: string,
	state: StoredModelsFile,
): Promise<void> {
	await mkdir(dirname(filePath), { recursive: true });
	const parsed = StoredModelsFileSchema.parse(state);
	const tempPath = `${filePath}.${process.pid}.tmp`;
	try {
		await writeFile(tempPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
		await rename(tempPath, filePath);
	} catch (error) {
		await rm(tempPath, { force: true }).catch(() => {});
		throw error;
	}
}

export function toProviderModel(
	modelId: string,
	info: {
		name?: string;
		capabilities?: string[];
		thinkingConfig?: unknown;
	},
): ProviderModel {
	return {
		id: modelId,
		name: info.name ?? modelId,
		supportsAttachments: info.capabilities?.includes("files"),
		supportsVision: info.capabilities?.includes("images"),
		supportsReasoning:
			info.capabilities?.includes("reasoning") || info.thinkingConfig != null,
	};
}

function toProviderCapabilities(
	capabilities: ProviderCapability[] | undefined,
): Array<"reasoning" | "prompt-cache" | "tools"> | undefined {
	if (!capabilities || capabilities.length === 0) {
		return undefined;
	}
	const next = new Set<"reasoning" | "prompt-cache" | "tools">();
	if (capabilities.includes("reasoning")) {
		next.add("reasoning");
	}
	if (capabilities.includes("prompt-cache")) {
		next.add("prompt-cache");
	}
	if (capabilities.includes("tools")) {
		next.add("tools");
	}
	return next.size > 0 ? [...next] : undefined;
}

function toModelCapabilities(
	capabilities: ProviderCapability[] | undefined,
): Array<
	"streaming" | "tools" | "reasoning" | "prompt-cache" | "images" | "files"
> {
	const next = new Set<
		"streaming" | "tools" | "reasoning" | "prompt-cache" | "images" | "files"
	>();
	if (!capabilities || capabilities.length === 0) {
		return [...next];
	}
	if (capabilities.includes("streaming")) next.add("streaming");
	if (capabilities.includes("tools")) next.add("tools");
	if (capabilities.includes("reasoning")) next.add("reasoning");
	if (capabilities.includes("prompt-cache")) next.add("prompt-cache");
	if (capabilities.includes("vision")) {
		next.add("images");
		next.add("files");
	}
	return [...next];
}

function isCompleteProviderMetadata(
	provider: StoredProviderEntry["provider"],
): provider is NonNullable<StoredProviderEntry["provider"]> {
	return (
		provider != null &&
		typeof provider.name === "string" &&
		typeof provider.baseUrl === "string"
	);
}

function resolveProviderProtocol(
	protocol: ProviderProtocol | undefined,
	fallback: ProviderProtocol | undefined,
): ProviderProtocol {
	return protocol ?? fallback ?? "openai-chat";
}

function resolveProviderClient(
	client: ProviderClient | undefined,
	protocol: ProviderProtocol,
	fallback: ProviderClient | undefined,
): ProviderClient {
	return (
		client ??
		fallback ??
		(protocol === "openai-responses" ? "openai" : "openai-compatible")
	);
}

function toStoredModelInfo(
	modelId: string,
	model: StoredModelEntry | undefined,
	fallbackCapabilities?: ModelInfo["capabilities"],
): ModelInfo {
	const capabilities = new Set<ModelCapability>(
		model?.capabilities ?? fallbackCapabilities ?? [],
	);
	if (model?.supportsVision !== undefined) {
		if (model.supportsVision) capabilities.add("images");
		else capabilities.delete("images");
	}
	if (model?.supportsAttachments !== undefined) {
		if (model.supportsAttachments) capabilities.add("files");
		else capabilities.delete("files");
	}
	if (model?.supportsReasoning !== undefined) {
		if (model.supportsReasoning) capabilities.add("reasoning");
		else capabilities.delete("reasoning");
	}

	const apiFormat = model?.isR1FormatRequired ? "r1" : model?.apiFormat;
	const hasPricing =
		model?.inputPrice !== undefined ||
		model?.outputPrice !== undefined ||
		model?.cacheReadsPrice !== undefined ||
		model?.cacheWritesPrice !== undefined;
	return {
		id: modelId,
		name: model?.name ?? modelId,
		...(model?.maxTokens !== undefined ? { maxTokens: model.maxTokens } : {}),
		...(model?.contextWindow !== undefined
			? { contextWindow: model.contextWindow }
			: {}),
		...(model?.maxInputTokens !== undefined
			? { maxInputTokens: model.maxInputTokens }
			: {}),
		...(capabilities.size > 0 ? { capabilities: [...capabilities] } : {}),
		...(model?.temperature !== undefined
			? { temperature: model.temperature }
			: {}),
		...(apiFormat !== undefined ? { apiFormat } : {}),
		...(hasPricing
			? {
					pricing: {
						...(model?.inputPrice !== undefined
							? { input: model.inputPrice }
							: {}),
						...(model?.outputPrice !== undefined
							? { output: model.outputPrice }
							: {}),
						...(model?.cacheReadsPrice !== undefined
							? { cacheRead: model.cacheReadsPrice }
							: {}),
						...(model?.cacheWritesPrice !== undefined
							? { cacheWrite: model.cacheWritesPrice }
							: {}),
					},
				}
			: {}),
	};
}

function registerCustomModels(
	providerId: string,
	models: StoredProviderEntry["models"] | undefined,
): void {
	for (const [modelKey, model] of Object.entries(models ?? {})) {
		const modelId = model.id?.trim() || modelKey.trim();
		if (!modelId) {
			continue;
		}
		LlmsModels.registerModel(
			providerId,
			modelId,
			toStoredModelInfo(modelId, model),
		);
	}
}

function modelInfoWithDefaults(
	modelId: string,
	info: ModelInfo | undefined,
	capabilities: ModelInfo["capabilities"] | undefined,
): ModelInfo {
	return {
		...(info ?? {}),
		id: modelId,
		name: info?.name ?? modelId,
		capabilities: info?.capabilities ?? capabilities,
	};
}

function getGeneratedModelsForProvider(
	providerId: string,
): Record<string, ModelInfo> {
	const generated = Object.assign(
		{},
		...LlmsModels.resolveProviderModelCatalogKeys(providerId).map(
			(catalogKey) => LlmsModels.getGeneratedModelsForProvider(catalogKey),
		),
	);
	return generated as Record<string, ModelInfo>;
}

export function registerProviderSettingsProvider(
	settings: ProviderSettings,
): void {
	const providerId = settings.provider.trim();
	if (!providerId || LlmsModels.isBuiltInProviderId(providerId)) {
		return;
	}

	const baseUrl = settings.baseUrl?.trim();
	if (!baseUrl) {
		return;
	}

	const existingCollection = LlmsModels.MODEL_COLLECTIONS_BY_PROVIDER_ID[
		providerId
	] as LlmsModels.ModelCollection | undefined;
	const generatedModels = getGeneratedModelsForProvider(providerId);
	const modelCapabilities = toModelCapabilities(settings.capabilities);
	const fallbackCapabilities =
		modelCapabilities.length > 0 ? modelCapabilities : undefined;
	const modelId = settings.model?.trim();
	const models: Record<string, ModelInfo> = {
		...generatedModels,
		...(existingCollection?.models ?? {}),
	};

	if (modelId) {
		models[modelId] = modelInfoWithDefaults(
			modelId,
			models[modelId],
			fallbackCapabilities,
		);
	}

	const modelIds = Object.keys(models).filter(Boolean);
	const defaultModelId = modelId || modelIds[0];
	if (!defaultModelId) {
		return;
	}
	const protocol = resolveProviderProtocol(
		settings.protocol,
		existingCollection?.provider.protocol,
	);
	const client = resolveProviderClient(
		settings.client,
		protocol,
		existingCollection?.provider.client,
	);

	LlmsModels.registerProvider({
		provider: {
			id: providerId,
			name: existingCollection?.provider.name ?? titleCaseFromId(providerId),
			description: existingCollection?.provider.description,
			protocol,
			client,
			baseUrl,
			modelsSourceUrl: existingCollection?.provider.modelsSourceUrl,
			defaultModelId,
			capabilities:
				toProviderCapabilities(settings.capabilities) ??
				existingCollection?.provider.capabilities,
			source: "file",
		},
		models,
	});
}

export function registerConfiguredProvidersFromSettings(
	state: StoredProviderSettings,
): void {
	for (const entry of Object.values(state.providers)) {
		registerProviderSettingsProvider(entry.settings);
	}
}

/**
 * Custom Provider Registry
 *
 * This module manages the registration of custom OpenAI-compatible providers and
 * their models based on local JSON files. It provides functions to read/write the models
 * registry file and to register providers with the LlmsModels system.
 */
export function registerCustomProvider(
	providerId: string,
	entry: StoredProviderEntry,
): void {
	const storedModels = entry.models ?? {};
	if (!isCompleteProviderMetadata(entry.provider)) {
		registerCustomModels(providerId, storedModels);
		return;
	}

	const modelCapabilities = toModelCapabilities(entry.provider.capabilities);
	const modelEntries = Object.entries(storedModels)
		.map(([modelKey, model]) => ({
			id: model.id?.trim() || modelKey.trim(),
			model,
		}))
		.filter(({ id }) => id.length > 0);
	const defaultModelId =
		entry.provider.defaultModelId?.trim() || modelEntries[0]?.id || "default";
	const protocol = resolveProviderProtocol(entry.provider.protocol, undefined);
	const client = resolveProviderClient(
		entry.provider.client,
		protocol,
		undefined,
	);
	const normalizedModels = Object.fromEntries(
		modelEntries.map(({ id, model }) => [
			id,
			{
				...toStoredModelInfo(
					id,
					model,
					modelCapabilities.length > 0 ? modelCapabilities : undefined,
				),
				status: "active" as const,
			},
		]),
	);

	LlmsModels.registerProvider({
		provider: {
			id: providerId,
			name: entry.provider.name.trim() || titleCaseFromId(providerId),
			protocol,
			client,
			baseUrl: entry.provider.baseUrl,
			modelsSourceUrl: entry.provider.modelsSourceUrl,
			defaultModelId,
			capabilities: toProviderCapabilities(entry.provider.capabilities),
			source: "file",
		},
		models: normalizedModels,
	});
}

/**
 * Apply a single provider's updated models.json entry to the live @cline/llms
 * registry. Unlike {@link ensureCustomProvidersLoadedSync}, which loads a
 * models.json path at most once per process, this applies on every call so
 * writes made after startup are reflected immediately: models removed from the
 * entry are unregistered, and the remaining entry is (re-)registered.
 */
export function syncStoredProviderRegistration(
	providerId: string,
	previous: StoredProviderEntry | undefined,
	next: StoredProviderEntry | undefined,
): void {
	const nextModels = next?.models ?? {};
	const removedModelIds = new Set<string>();
	for (const [modelKey, model] of Object.entries(previous?.models ?? {})) {
		if (Object.hasOwn(nextModels, modelKey)) {
			continue;
		}
		const modelId = model.id?.trim() || modelKey.trim();
		if (modelId) {
			removedModelIds.add(modelId);
			LlmsModels.unregisterModel(providerId, modelId);
		}
	}
	if (!next) {
		return;
	}
	const liveCollection = LlmsModels.getProviderCollectionSync(providerId);
	registerCustomProvider(providerId, next);
	// For entries with complete provider metadata, registerCustomProvider
	// replaces the live collection with one built from models.json alone.
	// Merge back models that came from other sources (generated catalog,
	// providers.json settings), letting the fresh models.json entries win and
	// dropping models removed by this write.
	const registered = LlmsModels.getProviderCollectionSync(providerId);
	if (liveCollection && registered && registered !== liveCollection) {
		const preservedModels = Object.fromEntries(
			Object.entries(liveCollection.models).filter(
				([modelId]) => !removedModelIds.has(modelId),
			),
		);
		LlmsModels.registerProvider({
			...registered,
			models: { ...preservedModels, ...registered.models },
		});
	}
}

/**
 * Load models.json into the @cline/llms registry at most once per path per
 * process; subsequent calls are no-ops. It does NOT re-read the file after
 * writes — use {@link syncStoredProviderRegistration} to reflect a write in
 * the live registry.
 */
export function ensureCustomProvidersLoadedSync(
	manager: ProviderSettingsManager,
): void {
	const modelsPath = resolveModelsRegistryPath(manager);
	if (LOADED_MODELS_REGISTRY_PATHS.has(modelsPath)) {
		return;
	}
	const state = readModelsFileSync(modelsPath);
	for (const [providerId, entry] of Object.entries(state.providers)) {
		registerCustomProvider(providerId, entry);
	}
	LOADED_MODELS_REGISTRY_PATHS.add(modelsPath);
}

export async function ensureCustomProvidersLoaded(
	manager: ProviderSettingsManager,
): Promise<void> {
	const modelsPath = resolveModelsRegistryPath(manager);
	if (LOADED_MODELS_REGISTRY_PATHS.has(modelsPath)) {
		return;
	}
	const state = await readModelsFile(modelsPath);
	for (const [providerId, entry] of Object.entries(state.providers)) {
		registerCustomProvider(providerId, entry);
	}
	LOADED_MODELS_REGISTRY_PATHS.add(modelsPath);
}
