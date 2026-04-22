import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as LlmsModels from "@clinebot/llms";
import type { ProviderCapability, ProviderModel } from "@clinebot/shared";
import type { ProviderSettingsManager } from "../storage/provider-settings-manager";

export type StoredModelsFile = {
	version: 1;
	providers: Record<
		string,
		{
			provider: {
				name: string;
				baseUrl: string;
				defaultModelId?: string;
				capabilities?: ProviderCapability[];
				modelsSourceUrl?: string;
			};
			models: Record<
				string,
				{
					id: string;
					name: string;
					supportsVision?: boolean;
					supportsAttachments?: boolean;
					supportsReasoning?: boolean;
				}
			>;
		}
	>;
};

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

export function readModelsFileSync(filePath: string): StoredModelsFile {
	if (!existsSync(filePath)) {
		return emptyModelsFile();
	}
	try {
		const raw = readFileSync(filePath, "utf8");
		const parsed = JSON.parse(raw) as Partial<StoredModelsFile>;
		if (
			parsed &&
			parsed.version === 1 &&
			parsed.providers &&
			typeof parsed.providers === "object"
		) {
			return { version: 1, providers: parsed.providers };
		}
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
		const parsed = JSON.parse(raw) as Partial<StoredModelsFile>;
		if (
			parsed &&
			parsed.version === 1 &&
			parsed.providers &&
			typeof parsed.providers === "object"
		) {
			return { version: 1, providers: parsed.providers };
		}
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
	writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export async function writeModelsFile(
	filePath: string,
	state: StoredModelsFile,
): Promise<void> {
	await mkdir(dirname(filePath), { recursive: true });
	await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
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

/**
 * Custom Provider Registry
 *
 * This module manages the registration of custom OpenAI-compatible providers and
 * their models based on local JSON files. It provides functions to read/write the models
 * registry file and to register providers with the LlmsModels system.
 */
export function registerCustomProvider(
	providerId: string,
	entry: StoredModelsFile["providers"][string],
): void {
	const modelCapabilities = toModelCapabilities(entry.provider.capabilities);
	const modelEntries = Object.values(entry.models)
		.map((model) => model.id.trim())
		.filter((modelId) => modelId.length > 0);
	const defaultModelId =
		entry.provider.defaultModelId?.trim() || modelEntries[0] || "default";
	const normalizedModels = Object.fromEntries(
		modelEntries.map((modelId) => [
			modelId,
			{
				id: modelId,
				name: entry.models[modelId]?.name ?? modelId,
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
			protocol: "openai-chat",
			client: "openai-compatible",
			baseUrl: entry.provider.baseUrl,
			defaultModelId,
			capabilities: toProviderCapabilities(entry.provider.capabilities),
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
