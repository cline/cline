import * as LlmsModels from "@clinebot/llms";
import * as LlmsProviders from "@clinebot/llms";
import type {
	RpcAddProviderActionRequest,
	RpcOAuthProviderId,
	RpcProviderCapability,
	RpcProviderListItem,
	RpcProviderModel,
	RpcSaveProviderSettingsActionRequest,
} from "@clinebot/shared";
import { createOAuthClientCallbacks } from "../../auth/client";
import { loginClineOAuth } from "../../auth/cline";
import { loginOpenAICodex } from "../../auth/codex";
import { loginOcaOAuth } from "../../auth/oca";
import type { ProviderSettingsManager } from "../storage/provider-settings-manager";
import {
	readModelsFile,
	registerCustomProvider,
	resolveModelsRegistryPath,
	toRpcProviderModel,
	writeModelsFile,
} from "./local-provider-registry";

export { ensureCustomProvidersLoaded } from "./local-provider-registry";

export interface UpdateLocalProviderRequest {
	providerId: string;
	name?: string;
	baseUrl?: string;
	apiKey?: string | null;
	headers?: Record<string, string> | null;
	timeoutMs?: number | null;
	models?: string[];
	defaultModelId?: string | null;
	modelsSourceUrl?: string | null;
	capabilities?: RpcProviderCapability[] | null;
}

export interface DeleteLocalProviderRequest {
	providerId: string;
}

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

function toSortedRpcProviderModels(
	modelMap: Record<string, LlmsProviders.ModelInfo>,
): RpcProviderModel[] {
	return Object.entries(modelMap)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([modelId, info]) => toRpcProviderModel(modelId, info));
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

async function resolveProviderModelMap(
	providerId: string,
	config?: LlmsProviders.ProviderConfig,
): Promise<Record<string, LlmsProviders.ModelInfo>> {
	const registeredModels = await LlmsModels.getModelsForProvider(providerId);
	if (!config) {
		return registeredModels;
	}

	const resolved = await LlmsProviders.resolveProviderConfig(
		providerId,
		{
			loadPrivateOnAuth: true,
			failOnError: false,
		},
		config,
	);

	return resolved?.knownModels
		? {
				...registeredModels,
				...resolved.knownModels,
			}
		: registeredModels;
}

function uniqueTrimmed(values?: string[]): string[] {
	return [...new Set((values ?? []).map((v) => v.trim()).filter(Boolean))];
}

