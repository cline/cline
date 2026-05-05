import * as LlmsModels from "@clinebot/llms";
import {
	type AddProviderActionRequest,
	isOAuthProviderId,
	type OAuthProviderId,
	type ProviderCapability,
	type ProviderListItem,
	type ProviderModel,
	type SaveProviderSettingsActionRequest,
} from "@clinebot/shared";
import { createOAuthClientCallbacks } from "../../auth/client";
import { loginClineOAuth } from "../../auth/cline";
import { loginOpenAICodex } from "../../auth/codex";
import { loginOcaOAuth } from "../../auth/oca";
import { resolveProviderConfig } from "../../services/llms/provider-defaults";
import type {
	ModelInfo,
	ProviderClient,
	ProviderConfig,
	ProviderProtocol,
	ProviderSettings,
} from "../../services/llms/provider-settings";
import type { ProviderSettingsManager } from "../storage/provider-settings-manager";
import {
	readModelsFile,
	registerCustomProvider,
	resolveModelsRegistryPath,
	toProviderModel,
	writeModelsFile,
} from "./local-provider-registry";
import {
	fetchModelIdsFromSource,
	resolveModelsSourceUrl,
} from "./model-source";

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
	protocol?: ProviderProtocol | null;
	client?: ProviderClient | null;
	capabilities?: ProviderCapability[] | null;
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

function toSortedProviderModels(
	modelMap: Record<string, ModelInfo>,
): ProviderModel[] {
	return Object.entries(modelMap)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([modelId, info]) => toProviderModel(modelId, info));
}

