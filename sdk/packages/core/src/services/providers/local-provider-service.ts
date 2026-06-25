import * as LlmsModels from "@cline/llms";
import type {
	AddProviderActionRequest,
	ITelemetryService,
	ProviderCapability,
	ProviderConfigField,
	ProviderConfigFieldPrimitive,
	ProviderListItem,
	ProviderModel,
	SaveProviderSettingsActionRequest,
} from "@cline/shared";
import { createOAuthClientCallbacks } from "../../auth/client";
import {
	getProviderAuthHandler,
	loginAndSaveProviderOAuthCredentials,
	type ProviderOAuthCredentials,
	saveProviderOAuthCredentials,
} from "../../auth/provider-auth-registry";
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

const CLINE_PASS_PROVIDER_ID = "cline-pass";

export interface ListLocalProvidersOptions {
	isClinePassEnabled?: boolean;
}

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
	const isClinePass = providerId === CLINE_PASS_PROVIDER_ID;
	if (!config && !isClinePass) {
		return registeredModels;
	}

	const resolved = await resolveProviderConfig(
		providerId,
		{
			loadLatestOnInit: isClinePass,
			loadPrivateOnAuth: true,
			failOnError: false,
		},
		config,
	);

	if (providerId === "litellm" && resolved?.knownModels) {
		return resolved.knownModels;
	}
	if (isClinePass && resolved?.knownModels) {
		return resolved.knownModels;
	}

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

function uniqueCapabilities(
	values: readonly ProviderCapability[] | undefined,
): ProviderCapability[] | undefined {
	if (!values?.length) return undefined;
	return [...new Set(values)];
}

function resolveProviderCapabilities(
	infoCapabilities: readonly ProviderCapability[] | undefined,
	settingsCapabilities: readonly ProviderCapability[] | undefined,
): ProviderCapability[] | undefined {
	return uniqueCapabilities([
		...(infoCapabilities ?? []),
		...(settingsCapabilities ?? []),
	]);
}

function getPopularRank(metadata: Record<string, unknown> | undefined): number {
	const value = metadata?.popularRank;
	return typeof value === "number" && Number.isFinite(value)
		? value
		: Number.MAX_SAFE_INTEGER;
}

function isProviderConfigField(input: unknown): input is ProviderConfigField {
	if (!input || typeof input !== "object") return false;
	const field = input as Record<string, unknown>;
	return (
		typeof field.path === "string" &&
		field.path.trim().length > 0 &&
		typeof field.label === "string" &&
		field.label.trim().length > 0 &&
		["text", "password", "url", "number", "select", "boolean"].includes(
			String(field.type),
		)
	);
}

function readProviderConfigFields(
	metadata: Record<string, unknown> | undefined,
): ProviderConfigField[] | undefined {
	const fields = metadata?.configFields;
	if (!Array.isArray(fields)) {
		return undefined;
	}
	return fields.filter(isProviderConfigField);
}

const API_KEY_CONFIG_FIELD: ProviderConfigField = {
	path: "apiKey",
	label: "API Key",
	type: "password",
	placeholder: "Enter API key...",
	description: "API key issued by the provider.",
	secret: true,
};

const BASE_URL_CONFIG_FIELD: ProviderConfigField = {
	path: "baseUrl",
	label: "Base URL",
	type: "url",
	placeholder: "https://...",
	description: "Base endpoint used for provider requests.",
};

function fallbackProviderConfigFields(
	info: Awaited<ReturnType<typeof LlmsModels.getProvider>>,
): ProviderConfigField[] {
	if (!info) {
		return [API_KEY_CONFIG_FIELD];
	}
	if (info.source !== "system") {
		return info.baseUrl
			? [API_KEY_CONFIG_FIELD, BASE_URL_CONFIG_FIELD]
			: [API_KEY_CONFIG_FIELD];
	}
	const fields: ProviderConfigField[] = [];
	if (info.env?.length) {
		fields.push(API_KEY_CONFIG_FIELD);
	}
	if (info.baseUrl) {
		fields.push(BASE_URL_CONFIG_FIELD);
	}
	return fields;
}

function getPathValue(input: unknown, path: string): unknown {
	return path.split(".").reduce<unknown>((current, segment) => {
		if (!current || typeof current !== "object") return undefined;
		return (current as Record<string, unknown>)[segment];
	}, input);
}

function toConfigPrimitive(
	value: unknown,
): ProviderConfigFieldPrimitive | undefined {
	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean" ||
		value === null
	) {
		return value;
	}
	return undefined;
}