function normalizeHeaders(
	headers: Record<string, string> | null | undefined,
): Record<string, string> | undefined {
	const entries = Object.entries(headers ?? {}).filter(
		([key]) => key.trim().length > 0,
	);
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function buildProviderModels(
	modelIds: string[],
	capabilities: RpcProviderCapability[] | undefined,
) {
	const supportsVision = capabilities?.includes("vision") ?? false;
	const supportsReasoning = capabilities?.includes("reasoning") ?? false;
	return Object.fromEntries(
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
	);
}

async function resolveModelIds(params: {
	providerId: string;
	explicitModels?: string[];
	modelsSourceUrl?: string;
	fallbackModelIds?: string[];
	shouldRecompute: boolean;
}): Promise<string[]> {
	if (!params.shouldRecompute) {
		return params.fallbackModelIds ?? [];
	}
	const fetchedModels = params.modelsSourceUrl
		? await fetchModelIdsFromSource(params.modelsSourceUrl, params.providerId)
		: [];
	return [...new Set([...(params.explicitModels ?? []), ...fetchedModels])];
}

function removeProviderFromSettingsState(
	manager: ProviderSettingsManager,
	providerId: string,
): void {
	const state = manager.read();
	let mutated = false;
	if (state.providers[providerId]) {
		delete state.providers[providerId];
		mutated = true;
	}
	if (state.lastUsedProvider === providerId) {
		delete state.lastUsedProvider;
		mutated = true;
	}
	if (mutated) manager.write(state);
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
	const baseUrl = request.baseUrl.trim();
	const apiKey = request.apiKey?.trim() ?? "";

	// Compatibility path: empty baseUrl + empty apiKey is treated as a delete request.
	if (!baseUrl && !apiKey) {
		const modelsPath = resolveModelsRegistryPath(manager);
		const modelsState = await readModelsFile(modelsPath);
		if (modelsState.providers[providerId]) {
			const deleted = await deleteLocalProvider(manager, { providerId });
			return {
				providerId,
				settingsPath: deleted.settingsPath,
				modelsPath: deleted.modelsPath,
				modelsCount: 0,
			};
		}

		removeProviderFromSettingsState(manager, providerId);

		return {
			providerId,
			settingsPath: manager.getFilePath(),
			modelsPath,
			modelsCount: 0,
		};
	}

	if (LlmsModels.hasProvider(providerId))
		throw new Error(`provider "${providerId}" already exists`);

	const providerName = request.name.trim();
	if (!providerName) throw new Error("name is required");
	if (!baseUrl) throw new Error("baseUrl is required");

	const typedModels = uniqueTrimmed(request.models);
	const sourceUrl = request.modelsSourceUrl?.trim();
	const modelIds = await resolveModelIds({
		providerId,
		explicitModels: typedModels,
		modelsSourceUrl: sourceUrl,
		shouldRecompute: true,
	});
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
	const normalizedHeaders = normalizeHeaders(request.headers);

	manager.saveProviderSettings(
		{
			provider: providerId,
			apiKey: apiKey || undefined,
			baseUrl,
			headers: normalizedHeaders,
			timeout: request.timeoutMs,
			model: defaultModelId,
		},
		{ setLastUsed: false },
	);

	const modelsPath = resolveModelsRegistryPath(manager);
	const modelsState = await readModelsFile(modelsPath);

	modelsState.providers[providerId] = {
		provider: {
			name: providerName,
			baseUrl,
			defaultModelId,
			capabilities,
			modelsSourceUrl: sourceUrl,
		},
		models: buildProviderModels(modelIds, capabilities),
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

export async function updateLocalProvider(
	manager: ProviderSettingsManager,
	request: UpdateLocalProviderRequest,
): Promise<{
	providerId: string;
	settingsPath: string;
	modelsPath: string;
	modelsCount: number;
}> {
	const providerId = request.providerId.trim().toLowerCase();
	if (!providerId) throw new Error("providerId is required");

	const modelsPath = resolveModelsRegistryPath(manager);
	const modelsState = await readModelsFile(modelsPath);
	const existingEntry = modelsState.providers[providerId];
	if (!existingEntry) {
		throw new Error(`provider "${providerId}" does not exist`);
	}

	const providerName =
		request.name?.trim() ?? existingEntry.provider.name.trim();
	if (!providerName) throw new Error("name is required");

	const baseUrl =
		request.baseUrl?.trim() ?? existingEntry.provider.baseUrl.trim();
	if (!baseUrl) throw new Error("baseUrl is required");

	const capabilities =
		request.capabilities === undefined
			? existingEntry.provider.capabilities
			: request.capabilities === null
				? undefined
				: [...new Set(request.capabilities)];

	const explicitModels = uniqueTrimmed(request.models);
	const nextModelsSourceUrl =
		request.modelsSourceUrl === undefined
			? existingEntry.provider.modelsSourceUrl
			: request.modelsSourceUrl?.trim() || undefined;
	const shouldRecomputeModels =
		request.models !== undefined ||
		(request.modelsSourceUrl !== undefined && !!nextModelsSourceUrl);
	const existingModelIds = Object.keys(existingEntry.models)
		.map((id) => id.trim())
		.filter(Boolean);
	const modelIds = await resolveModelIds({
		providerId,
		explicitModels,
		modelsSourceUrl: nextModelsSourceUrl,
		fallbackModelIds: existingModelIds,
		shouldRecompute: shouldRecomputeModels,
	});
	if (modelIds.length === 0) {
		throw new Error(
			"at least one model is required (manual or via modelsSourceUrl)",
		);
	}

	const defaultModelCandidate =
		request.defaultModelId === undefined
			? existingEntry.provider.defaultModelId?.trim()
			: request.defaultModelId?.trim();
	const defaultModelId =
		defaultModelCandidate && modelIds.includes(defaultModelCandidate)
			? defaultModelCandidate
			: modelIds[0];

	const existingSettings = manager.getProviderSettings(providerId);
	const nextSettings: Record<string, unknown> = {
		...(existingSettings ?? {}),
		provider: providerId,
		baseUrl,
		model: defaultModelId,
	};
	if (request.apiKey !== undefined) {
		const apiKey = request.apiKey?.trim() ?? "";
		if (apiKey) nextSettings.apiKey = apiKey;
		else delete nextSettings.apiKey;
	}
	if (request.headers !== undefined) {
		const normalizedHeaders = normalizeHeaders(request.headers);
		if (normalizedHeaders) nextSettings.headers = normalizedHeaders;
		else delete nextSettings.headers;
	}
	if (request.timeoutMs !== undefined) {
		if (typeof request.timeoutMs === "number") {
			nextSettings.timeout = request.timeoutMs;
		} else {
			delete nextSettings.timeout;
		}
	}

	manager.saveProviderSettings(nextSettings, { setLastUsed: false });

	modelsState.providers[providerId] = {
		provider: {
			name: providerName,
			baseUrl,
			defaultModelId,
			capabilities,
			modelsSourceUrl: nextModelsSourceUrl,
		},
		models: buildProviderModels(modelIds, capabilities),
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

export async function deleteLocalProvider(
	manager: ProviderSettingsManager,
	request: DeleteLocalProviderRequest,
): Promise<{
	providerId: string;
	settingsPath: string;
	modelsPath: string;
}> {
	const providerId = request.providerId.trim().toLowerCase();
	if (!providerId) throw new Error("providerId is required");

	const modelsPath = resolveModelsRegistryPath(manager);
	const modelsState = await readModelsFile(modelsPath);
	if (!modelsState.providers[providerId]) {
		throw new Error(`provider "${providerId}" does not exist`);
	}

	delete modelsState.providers[providerId];
	await writeModelsFile(modelsPath, modelsState);
	LlmsModels.unregisterProvider(providerId);

	removeProviderFromSettingsState(manager, providerId);

	return {
		providerId,
		settingsPath: manager.getFilePath(),
		modelsPath,
	};
}

export async function listLocalProviders(
	manager: ProviderSettingsManager,
): Promise<{ providers: RpcProviderListItem[]; settingsPath: string }> {
	const state = manager.read();
	const ids = LlmsModels.getProviderIds().sort((a, b) => a.localeCompare(b));

	const providers = await Promise.all(
		ids.map(async (id): Promise<RpcProviderListItem> => {
			const [info, registeredModels] = await Promise.all([
				LlmsModels.getProvider(id),
				LlmsModels.getModelsForProvider(id),
			]);
			const modelList = toSortedRpcProviderModels(registeredModels);
			const persistedSettings = state.providers[id]?.settings;
			const name = info?.name ?? titleCaseFromId(id);
			return {
				id,
				name,
				models: modelList.length,
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
				modelList,
			};
		}),
	);

	return { providers, settingsPath: manager.getFilePath() };
}

export async function getLocalProviderModels(
	providerId: string,
	config?: LlmsProviders.ProviderConfig,
): Promise<{ providerId: string; models: RpcProviderModel[] }> {
	const id = providerId.trim();
	const modelMap = await resolveProviderModelMap(id, config);
	const models = toSortedRpcProviderModels(modelMap);
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
