import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as LlmsModels from "@clinebot/llms";
import {
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
} from "@clinebot/shared";
import { z } from "zod";
import type {
	ProviderSettings,
	StoredProviderSettings,
} from "../../types/provider-settings";
import type { ProviderSettingsManager } from "../storage/provider-settings-manager";

export const StoredModelEntrySchema = z
	.object({
		id: z.string().optional(),
		name: z.string().optional(),
		capabilities: z.array(ModelCapabilitySchema).optional(),
		supportsVision: z.boolean().optional(),
		supportsAttachments: z.boolean().optional(),
		supportsReasoning: z.boolean().optional(),
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
		return emptyModelsFile();
	}

	const providers: StoredModelsFile["providers"] = {};
	for (const [providerId, entry] of Object.entries(result.data.providers)) {
		const provider = StoredProviderEntrySchema.safeParse(entry);
		if (provider.success) {
			providers[providerId] = provider.data;
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
		// Invalid or missing files fall back to an empty registry.
	}
	return emptyModelsFile();
}

export async function readModelsFile(
	filePath: string,
): Promise<StoredModelsFile> {
	try {
		const raw = await readFile(filePath, "utf8");
		return parseModelsFile(JSON.parse(raw) as unknown);
	} catch {
		// Invalid or missing files fall back to an empty registry.
	}
	return emptyModelsFile();
}

export function writeModelsFileSync(
	filePath: string,
	state: StoredModelsFile,
): void {
	mkdirSync(dirname(filePath), { recursive: true });
	const parsed = StoredModelsFileSchema.parse(state);
	writeFileSync(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

export async function writeModelsFile(
	filePath: string,
	state: StoredModelsFile,
): Promise<void> {
	await mkdir(dirname(filePath), { recursive: true });
	const parsed = StoredModelsFileSchema.parse(state);
	await writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
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
): ModelInfo {
	const capabilities = new Set<ModelCapability>(model?.capabilities ?? []);
	if (model?.supportsVision) capabilities.add("images");
	if (model?.supportsAttachments) capabilities.add("files");
	if (model?.supportsReasoning) capabilities.add("reasoning");

	return {
		id: modelId,
		name: model?.name ?? modelId,
		capabilities: capabilities.size > 0 ? [...capabilities] : undefined,
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
				id,
				name: model.name ?? id,
				capabilities:
					modelCapabilities.length > 0 ? modelCapabilities : undefined,
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
