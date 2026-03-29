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

// --- Small pure helpers ---

function resolveVisibleApiKey(settings: {
	apiKey?: string;
	auth?: { apiKey?: string };
}): string | undefined {
	return settings.apiKey ?? settings.auth?.apiKey;
}

function hasOAuthAccessToken(settings: {
	auth?: { accessToken?: string };
}): boolean {
	return (settings.auth?.accessToken?.trim() ?? "").length > 0;
}

function titleCaseFromId(id: string): string {
	return id
		.split(/[-_]/)
		.filter(Boolean)
		.map((p) => p.charAt(0).toUpperCase() + p.slice(1))
		.join(" ");
}

function createLetter(name: string): string {
	const parts = name.split(/\s+/).filter(Boolean);
	if (parts.length === 0) return "?";
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
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
	for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
	return palette[hash % palette.length];
}

// --- Model ID parsing ---

function parseModelIdList(input: unknown): string[] {
	if (!Array.isArray(input)) return [];
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
		const keys = Object.keys(data.models).filter((k) => k.trim().length > 0);
		if (keys.length > 0) return keys;
	}

	const scoped = data.providers?.[providerId];
	if (scoped && typeof scoped === "object") {
		const nested = scoped as { models?: unknown };
		const list = parseModelIdList(nested.models ?? scoped);
		if (list.length > 0) return list;
	}

	return [];
}

async function fetchModelIdsFromSource(
	url: string,
	providerId: string,
): Promise<string[]> {
	const response = await fetch(url, { method: "GET" });
	if (!response.ok)
		throw new Error(
			`failed to fetch models from ${url}: HTTP ${response.status}`,
		);
	return extractModelIdsFromPayload(
		(await response.json()) as unknown,
		providerId,
	);
}

// --- Public API ---

export async function addLocalProvider(
	manager: ProviderSettingsManager,
	request: Omit<RpcAddProviderActionRequest, "action">,
): Promise<{
	providerId: string;
	settingsPath: string;
	modelsPath: string;
	modelsCount: number;
}> {
	const providerId = request.providerId.trim().toLowerCase();
	if (!providerId) throw new Error("providerId is required");
	if (LlmsModels.hasProvider(providerId))
		throw new Error(`provider "${providerId}" already exists`);

	const providerName = request.name.trim();
	if (!providerName) throw new Error("name is required");

	const baseUrl = request.baseUrl.trim();
	if (!baseUrl) throw new Error("baseUrl is required");

	const typedModels = (request.models ?? [])
		.map((m) => m.trim())
		.filter(Boolean);
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
		([k]) => k.trim().length > 0,
	);

	manager.saveProviderSettings(
		{
			provider: providerId,
			apiKey: request.apiKey?.trim() || undefined,
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
			modelIds.map((id) => [
				id,
				{
					id,
					name: id,
					supportsVision,
					supportsAttachments: supportsVision,
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
): Promise<{ providers: RpcProviderListItem[]; settingsPath: string }> {
	const state = manager.read();
	const ids = LlmsModels.getProviderIds().sort((a, b) => a.localeCompare(b));

	const providers = await Promise.all(
		ids.map(async (id): Promise<RpcProviderListItem> => {
			const [info, providerModels] = await Promise.all([
				LlmsModels.getProvider(id),
				getLocalProviderModels(id),
			]);
			const persistedSettings = state.providers[id]?.settings;
			const name = info?.name ?? titleCaseFromId(id);
			return {
				id,
				name,
				models: providerModels.models.length,
				color: stableColor(id),
				letter: createLetter(name),
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

	return { providers, settingsPath: manager.getFilePath() };
}

export async function getLocalProviderModels(
	providerId: string,
): Promise<{ providerId: string; models: RpcProviderModel[] }> {
	const id = providerId.trim();
	const modelMap = await LlmsModels.getModelsForProvider(id);
	const models = Object.entries(modelMap)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([modelId, info]) => toRpcProviderModel(modelId, info));
	return { providerId: id, models };
}

export function saveLocalProviderSettings(
	manager: ProviderSettingsManager,
	request: Omit<RpcSaveProviderSettingsActionRequest, "action">,
): { providerId: string; enabled: boolean; settingsPath: string } {
	const providerId = request.providerId.trim();

	if (request.enabled === false) {
		const state = manager.read();
		delete state.providers[providerId];
		if (state.lastUsedProvider === providerId) delete state.lastUsedProvider;
		manager.write(state);
		return { providerId, enabled: false, settingsPath: manager.getFilePath() };
	}

	const existing = manager.getProviderSettings(providerId);
	const next: Record<string, unknown> = {
		...(existing ?? {}),
		provider: providerId,
	};

	// String fields that should be cleared when empty
	for (const key of ["apiKey", "baseUrl", "model", "region"] as const) {
		if (Object.hasOwn(request, key) && typeof request[key] === "string") {
			const val = (request[key] as string).trim();
			if (val.length === 0) delete next[key];
			else next[key] = request[key];
		}
	}

	// Scalar passthrough fields
	for (const key of [
		"maxTokens",
		"contextWindow",
		"timeout",
		"apiLine",
		"capabilities",
	] as const) {
		if (Object.hasOwn(request, key)) next[key] = request[key];
	}

	// Merged object fields
	for (const key of [
		"auth",
		"headers",
		"reasoning",
		"aws",
		"gcp",
		"azure",
		"sap",
		"oca",
	] as const) {
		if (Object.hasOwn(request, key) && request[key] != null) {
			next[key] = {
				...(typeof next[key] === "object" && next[key] != null
					? (next[key] as object)
					: {}),
				...(request[key] as object),
			};
		}
	}

	manager.saveProviderSettings(next, { setLastUsed: false });
	return { providerId, enabled: true, settingsPath: manager.getFilePath() };
}

export function normalizeOAuthProvider(provider: string): RpcOAuthProviderId {
	const normalized = provider.trim().toLowerCase();
	if (normalized === "codex" || normalized === "openai-codex")
		return "openai-codex";
	if (normalized === "cline" || normalized === "oca") return normalized;
	throw new Error(
		`provider "${provider}" does not support OAuth login (supported: cline, oca, openai-codex)`,
	);
}

function toProviderApiKey(
	providerId: RpcOAuthProviderId,
	credentials: { access: string },
): string {
	return providerId === "cline"
		? `workos:${credentials.access}`
		: credentials.access;
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
	if (providerId === "oca")
		return loginOcaOAuth({ mode: existing?.oca?.mode, callbacks });
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
		expiresAt: credentials.expires,
	} as LlmsProviders.ProviderSettings["auth"] & { expiresAt?: number };

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
