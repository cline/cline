import * as LlmsModels from "@clinebot/llms/models";
import type * as LlmsProviders from "@clinebot/llms/providers";
import type {
	RpcAddProviderActionRequest,
	RpcOAuthProviderId,
	RpcProviderListItem,
	RpcProviderModel,
	RpcSaveProviderSettingsActionRequest,
} from "@clinebot/shared";
import { createOAuthClientCallbacks } from "../auth/client";
import { loginClineOAuth } from "../auth/cline";
import { loginOpenAICodex } from "../auth/codex";
import { loginOcaOAuth } from "../auth/oca";
import type { ProviderSettingsManager } from "../storage/provider-settings-manager";
import {
	readModelsFile,
	registerCustomProvider,
	resolveModelsRegistryPath,
	toRpcProviderModel,
	writeModelsFile,
} from "./local-provider-registry";

export { ensureCustomProvidersLoaded } from "./local-provider-registry";

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