async function resolveProviderModelMap(
	providerId: string,
	config?: ProviderConfig,
): Promise<Record<string, ModelInfo>> {
	const registeredModels = await LlmsModels.getModelsForProvider(providerId);
	if (!config) {
		return registeredModels;
	}

	const resolved = await resolveProviderConfig(
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
	capabilities: ProviderCapability[] | undefined,
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
	LlmsModels.unregisterProvider(providerId);
}

// --- Public API ---

export async function addLocalProvider(
	manager: ProviderSettingsManager,
	request: Omit<AddProviderActionRequest, "action">,
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
			protocol: request.protocol,
			client: request.client,
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
			protocol: request.protocol,
			client: request.client,
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
	let existingEntry = modelsState.providers[providerId];
	if (!existingEntry) {
		const existingSettings = manager.getProviderSettings(providerId);
		if (!existingSettings) {
			throw new Error(`provider "${providerId}" does not exist`);
		}

		const requestedSourceUrl = request.modelsSourceUrl?.trim();
		const seedModelId =
			uniqueTrimmed(request.models)[0] ?? existingSettings.model?.trim();
		if (!seedModelId && !requestedSourceUrl) {
			throw new Error(
				`provider "${providerId}" cannot be updated because no model is configured`,
			);
		}

		// Ephemeral seed for the existing update path; final state is computed and written below.
		existingEntry = {
			provider: {
				name: request.name?.trim() || titleCaseFromId(providerId),
				baseUrl:
					request.baseUrl?.trim() ?? existingSettings.baseUrl?.trim() ?? "",
				defaultModelId: seedModelId,
				protocol: existingSettings.protocol,
				client: existingSettings.client,
				capabilities: existingSettings.capabilities,
			},
			models: seedModelId
				? buildProviderModels([seedModelId], existingSettings.capabilities)
				: {},
		};
	}
	if (!existingEntry.provider) {
		throw new Error(
			`provider "${providerId}" cannot be updated because it is a model overlay (no provider metadata)`,
		);
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
	const protocol =
		request.protocol === undefined
			? existingEntry.provider.protocol
			: (request.protocol ?? undefined);
	const client =
		request.client === undefined
			? existingEntry.provider.client
			: (request.client ?? undefined);

	const explicitModels = uniqueTrimmed(request.models);
	const nextModelsSourceUrl =
		request.modelsSourceUrl === undefined
			? existingEntry.provider.modelsSourceUrl
			: request.modelsSourceUrl?.trim() || undefined;
	const shouldRecomputeModels =
		request.models !== undefined ||
		(request.modelsSourceUrl !== undefined && !!nextModelsSourceUrl);
	const existingModelIds = Object.keys(existingEntry.models ?? {})
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
	if (protocol) nextSettings.protocol = protocol;
	else delete nextSettings.protocol;
	if (client) nextSettings.client = client;
	else delete nextSettings.client;
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
			protocol,
			client,
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
): Promise<{ providers: ProviderListItem[]; settingsPath: string }> {
	const state = manager.read();
	const ids = LlmsModels.getProviderIds().sort((a, b) => a.localeCompare(b));

	const providers = await Promise.all(
		ids.map(async (id): Promise<ProviderListItem> => {
			const [info, registeredModels] = await Promise.all([
				LlmsModels.getProvider(id),
				LlmsModels.getModelsForProvider(id),
			]);
			const modelList = toSortedProviderModels(registeredModels);
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
				protocol: persistedSettings?.protocol ?? info?.protocol,
				client: persistedSettings?.client ?? info?.client,
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
	config?: ProviderConfig,
): Promise<{ providerId: string; models: ProviderModel[] }> {
	const id = providerId.trim();
	const modelMap = await resolveProviderModelMap(id, config);
	const models = toSortedProviderModels(modelMap);
	return { providerId: id, models };
}

export function saveLocalProviderSettings(
	manager: ProviderSettingsManager,
	request: Omit<SaveProviderSettingsActionRequest, "action">,
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
		"protocol",
		"client",
		"routingProviderId",
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

export async function refreshProviderModelsFromSource(
	manager: ProviderSettingsManager,
	providerId: string,
): Promise<{ providerId: string; refreshed: boolean; modelsCount?: number }> {
	const id = providerId.trim();
	const settings = manager.getProviderSettings(id);
	const collection = LlmsModels.MODEL_COLLECTIONS_BY_PROVIDER_ID[id] as
		| LlmsModels.ModelCollection
		| undefined;
	const provider = collection?.provider;
	const baseUrl = settings?.baseUrl?.trim() || provider?.baseUrl?.trim();
	const modelsSourceUrl = resolveModelsSourceUrl(
		baseUrl,
		provider?.baseUrl,
		provider?.modelsSourceUrl,
	);
	if (!settings || !provider || !baseUrl || !modelsSourceUrl) {
		return { providerId: id, refreshed: false };
	}

	const result = await updateLocalProvider(manager, {
		providerId: id,
		name: provider.name,
		baseUrl,
		apiKey: settings.apiKey,
		headers: settings.headers ?? null,
		timeoutMs: settings.timeout ?? null,
		modelsSourceUrl,
		protocol: settings.protocol ?? provider.protocol ?? null,
		client: settings.client ?? provider.client ?? null,
		capabilities: settings.capabilities ?? null,
	});
	return { providerId: id, refreshed: true, modelsCount: result.modelsCount };
}

export function normalizeOAuthProvider(provider: string): OAuthProviderId {
	const normalized = provider.trim().toLowerCase();
	if (normalized === "codex" || normalized === "openai-codex")
		return "openai-codex";
	if (normalized === "cline" || normalized === "oca") return normalized;
	throw new Error(
		`provider "${provider}" does not support OAuth login (supported: cline, oca, openai-codex)`,
	);
}

function toProviderApiKey(
	providerId: OAuthProviderId,
	credentials: { access: string },
): string {
	if (providerId === "cline") {
		return credentials.access.startsWith("workos:")
			? credentials.access
			: `workos:${credentials.access}`;
	}
	return credentials.access;
}

export async function loginLocalProvider(
	providerId: OAuthProviderId,
	existing: ProviderSettings | undefined,
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
			useWorkOSDeviceAuth: true,
			callbacks,
		});
	}
	if (providerId === "oca")
		return loginOcaOAuth({ mode: existing?.oca?.mode, callbacks });
	return loginOpenAICodex(callbacks);
}

export function saveLocalProviderOAuthCredentials(
	manager: ProviderSettingsManager,
	providerId: OAuthProviderId,
	existing: ProviderSettings | undefined,
	credentials: {
		access: string;
		refresh: string;
		expires: number;
		accountId?: string;
	},
): ProviderSettings {
	const auth = {
		...(existing?.auth ?? {}),
		accessToken: toProviderApiKey(providerId, credentials),
		refreshToken: credentials.refresh,
		accountId: credentials.accountId,
		expiresAt: credentials.expires,
	} as ProviderSettings["auth"] & { expiresAt?: number };

	const merged: ProviderSettings = {
		...(existing ?? {
			provider: providerId as ProviderSettings["provider"],
		}),
		provider: providerId as ProviderSettings["provider"],
		auth,
	};
	manager.saveProviderSettings(merged, { tokenSource: "oauth" });
	return merged;
}

export function resolveLocalClineAuthToken(
	settings: ProviderSettings | undefined,
): string | undefined {
	const token = settings?.auth?.accessToken?.trim() || settings?.apiKey?.trim();
	return token && token.length > 0 ? token : undefined;
}

// --- Provider configuration fields (UI projection) -------------------------

export type ProviderConfigFieldKey = "apiKey" | "baseUrl";

export interface ProviderConfigFieldRequirement {
	defaultValue?: string;
}

export interface ProviderConfigFields {
	providerId: string;
	authMethod: "api-key" | "oauth";
	fields: Partial<
		Record<ProviderConfigFieldKey, ProviderConfigFieldRequirement>
	>;
}

const EDITABLE_BASE_URL_PROVIDER_IDS = new Set([
	"ollama",
	"lmstudio",
	"litellm",
]);

function shouldExposeBaseUrlField(
	providerId: string,
	collection: LlmsModels.ModelCollection | undefined,
): boolean {
	if (!collection?.provider.baseUrl) return false;
	if (collection.provider.source !== "system") return true;
	return EDITABLE_BASE_URL_PROVIDER_IDS.has(providerId);
}

/**
 * Project a provider into the inputs a configure-dialog should render.
 *
 * No fields are marked "required" — `llms` no longer pre-flights credentials,
 * so a missing API key surfaces as the provider's own auth error rather than
 * a synthetic SDK failure. UIs may still require fields client-side if they
 * want, but the runtime does not.
 *
 * - OAuth providers (`cline`, `oca`, `openai-codex`) return `authMethod:
 *   "oauth"` with no fields; the configure UI should route to the OAuth
 *   login flow instead.
 * - All other providers return `apiKey`. Built-in local/proxy-style providers
 *   with user-supplied endpoints, plus user-added providers with saved
 *   endpoints, also return a pre-filled `baseUrl` field.
 *
 * Returns the same fallback shape for unknown providers (single `apiKey`
 * input, no default base URL) so callers can render a reasonable configure
 * dialog without per-id branches.
 */
export function getProviderConfigFields(
	providerId: string,
): ProviderConfigFields {
	const id = LlmsModels.normalizeProviderId(providerId);
	if (isOAuthProviderId(id)) {
		return { providerId: id, authMethod: "oauth", fields: {} };
	}

	const collection = LlmsModels.MODEL_COLLECTIONS_BY_PROVIDER_ID[id];
	const defaultBaseUrl = collection?.provider.baseUrl;
	const fields: ProviderConfigFields["fields"] = { apiKey: {} };
	if (shouldExposeBaseUrlField(id, collection)) {
		fields.baseUrl = { defaultValue: defaultBaseUrl };
	}

	return { providerId: id, authMethod: "api-key", fields };
}
