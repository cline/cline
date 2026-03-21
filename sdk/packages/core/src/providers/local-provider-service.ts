import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { LlmsModels, type LlmsProviders } from "@clinebot/llms";
import type {
	RpcAddProviderActionRequest,
	RpcOAuthProviderId,
	RpcProviderCapability,
	RpcProviderListItem,
	RpcProviderModel,
	RpcSaveProviderSettingsActionRequest,
} from "@clinebot/shared";
import { createOAuthClientCallbacks } from "../auth/client";
import { loginClineOAuth } from "../auth/cline";
import { loginOpenAICodex } from "../auth/codex";
import { loginOcaOAuth } from "../auth/oca";
import type { ProviderSettingsManager } from "../storage/provider-settings-manager";

type StoredModelsFile = {
	version: 1;
	providers: Record<
		string,
		{
			provider: {
				name: string;
				baseUrl: string;
				defaultModelId?: string;
				capabilities?: RpcProviderCapability[];
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

function resolveVisibleApiKey(settings: {
	apiKey?: string;
	auth?: {
		apiKey?: string;
	};
}): string | undefined {
	return settings.apiKey ?? settings.auth?.apiKey;
}

function hasOAuthAccessToken(settings: {
	auth?: {
		accessToken?: string;
	};
}): boolean {
	return (settings.auth?.accessToken?.trim() ?? "").length > 0;
}

function titleCaseFromId(id: string): string {
	return id
		.split(/[-_]/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function createLetter(name: string): string {
	const parts = name
		.split(/\s+/)
		.map((part) => part.trim())
		.filter(Boolean);
	if (parts.length === 0) {
		return "?";
	}
	if (parts.length === 1) {
		return parts[0].slice(0, 2).toUpperCase();
	}
	return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function stableColor(id: string): string {
	const palette = [
		"#c4956a",
		"#6b8aad",
		"#e8963a",
		"#5b9bd5",
		"#6bbd7b",
		"#9b7dd4",
		"#d07f68",
		"#57a6a1",
	];
	let hash = 0;
	for (const ch of id) {
		hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
	}
	return palette[hash % palette.length];
}

function resolveModelsRegistryPath(manager: ProviderSettingsManager): string {
	return join(dirname(manager.getFilePath()), "models.json");
}

function emptyModelsFile(): StoredModelsFile {
	return { version: 1, providers: {} };
}

async function readModelsFile(filePath: string): Promise<StoredModelsFile> {
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

async function writeModelsFile(
	filePath: string,
	state: StoredModelsFile,
): Promise<void> {
	await mkdir(dirname(filePath), { recursive: true });
	await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function toRpcProviderModel(
	modelId: string,
	info: {
		name?: string;
		capabilities?: string[];
		thinkingConfig?: unknown;
	},
): RpcProviderModel {
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
	capabilities: RpcProviderCapability[] | undefined,
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
	capabilities: RpcProviderCapability[] | undefined,
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

function registerCustomProvider(
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
			baseUrl: entry.provider.baseUrl,
			defaultModelId,
			capabilities: toProviderCapabilities(entry.provider.capabilities),
		},
		models: normalizedModels,
	});
}

let customProvidersLoaded = false;

export async function ensureCustomProvidersLoaded(
	manager: ProviderSettingsManager,
): Promise<void> {
	if (customProvidersLoaded) {
		return;
	}
	const modelsPath = resolveModelsRegistryPath(manager);
	const state = await readModelsFile(modelsPath);
	for (const [providerId, entry] of Object.entries(state.providers)) {
		registerCustomProvider(providerId, entry);
	}
	customProvidersLoaded = true;
}

function parseModelIdList(input: unknown): string[] {
	if (Array.isArray(input)) {
		return input
			.map((item) => {
				if (typeof item === "string") return item.trim();
				if (item && typeof item === "object" && "id" in item) {
					const id = (item as { id?: unknown }).id;
					return typeof id === "string" ? id.trim() : "";
				}
				return "";
			})
			.filter((id) => id.length > 0);
	}
	return [];
}

function extractModelIdsFromPayload(
	payload: unknown,
	providerId: string,
): string[] {
	const rootArray = parseModelIdList(payload);
	if (rootArray.length > 0) return rootArray;
	if (!payload || typeof payload !== "object") return [];
	const data = payload as {
		data?: unknown;
		models?: unknown;
		providers?: Record<string, unknown>;
	};
	const direct = parseModelIdList(data.data ?? data.models);
	if (direct.length > 0) return direct;
	if (
		data.models &&
		typeof data.models === "object" &&
		!Array.isArray(data.models)
	) {
		const modelKeys = Object.keys(data.models).filter(
			(key) => key.trim().length > 0,
		);
		if (modelKeys.length > 0) return modelKeys;
	}
	const providerScoped = data.providers?.[providerId];
	if (providerScoped && typeof providerScoped === "object") {
		const nested = providerScoped as { models?: unknown };
		const nestedList = parseModelIdList(nested.models ?? providerScoped);
		if (nestedList.length > 0) return nestedList;
	}
	return [];
}

async function fetchModelIdsFromSource(
	url: string,
	providerId: string,
): Promise<string[]> {
	const response = await fetch(url, { method: "GET" });
	if (!response.ok) {
		throw new Error(
			`failed to fetch models from ${url}: HTTP ${response.status}`,
		);
	}
	const payload = (await response.json()) as unknown;
	return extractModelIdsFromPayload(payload, providerId);
}

export async function addLocalProvider(
	manager: ProviderSettingsManager,
	request: RpcAddProviderActionRequest,
): Promise<{
	providerId: string;
	settingsPath: string;
	modelsPath: string;
	modelsCount: number;
}> {
	const providerId = request.providerId.trim().toLowerCase();
	if (!providerId) throw new Error("providerId is required");
	if (LlmsModels.hasProvider(providerId)) {
		throw new Error(`provider "${providerId}" already exists`);
	}
	const providerName = request.name.trim();
	if (!providerName) throw new Error("name is required");
	const baseUrl = request.baseUrl.trim();
	if (!baseUrl) throw new Error("baseUrl is required");

	const typedModels = (request.models ?? [])
		.map((model) => model.trim())
		.filter((model) => model.length > 0);
	const sourceUrl = request.modelsSourceUrl?.trim();
	const fetchedModels = sourceUrl
		? await fetchModelIdsFromSource(sourceUrl, providerId)
		: [];
	const modelIds = [...new Set([...typedModels, ...fetchedModels])];
	if (modelIds.length === 0) {
		throw new Error(
			"at least one model is required (manual or via modelsSourceUrl)",
		);
	}

	const defaultModelId =
		request.defaultModelId?.trim() &&
		modelIds.includes(request.defaultModelId.trim())
			? request.defaultModelId.trim()
			: modelIds[0];
	const capabilities = request.capabilities?.length
		? [...new Set(request.capabilities)]
		: undefined;
	const headerEntries = Object.entries(request.headers ?? {}).filter(
		([key]) => key.trim().length > 0,
	);

	manager.saveProviderSettings(
		{
			provider: providerId,
			apiKey: request.apiKey?.trim() ? request.apiKey : undefined,
			baseUrl,
			headers:
				headerEntries.length > 0
					? Object.fromEntries(headerEntries)
					: undefined,
			timeout: request.timeoutMs,
			model: defaultModelId,
		},
		{ setLastUsed: false },
	);

	const modelsPath = resolveModelsRegistryPath(manager);
	const modelsState = await readModelsFile(modelsPath);
	const supportsVision = capabilities?.includes("vision") ?? false;
	const supportsAttachments = supportsVision;
	const supportsReasoning = capabilities?.includes("reasoning") ?? false;
	modelsState.providers[providerId] = {
		provider: {
			name: providerName,
			baseUrl,
			defaultModelId,
			capabilities,
			modelsSourceUrl: sourceUrl,
		},
		models: Object.fromEntries(
			modelIds.map((modelId) => [
				modelId,
				{
					id: modelId,
					name: modelId,
					supportsVision,
					supportsAttachments,
					supportsReasoning,
				},
			]),
		),
	};
	await writeModelsFile(modelsPath, modelsState);
	registerCustomProvider(providerId, modelsState.providers[providerId]);

	return {
		providerId,
		settingsPath: manager.getFilePath(),
		modelsPath,
		modelsCount: modelIds.length,
	};
}

export async function listLocalProviders(
	manager: ProviderSettingsManager,
): Promise<{
	providers: RpcProviderListItem[];
	settingsPath: string;
}> {
	const state = manager.read();
	const ids = LlmsModels.getProviderIds().sort((a, b) => a.localeCompare(b));
	const providerItems = await Promise.all(
		ids.map(async (id): Promise<RpcProviderListItem> => {
			const info = await LlmsModels.getProvider(id);
			const providerModels = await getLocalProviderModels(id);
			const persistedSettings = state.providers[id]?.settings;
			const providerName = info?.name ?? titleCaseFromId(id);
			return {
				id,
				name: providerName,
				models: providerModels.models.length,
				color: stableColor(id),
				letter: createLetter(providerName),
				enabled: Boolean(persistedSettings),
				apiKey: persistedSettings
					? resolveVisibleApiKey(persistedSettings)
					: undefined,
				oauthAccessTokenPresent: persistedSettings
					? hasOAuthAccessToken(persistedSettings)
					: undefined,
				baseUrl: persistedSettings?.baseUrl ?? info?.baseUrl,
				defaultModelId: info?.defaultModelId,
				authDescription: "This provider uses API keys for authentication.",
				baseUrlDescription: "The base endpoint to use for provider requests.",
				modelList: providerModels.models,
			};
		}),
	);

	return {
		providers: providerItems,
		settingsPath: manager.getFilePath(),
	};
}

export async function getLocalProviderModels(
	providerId: string,
): Promise<{ providerId: string; models: RpcProviderModel[] }> {
	const id = providerId.trim();
	const modelMap = await LlmsModels.getModelsForProvider(id);
	const items = Object.entries(modelMap)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([modelId, info]) => toRpcProviderModel(modelId, info));
	return {
		providerId: id,
		models: items,
	};
}

export function saveLocalProviderSettings(
	manager: ProviderSettingsManager,
	request: RpcSaveProviderSettingsActionRequest,
): { providerId: string; enabled: boolean; settingsPath: string } {
	const providerId = request.providerId.trim();
	const state = manager.read();

	if (request.enabled === false) {
		delete state.providers[providerId];
		if (state.lastUsedProvider === providerId) {
			delete state.lastUsedProvider;
		}
		manager.write(state);
		return {
			providerId,
			enabled: false,
			settingsPath: manager.getFilePath(),
		};
	}

	const existing = manager.getProviderSettings(providerId);
	const nextSettings: Record<string, unknown> = {
		...(existing ?? {}),
		provider: providerId,
	};

	const hasApiKeyUpdate =
		Object.hasOwn(request, "apiKey") && typeof request.apiKey === "string";
	if (hasApiKeyUpdate) {
		const apiKey = request.apiKey?.trim() ?? "";
		if (apiKey.length === 0) {
			delete nextSettings.apiKey;
		} else {
			nextSettings.apiKey = request.apiKey;
		}
	}

	const hasBaseUrlUpdate =
		Object.hasOwn(request, "baseUrl") && typeof request.baseUrl === "string";
	if (hasBaseUrlUpdate) {
		const baseUrl = request.baseUrl?.trim() ?? "";
		if (baseUrl.length === 0) {
			delete nextSettings.baseUrl;
		} else {
			nextSettings.baseUrl = request.baseUrl;
		}
	}

	manager.saveProviderSettings(nextSettings, { setLastUsed: false });
	return {
		providerId,
		enabled: true,
		settingsPath: manager.getFilePath(),
	};
}

export function normalizeOAuthProvider(provider: string): RpcOAuthProviderId {
	const normalized = provider.trim().toLowerCase();
	if (normalized === "codex" || normalized === "openai-codex") {
		return "openai-codex";
	}
	if (normalized === "cline" || normalized === "oca") {
		return normalized;
	}
	throw new Error(
		`provider "${provider}" does not support OAuth login (supported: cline, oca, openai-codex)`,
	);
}

function toProviderApiKey(
	providerId: RpcOAuthProviderId,
	credentials: { access: string },
): string {
	if (providerId === "cline") {
		return `workos:${credentials.access}`;
	}
	return credentials.access;
}

export async function loginLocalProvider(
	providerId: RpcOAuthProviderId,
	existing: LlmsProviders.ProviderSettings | undefined,
	openUrl: (url: string) => void,
): Promise<{
	access: string;
	refresh: string;
	expires: number;
	accountId?: string;
}> {
	const callbacks = createOAuthClientCallbacks({
		onPrompt: async (prompt) => prompt.defaultValue ?? "",
		openUrl,
		onOpenUrlError: ({ error }) => {
			throw error instanceof Error ? error : new Error(String(error));
		},
	});

	if (providerId === "cline") {
		return loginClineOAuth({
			apiBaseUrl: existing?.baseUrl?.trim() || "https://api.cline.bot",
			callbacks,
		});
	}
	if (providerId === "oca") {
		return loginOcaOAuth({
			mode: existing?.oca?.mode,
			callbacks,
		});
	}
	return loginOpenAICodex(callbacks);
}

export function saveLocalProviderOAuthCredentials(
	manager: ProviderSettingsManager,
	providerId: RpcOAuthProviderId,
	existing: LlmsProviders.ProviderSettings | undefined,
	credentials: {
		access: string;
		refresh: string;
		expires: number;
		accountId?: string;
	},
): LlmsProviders.ProviderSettings {
	const auth = {
		...(existing?.auth ?? {}),
		accessToken: toProviderApiKey(providerId, credentials),
		refreshToken: credentials.refresh,
		accountId: credentials.accountId,
	} as LlmsProviders.ProviderSettings["auth"] & { expiresAt?: number };
	auth.expiresAt = credentials.expires;
	const merged: LlmsProviders.ProviderSettings = {
		...(existing ?? {
			provider: providerId as LlmsProviders.ProviderSettings["provider"],
		}),
		provider: providerId as LlmsProviders.ProviderSettings["provider"],
		auth,
	};
	manager.saveProviderSettings(merged, { tokenSource: "oauth" });
	return merged;
}

export function resolveLocalClineAuthToken(
	settings: LlmsProviders.ProviderSettings | undefined,
): string | undefined {
	const token = settings?.auth?.accessToken?.trim() || settings?.apiKey?.trim();
	return token && token.length > 0 ? token : undefined;
}