function resolveConfigValues(
	fields: readonly ProviderConfigField[] | undefined,
	settings: ProviderSettings | undefined,
	info: { baseUrl?: string } | undefined,
): Record<string, ProviderConfigFieldPrimitive> | undefined {
	if (!fields?.length) return undefined;

	const values: Record<string, ProviderConfigFieldPrimitive> = {};
	for (const field of fields) {
		const persistedValue = toConfigPrimitive(
			field.path === "baseUrl" && settings?.baseUrl === undefined
				? info?.baseUrl
				: getPathValue(settings, field.path),
		);
		const value = persistedValue ?? field.defaultValue;
		if (value !== undefined) {
			values[field.path] = value;
		}
	}
	return values;
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
	options: ListLocalProvidersOptions = {},
): Promise<{ providers: ProviderListItem[]; settingsPath: string }> {
	const state = manager.read();
	const ids = LlmsModels.getProviderIds();

	const providerEntries = await Promise.all(
		ids.map(
			async (id): Promise<{ provider: ProviderListItem; rank: number }> => {
				const [info, registeredModels] = await Promise.all([
					LlmsModels.getProvider(id),
					LlmsModels.getModelsForProvider(id),
				]);
				const modelList = toSortedProviderModels(registeredModels);
				const persistedSettings = state.providers[id]?.settings;
				const name = info?.name ?? titleCaseFromId(id);
				const capabilities = resolveProviderCapabilities(
					info?.capabilities,
					persistedSettings?.capabilities,
				);
				const configFields =
					readProviderConfigFields(info?.metadata) ??
					fallbackProviderConfigFields(info);
				return {
					provider: {
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
						capabilities,
						authDescription: "This provider uses API keys for authentication.",
						baseUrlDescription:
							"The base endpoint to use for provider requests.",
						configFields,
						configValues: resolveConfigValues(
							configFields,
							persistedSettings,
							info,
						),
						modelList,
					},
					rank: getPopularRank(info?.metadata),
				};
			},
		),
	);
	providerEntries.sort((a, b) => {
		if (a.rank !== b.rank) return a.rank - b.rank;
		return (
			a.provider.name.localeCompare(b.provider.name) ||
			a.provider.id.localeCompare(b.provider.id)
		);
	});
	let providers = providerEntries.map((entry) => entry.provider);
	if (options.isClinePassEnabled !== true) {
		providers = providers.filter(
			(provider) => provider.id !== CLINE_PASS_PROVIDER_ID,
		);
	}

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === "object" && !Array.isArray(value);
}

function applySettingsObjectPatch(
	current: unknown,
	patch: unknown,
): Record<string, unknown> | undefined {
	if (!isPlainObject(patch)) {
		return isPlainObject(current) ? { ...current } : undefined;
	}

	const next = isPlainObject(current) ? { ...current } : {};
	for (const [key, value] of Object.entries(patch)) {
		if (value == null || value === "") {
			delete next[key];
			continue;
		}
		if (isPlainObject(value)) {
			const merged = applySettingsObjectPatch(next[key], value);
			if (merged && Object.keys(merged).length > 0) {
				next[key] = merged;
			} else {
				delete next[key];
			}
			continue;
		}
		next[key] = value;
	}

	return Object.keys(next).length > 0 ? next : undefined;
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
			const merged = applySettingsObjectPatch(next[key], request[key]);
			if (merged) next[key] = merged;
			else delete next[key];
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

export function normalizeOAuthProvider(provider: string): string {
	const normalized = provider.trim().toLowerCase();
	const handler = getProviderAuthHandler(normalized);
	if (handler) return handler.providerId;
	throw new Error(`provider "${provider}" does not support OAuth login`);
}

export async function loginLocalProvider(
	providerId: string,
	existing: ProviderSettings | undefined,
	openUrl: (url: string) => void,
	telemetry?: ITelemetryService,
): Promise<ProviderOAuthCredentials> {
	const handler = getProviderAuthHandler(providerId);
	if (!handler) {
		throw new Error(`provider "${providerId}" does not support OAuth login`);
	}
	const callbacks = createOAuthClientCallbacks({
		onPrompt: async (prompt) => prompt.defaultValue ?? "",
		openUrl,
		onOpenUrlError: ({ error }) => {
			throw error instanceof Error ? error : new Error(String(error));
		},
	});
	return handler.login({ settings: existing, callbacks, telemetry });
}

export function saveLocalProviderOAuthCredentials(
	manager: ProviderSettingsManager,
	providerId: string,
	existing: ProviderSettings | undefined,
	credentials: ProviderOAuthCredentials,
	options?: { setLastUsed?: boolean },
): ProviderSettings {
	return saveProviderOAuthCredentials({
		manager,
		providerId,
		settings: existing,
		credentials,
		setLastUsed: options?.setLastUsed,
	});
}

export async function loginAndSaveLocalProviderOAuthCredentials(
	manager: ProviderSettingsManager,
	providerId: string,
	openUrl: (url: string) => void,
	telemetry?: ITelemetryService,
): Promise<ProviderSettings> {
	const callbacks = createOAuthClientCallbacks({
		onPrompt: async (prompt) => prompt.defaultValue ?? "",
		openUrl,
		onOpenUrlError: ({ error }) => {
			throw error instanceof Error ? error : new Error(String(error));
		},
	});
	return loginAndSaveProviderOAuthCredentials(manager, providerId, {
		callbacks,
		telemetry,
	});
}

export function resolveLocalClineAuthToken(
	settings: ProviderSettings | undefined,
): string | undefined {
	const token = settings?.auth?.accessToken?.trim() || settings?.apiKey?.trim();
	return token && token.length > 0 ? token : undefined;
}
