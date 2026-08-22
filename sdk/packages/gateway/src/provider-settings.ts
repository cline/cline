import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import {
	BUILT_IN_PROVIDER_IDS,
	getModelsForProvider,
	getProvider,
	getProviderIds,
	hasProvider,
	type ModelInfo,
	registerModel,
	registerProvider,
	unregisterModel,
} from "@cline/llms";
import {
	getClineEnvironmentConfig,
	type ProviderCapability,
	ProviderCapabilitySchema,
	type ProviderCatalogResponse,
	type ProviderClient,
	ProviderClientSchema,
	type ProviderConfigField,
	type ProviderConfigFieldPrimitive,
	type ProviderListItem,
	type ProviderModel,
	type ProviderModelsResponse,
	type ProviderProtocol,
	ProviderProtocolSchema,
	refreshClineOAuthCredentials,
} from "@cline/shared";
import { resolveProviderSettingsPath } from "@cline/shared/storage";
import { z } from "zod";

const AuthSettingsSchema = z
	.object({
		apiKey: z.string().optional(),
		accessToken: z.string().optional(),
		refreshToken: z.string().optional(),
		expiresAt: z.number().optional(),
		accountId: z.string().optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
	})
	.passthrough();

const ProviderSettingsSchema = z
	.object({
		provider: z.string().min(1),
		model: z.string().min(1).optional(),
		apiKey: z.string().optional(),
		auth: AuthSettingsSchema.optional(),
		baseUrl: z.string().optional(),
		headers: z.record(z.string(), z.string()).optional(),
		timeout: z.number().int().positive().optional(),
		region: z.string().optional(),
		apiLine: z.enum(["china", "international"]).optional(),
		client: z.string().optional(),
		protocol: ProviderProtocolSchema.optional(),
		capabilities: z.array(ProviderCapabilitySchema).optional(),
		aws: z.record(z.string(), z.unknown()).optional(),
		gcp: z.record(z.string(), z.unknown()).optional(),
		azure: z.record(z.string(), z.unknown()).optional(),
		sap: z.record(z.string(), z.unknown()).optional(),
	})
	.passthrough();

const ProviderDefinitionSchema = z
	.object({
		name: z.string().min(1),
		baseUrl: z.string().min(1).optional(),
		defaultModelId: z.string().min(1),
		modelsSourceUrl: z.string().min(1).optional(),
		protocol: ProviderProtocolSchema.optional(),
		client: ProviderClientSchema.optional(),
		capabilities: z.array(ProviderCapabilitySchema).optional(),
		models: z.array(z.string().min(1)),
	})
	.strict();

const StoredProviderEntrySchema = z
	.object({
		settings: ProviderSettingsSchema,
		enabled: z.boolean().optional(),
		definition: ProviderDefinitionSchema.optional(),
		updatedAt: z.string().optional(),
		tokenSource: z.enum(["manual", "oauth", "migration"]).optional(),
	})
	.passthrough();

const StoredProviderSettingsSchema = z
	.object({
		version: z.literal(1),
		lastUsedProvider: z.string().min(1).optional(),
		modes: z.record(z.string(), z.unknown()).optional(),
		providers: z.record(z.string(), StoredProviderEntrySchema),
	})
	.passthrough();

export type SavedProviderSettings = z.infer<typeof ProviderSettingsSchema>;
export type SavedProviderDefinition = z.infer<typeof ProviderDefinitionSchema>;

type StoredProviderSettings = z.infer<typeof StoredProviderSettingsSchema>;

export interface ProviderCredentialPresence {
	readonly apiKey: boolean;
	readonly oauthAccessToken: boolean;
	readonly oauthRefreshToken: boolean;
}

export interface PublicProviderSettings {
	readonly providerId: string;
	readonly enabled: boolean;
	readonly settings: Record<string, unknown>;
	readonly credentials: ProviderCredentialPresence;
}

export interface ProviderSettingsPatch {
	readonly enabled?: boolean;
	readonly settings?: Record<string, unknown>;
}

export interface AddGatewayProviderInput {
	readonly providerId: string;
	readonly name: string;
	readonly baseUrl: string;
	readonly apiKey?: string;
	readonly headers?: Record<string, string>;
	readonly timeoutMs?: number;
	readonly models?: readonly string[];
	readonly defaultModelId?: string;
	readonly modelsSourceUrl?: string;
	readonly protocol?: ProviderProtocol;
	readonly client?: ProviderClient;
	readonly capabilities?: readonly ProviderCapability[];
}

export interface UpdateGatewayProviderModelsInput {
	readonly providerId: string;
	readonly models: readonly string[];
	readonly defaultModelId?: string;
}

export class GatewayProviderSettingsError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "GatewayProviderSettingsError";
	}
}

export interface SavedProviderSelection {
	readonly providerId: string;
	readonly settings: SavedProviderSettings;
}

export interface SavedProviderSummary {
	readonly providerId: string;
	readonly modelIds: string[];
}

/** List configured provider/model pairs without exposing credentials or options. */
export async function listSavedProviderSummaries(
	options: { filePath?: string; env?: Record<string, string | undefined> } = {},
): Promise<{ providers: SavedProviderSummary[]; selectedProviderId?: string }> {
	const filePath =
		options.filePath ?? gatewayProviderSettingsPath(options.env ?? process.env);
	if (!existsSync(filePath)) return { providers: [] };
	try {
		const parsed = StoredProviderSettingsSchema.parse(
			JSON.parse(readFileSync(filePath, "utf8")),
		);
		const providers = Object.entries(parsed.providers)
			.map(([providerId, entry]) => {
				if (entry.enabled === false) return undefined;
				const savedModel = entry.settings.model?.trim();
				const modelIds = savedModel ? [savedModel] : [];
				return modelIds.length > 0 ? { providerId, modelIds } : undefined;
			})
			.filter((provider): provider is SavedProviderSummary =>
				Boolean(provider),
			);
		return {
			providers,
			...(parsed.lastUsedProvider
				? { selectedProviderId: parsed.lastUsedProvider }
				: {}),
		};
	} catch {
		return { providers: [] };
	}
}

export function gatewayProviderSettingsPath(
	env: Record<string, string | undefined> = process.env,
): string {
	return (
		env.CLINE_PROVIDER_SETTINGS_PATH?.trim() || resolveProviderSettingsPath()
	);
}

function emptyProviderSettings(): StoredProviderSettings {
	return { version: 1, modes: {}, providers: {} };
}

function readProviderSettingsFile(
	filePath: string,
	options: { tolerateInvalid?: boolean } = {},
): StoredProviderSettings {
	if (!existsSync(filePath)) return emptyProviderSettings();
	try {
		return StoredProviderSettingsSchema.parse(
			JSON.parse(readFileSync(filePath, "utf8")),
		);
	} catch (error) {
		if (options.tolerateInvalid) return emptyProviderSettings();
		throw new GatewayProviderSettingsError(
			`Provider settings are invalid at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function writeProviderSettingsFile(
	filePath: string,
	state: StoredProviderSettings,
): void {
	mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
	const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
	try {
		writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, {
			mode: 0o600,
		});
		chmodSync(temporary, 0o600);
		renameSync(temporary, filePath);
		chmodSync(filePath, 0o600);
	} finally {
		rmSync(temporary, { force: true });
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Merge an explicit patch without touching omitted values. Empty strings and
 * null clear a field; nested objects are patched recursively. This is crucial
 * for credentials because catalog reads never return their values.
 */
function applyObjectPatch(
	current: unknown,
	patch: Record<string, unknown>,
): Record<string, unknown> | undefined {
	const next = isPlainObject(current) ? { ...current } : {};
	for (const [key, value] of Object.entries(patch)) {
		if (value === null || value === "") {
			delete next[key];
			continue;
		}
		if (isPlainObject(value)) {
			const merged = applyObjectPatch(next[key], value);
			if (merged && Object.keys(merged).length > 0) next[key] = merged;
			else delete next[key];
			continue;
		}
		if (value !== undefined) next[key] = value;
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

const SECRET_SETTING_KEY =
	/(?:api.?key|access.?key|secret|token|password|credential|headers?)/i;

function redactSettings(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(redactSettings);
	if (!isPlainObject(value)) return value;
	return Object.fromEntries(
		Object.entries(value)
			.filter(([key]) => !SECRET_SETTING_KEY.test(key))
			.map(([key, item]) => [key, redactSettings(item)]),
	);
}

function credentialPresence(
	settings: SavedProviderSettings,
): ProviderCredentialPresence {
	return {
		apiKey: Boolean(settings.apiKey?.trim() || settings.auth?.apiKey?.trim()),
		oauthAccessToken: Boolean(settings.auth?.accessToken?.trim()),
		oauthRefreshToken: Boolean(settings.auth?.refreshToken?.trim()),
	};
}

function uniqueTrimmed(values: readonly string[] | undefined): string[] {
	return [
		...new Set((values ?? []).map((value) => value.trim()).filter(Boolean)),
	];
}

function providerModel(id: string, info: ModelInfo): ProviderModel {
	return {
		id,
		name: info.name ?? id,
		operation: info.operation,
		operationModes: info.operationModes,
		contextWindow: info.contextWindow,
		supportsAttachments: info.capabilities?.includes("files"),
		supportsVision: info.capabilities?.includes("images"),
		supportsReasoning:
			info.capabilities?.includes("reasoning") || info.thinkingConfig != null,
		inputModalities: info.modalities?.input,
		outputModalities: info.modalities?.output,
	};
}

function modelCapabilities(
	capabilities: readonly ProviderCapability[] | undefined,
): ModelInfo["capabilities"] {
	if (!capabilities) return undefined;
	const values: NonNullable<ModelInfo["capabilities"]> = [];
	if (capabilities.includes("vision")) values.push("images", "files");
	for (const capability of [
		"reasoning",
		"tools",
		"streaming",
		"prompt-cache",
		"computer-use",
		"temperature",
	] as const) {
		if (capabilities.includes(capability)) values.push(capability);
	}
	return values.length > 0 ? [...new Set(values)] : undefined;
}

function definitionModels(definition: SavedProviderDefinition) {
	const capabilities = modelCapabilities(definition.capabilities);
	return Object.fromEntries(
		definition.models.map((id) => [
			id,
			{ id, name: id, ...(capabilities ? { capabilities } : {}) },
		]),
	);
}

function providerColor(id: string): string {
	const colors = [
		"#c4956a",
		"#6b8aad",
		"#e8963a",
		"#5b9bd5",
		"#6bbd7b",
		"#9b7dd4",
		"#d07f68",
		"#57a6a1",
	] as const;
	let hash = 0;
	for (const character of id) {
		hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
	}
	return colors[hash % colors.length] ?? colors[0];
}

function providerLetter(name: string): string {
	const words = name.split(/\s+/).filter(Boolean);
	if (words.length === 0) return "?";
	const first = words[0] ?? "?";
	if (words.length === 1) return first.slice(0, 2).toUpperCase();
	return `${first[0] ?? "?"}${words[1]?.[0] ?? ""}`.toUpperCase();
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

function isProviderConfigField(value: unknown): value is ProviderConfigField {
	if (!isPlainObject(value)) return false;
	return (
		typeof value.path === "string" &&
		value.path.trim().length > 0 &&
		typeof value.label === "string" &&
		value.label.trim().length > 0 &&
		["text", "password", "url", "number", "select", "boolean"].includes(
			String(value.type),
		)
	);
}

function providerConfigFields(
	info: Awaited<ReturnType<typeof getProvider>>,
): ProviderConfigField[] {
	const configured = info?.metadata?.configFields;
	if (Array.isArray(configured)) {
		const fields = configured.filter(isProviderConfigField);
		if (fields.length > 0) return fields;
	}
	if (!info) return [API_KEY_CONFIG_FIELD];
	if (info.source !== "system") {
		return info.baseUrl
			? [API_KEY_CONFIG_FIELD, BASE_URL_CONFIG_FIELD]
			: [API_KEY_CONFIG_FIELD];
	}
	return [
		...(info.env?.length ? [API_KEY_CONFIG_FIELD] : []),
		...(info.baseUrl ? [BASE_URL_CONFIG_FIELD] : []),
	];
}

function settingAtPath(settings: SavedProviderSettings, path: string): unknown {
	return path.split(".").reduce<unknown>((value, segment) => {
		return isPlainObject(value) ? value[segment] : undefined;
	}, settings);
}

function publicConfigValues(
	fields: readonly ProviderConfigField[],
	settings: SavedProviderSettings | undefined,
	info: Awaited<ReturnType<typeof getProvider>>,
): Record<string, ProviderConfigFieldPrimitive> | undefined {
	const values: Record<string, ProviderConfigFieldPrimitive> = {};
	for (const field of fields) {
		if (field.secret || SECRET_SETTING_KEY.test(field.path)) continue;
		const persisted =
			field.path === "baseUrl" && settings?.baseUrl === undefined
				? info?.baseUrl
				: settings
					? settingAtPath(settings, field.path)
					: undefined;
		const value = persisted ?? field.defaultValue;
		if (
			typeof value === "string" ||
			typeof value === "number" ||
			typeof value === "boolean" ||
			value === null
		) {
			values[field.path] = value;
		}
	}
	return Object.keys(values).length > 0 ? values : undefined;
}

function uniqueCapabilities(
	...values: Array<readonly ProviderCapability[] | undefined>
): ProviderCapability[] | undefined {
	const capabilities = [...new Set(values.flatMap((value) => value ?? []))];
	return capabilities.length > 0 ? capabilities : undefined;
}

function resolvedProviderSettings(
	state: StoredProviderSettings,
	providerId: string,
): SavedProviderSettings | undefined {
	const direct = state.providers[providerId]?.settings;
	if (providerId !== "cline-pass") return direct;
	const sharedCredentials = state.providers.cline?.settings;
	if (!sharedCredentials) return direct;
	return ProviderSettingsSchema.parse({
		...(sharedCredentials.auth ? { auth: sharedCredentials.auth } : {}),
		...(sharedCredentials.apiKey ? { apiKey: sharedCredentials.apiKey } : {}),
		...(sharedCredentials.baseUrl
			? { baseUrl: sharedCredentials.baseUrl }
			: {}),
		...(direct ?? {}),
		provider: providerId,
	});
}

function parseModelList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return uniqueTrimmed(
		value.map((item) => {
			if (typeof item === "string") return item;
			if (!isPlainObject(item)) return "";
			for (const key of ["id", "name", "model"] as const) {
				if (typeof item[key] === "string") return item[key];
			}
			return "";
		}),
	);
}

function modelIdsFromPayload(payload: unknown, providerId: string): string[] {
	const root = parseModelList(payload);
	if (root.length > 0) return root;
	if (!isPlainObject(payload)) return [];
	const direct = parseModelList(payload.data ?? payload.models);
	if (direct.length > 0) return direct;
	if (isPlainObject(payload.models)) {
		const keys = uniqueTrimmed(Object.keys(payload.models));
		if (keys.length > 0) return keys;
	}
	const providers = isPlainObject(payload.providers)
		? payload.providers
		: undefined;
	const scoped = providers?.[providerId];
	return isPlainObject(scoped) ? parseModelList(scoped.models ?? scoped) : [];
}

async function fetchProviderModels(
	url: string,
	providerId: string,
	headers?: Record<string, string>,
): Promise<string[]> {
	const response = await fetch(url, { headers });
	if (!response.ok) {
		throw new GatewayProviderSettingsError(
			`Failed to fetch models for ${providerId}: HTTP ${response.status}`,
		);
	}
	return modelIdsFromPayload(await response.json(), providerId);
}

/** Gateway-owned provider settings and catalog authority. */
export class GatewayProviderSettingsStore {
	readonly filePath: string;
	private readonly registeredModels = new Map<string, Set<string>>();

	constructor(options: { filePath?: string } = {}) {
		this.filePath = options.filePath ?? gatewayProviderSettingsPath();
		this.registerStoredDefinitions();
	}

	private read(): StoredProviderSettings {
		return readProviderSettingsFile(this.filePath);
	}

	private write(state: StoredProviderSettings): void {
		writeProviderSettingsFile(
			this.filePath,
			StoredProviderSettingsSchema.parse(state),
		);
	}

	private registerDefinition(
		providerId: string,
		definition: SavedProviderDefinition,
	): void {
		const models = definitionModels(definition);
		if (!BUILT_IN_PROVIDER_IDS.includes(providerId as never)) {
			registerProvider({
				provider: {
					id: providerId,
					name: definition.name,
					defaultModelId: definition.defaultModelId,
					client: definition.client ?? "openai-compatible",
					protocol: definition.protocol ?? "openai-chat",
					source: "file",
					...(definition.baseUrl ? { baseUrl: definition.baseUrl } : {}),
					...(definition.modelsSourceUrl
						? { modelsSourceUrl: definition.modelsSourceUrl }
						: {}),
					...(definition.capabilities
						? { capabilities: definition.capabilities }
						: {}),
				},
				models,
			});
			return;
		}
		for (const modelId of this.registeredModels.get(providerId) ?? []) {
			unregisterModel(providerId, modelId);
		}
		for (const [modelId, info] of Object.entries(models)) {
			registerModel(providerId, modelId, info);
		}
		this.registeredModels.set(providerId, new Set(Object.keys(models)));
	}

	private registerStoredDefinitions(): void {
		const state = readProviderSettingsFile(this.filePath, {
			tolerateInvalid: true,
		});
		for (const [providerId, entry] of Object.entries(state.providers)) {
			if (entry.definition) {
				this.registerDefinition(providerId, entry.definition);
			}
		}
	}

	get(providerId: string): PublicProviderSettings | undefined {
		const id = providerId.trim();
		const state = this.read();
		const entry = state.providers[id];
		if (!entry) return undefined;
		const settings = resolvedProviderSettings(state, id) ?? entry.settings;
		return {
			providerId: id,
			enabled: entry.enabled !== false,
			settings: redactSettings(settings) as Record<string, unknown>,
			credentials: credentialPresence(settings),
		};
	}

	patch(
		providerId: string,
		patch: ProviderSettingsPatch,
	): PublicProviderSettings {
		const id = providerId.trim();
		if (!id) throw new GatewayProviderSettingsError("providerId is required");
		const state = this.read();
		const previous = state.providers[id];
		const merged =
			applyObjectPatch(previous?.settings, patch.settings ?? {}) ?? {};
		const settings = ProviderSettingsSchema.parse({ ...merged, provider: id });
		state.providers[id] = {
			...previous,
			settings,
			enabled: patch.enabled ?? previous?.enabled ?? true,
			updatedAt: new Date().toISOString(),
			tokenSource: previous?.tokenSource ?? "manual",
		};
		if (
			state.providers[id].enabled === false &&
			state.lastUsedProvider === id
		) {
			delete state.lastUsedProvider;
		}
		this.write(state);
		return this.get(id) as PublicProviderSettings;
	}

	async add(input: AddGatewayProviderInput): Promise<{
		providerId: string;
		modelsCount: number;
		settingsPath: string;
	}> {
		const providerId = input.providerId.trim().toLowerCase();
		if (!/^[a-z0-9][a-z0-9_-]*$/.test(providerId)) {
			throw new GatewayProviderSettingsError(
				"providerId must contain lowercase letters, digits, hyphens, or underscores",
			);
		}
		const state = this.read();
		if (state.providers[providerId] || hasProvider(providerId)) {
			throw new GatewayProviderSettingsError(
				`Provider "${providerId}" already exists`,
			);
		}
		const name = input.name.trim();
		const baseUrl = input.baseUrl.trim();
		if (!name) throw new GatewayProviderSettingsError("name is required");
		if (!baseUrl) throw new GatewayProviderSettingsError("baseUrl is required");
		const modelsSourceUrl = input.modelsSourceUrl?.trim() || undefined;
		const fetched = modelsSourceUrl
			? await fetchProviderModels(modelsSourceUrl, providerId, input.headers)
			: [];
		const models = uniqueTrimmed([...(input.models ?? []), ...fetched]);
		if (models.length === 0) {
			throw new GatewayProviderSettingsError("At least one model is required");
		}
		const requestedDefault = input.defaultModelId?.trim();
		const defaultModelId =
			requestedDefault && models.includes(requestedDefault)
				? requestedDefault
				: (models[0] as string);
		const definition = ProviderDefinitionSchema.parse({
			name,
			baseUrl,
			defaultModelId,
			models,
			modelsSourceUrl,
			protocol: input.protocol ?? "openai-chat",
			client: input.client ?? "openai-compatible",
			capabilities: input.capabilities,
		});
		state.providers[providerId] = {
			settings: ProviderSettingsSchema.parse({
				provider: providerId,
				model: defaultModelId,
				apiKey: input.apiKey?.trim() || undefined,
				baseUrl,
				headers: input.headers,
				timeout: input.timeoutMs,
				protocol: definition.protocol,
				client: definition.client,
				capabilities: definition.capabilities,
			}),
			enabled: true,
			definition,
			updatedAt: new Date().toISOString(),
			tokenSource: "manual",
		};
		this.write(state);
		this.registerDefinition(providerId, definition);
		return {
			providerId,
			modelsCount: models.length,
			settingsPath: this.filePath,
		};
	}

	async models(providerId: string): Promise<ProviderModelsResponse> {
		const id = providerId.trim();
		if (!id) throw new GatewayProviderSettingsError("providerId is required");
		const entry = this.read().providers[id];
		const models = entry?.definition
			? definitionModels(entry.definition)
			: await getModelsForProvider(id);
		return {
			providerId: id,
			models: Object.entries(models)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([modelId, info]) => providerModel(modelId, info)),
		};
	}

	async updateModels(input: UpdateGatewayProviderModelsInput): Promise<{
		providerId: string;
		modelsCount: number;
	}> {
		const providerId = input.providerId.trim();
		const models = uniqueTrimmed(input.models);
		if (!providerId)
			throw new GatewayProviderSettingsError("providerId is required");
		if (models.length === 0)
			throw new GatewayProviderSettingsError("At least one model is required");
		const state = this.read();
		const entry = state.providers[providerId];
		const registered = await getProvider(providerId);
		if (!entry && !registered) {
			throw new GatewayProviderSettingsError(
				`Unknown provider "${providerId}"`,
			);
		}
		const requestedDefault = input.defaultModelId?.trim();
		const existingDefault = entry?.definition?.defaultModelId;
		const defaultModelId =
			(requestedDefault && models.includes(requestedDefault)
				? requestedDefault
				: undefined) ??
			(existingDefault && models.includes(existingDefault)
				? existingDefault
				: models[0]);
		const definition = ProviderDefinitionSchema.parse({
			name: entry?.definition?.name ?? registered?.name ?? providerId,
			baseUrl:
				entry?.definition?.baseUrl ??
				entry?.settings.baseUrl ??
				registered?.baseUrl,
			defaultModelId,
			models,
			modelsSourceUrl:
				entry?.definition?.modelsSourceUrl ?? registered?.modelsSourceUrl,
			protocol:
				entry?.definition?.protocol ??
				entry?.settings.protocol ??
				registered?.protocol,
			client:
				entry?.definition?.client ??
				(entry?.settings.client as ProviderClient | undefined) ??
				registered?.client,
			capabilities:
				entry?.definition?.capabilities ??
				entry?.settings.capabilities ??
				registered?.capabilities,
		});
		state.providers[providerId] = {
			...entry,
			settings: ProviderSettingsSchema.parse({
				...(entry?.settings ?? {}),
				provider: providerId,
				model: defaultModelId,
			}),
			enabled: entry?.enabled ?? true,
			definition,
			updatedAt: new Date().toISOString(),
			tokenSource: entry?.tokenSource ?? "manual",
		};
		this.write(state);
		this.registerDefinition(providerId, definition);
		return { providerId, modelsCount: models.length };
	}

	async catalog(): Promise<ProviderCatalogResponse> {
		const state = this.read();
		const providers: Array<ProviderListItem & { _rank: number }> =
			await Promise.all(
				getProviderIds().map(async (id: string) => {
					const entry = state.providers[id];
					const [info, models] = await Promise.all([
						getProvider(id),
						this.models(id),
					]);
					const name = entry?.definition?.name ?? info?.name ?? id;
					const settings = resolvedProviderSettings(state, id);
					const configFields = providerConfigFields(info);
					const configValues = publicConfigValues(configFields, settings, info);
					const capabilities = uniqueCapabilities(
						info?.capabilities,
						entry?.definition?.capabilities,
						settings?.capabilities,
					);
					return {
						id,
						name,
						models: models.models.length,
						color: providerColor(id),
						letter: providerLetter(name),
						enabled: Boolean(entry && entry.enabled !== false),
						oauthAccessTokenPresent: entry
							? Boolean(settings?.auth?.accessToken?.trim())
							: undefined,
						baseUrl:
							settings?.baseUrl ?? entry?.definition?.baseUrl ?? info?.baseUrl,
						defaultModelId:
							settings?.model ??
							entry?.definition?.defaultModelId ??
							info?.defaultModelId,
						protocol:
							settings?.protocol ??
							entry?.definition?.protocol ??
							info?.protocol,
						client:
							(settings?.client as ProviderClient | undefined) ??
							entry?.definition?.client ??
							info?.client,
						capabilities,
						authDescription: info?.capabilities?.includes("oauth")
							? "This provider supports account authentication."
							: "Credentials are stored by the Gateway and are never returned to clients.",
						baseUrlDescription:
							"The base endpoint used by the Gateway for provider requests.",
						configFields,
						...(configValues ? { configValues } : {}),
						modelList: models.models,
						_rank:
							typeof info?.metadata?.popularRank === "number"
								? info.metadata.popularRank
								: Number.MAX_SAFE_INTEGER,
					} satisfies ProviderListItem & { _rank: number };
				}),
			);
		providers.sort(
			(left, right) =>
				left._rank - right._rank ||
				left.name.localeCompare(right.name) ||
				left.id.localeCompare(right.id),
		);
		return {
			providers: providers.map(({ _rank, ...provider }) => provider),
			settingsPath: this.filePath,
		};
	}
}

/** Read the selected provider from the Gateway-owned providers.json store. */
export function readSavedProviderSelection(
	providerId: string | undefined,
	options: {
		filePath?: string;
		env?: Record<string, string | undefined>;
	} = {},
): SavedProviderSelection | undefined {
	const filePath =
		options.filePath ?? gatewayProviderSettingsPath(options.env ?? process.env);
	if (!existsSync(filePath)) return undefined;

	let parsed: z.infer<typeof StoredProviderSettingsSchema>;
	try {
		parsed = StoredProviderSettingsSchema.parse(
			JSON.parse(readFileSync(filePath, "utf8")),
		);
	} catch {
		return undefined;
	}

	const selectedProviderId = providerId ?? parsed.lastUsedProvider;
	if (!selectedProviderId) return undefined;
	const directEntry = parsed.providers[selectedProviderId];
	const direct =
		directEntry?.enabled === false ? undefined : directEntry?.settings;
	if (!direct) return undefined;

	// Cline Pass shares the Cline OAuth credential bucket in the existing
	// provider store while retaining its own model selection.
	const credentialSettings =
		selectedProviderId === "cline-pass"
			? parsed.providers.cline?.settings
			: undefined;
	return {
		providerId: selectedProviderId,
		settings: {
			...(credentialSettings?.apiKey
				? { apiKey: credentialSettings.apiKey }
				: {}),
			...(credentialSettings?.auth ? { auth: credentialSettings.auth } : {}),
			...direct,
		},
	};
}

function compact(
	value: Record<string, unknown>,
): Record<string, unknown> | undefined {
	const entries = Object.entries(value).filter(
		([, item]) => item !== undefined,
	);
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** Translate persisted provider-specific settings to @cline/llms options. */
export function savedProviderOptions(
	settings: SavedProviderSettings,
): Record<string, unknown> | undefined {
	const options: Record<string, unknown> = {
		region: settings.region,
		apiLine: settings.apiLine,
	};

	if (
		settings.provider === "openai-compatible" ||
		settings.client === "openai-compatible"
	) {
		Object.assign(options, {
			apiVersion: settings.azure?.apiVersion,
			useIdentity: settings.azure?.useIdentity,
		});
	}
	if (settings.provider === "bedrock") {
		Object.assign(options, {
			authentication: settings.aws?.authentication,
			profile: settings.aws?.profile,
			accessKeyId: settings.aws?.accessKey,
			secretAccessKey: settings.aws?.secretKey,
			sessionToken: settings.aws?.sessionToken,
			usePromptCache: settings.aws?.usePromptCache,
			useCrossRegionInference: settings.aws?.useCrossRegionInference,
			useGlobalInference: settings.aws?.useGlobalInference,
			endpoint: settings.aws?.endpoint,
			customModelBaseId: settings.aws?.customModelBaseId,
		});
	}
	if (settings.provider === "vertex") {
		const region = settings.gcp?.region ?? settings.region;
		Object.assign(options, {
			project: settings.gcp?.projectId,
			projectId: settings.gcp?.projectId,
			location: region,
			region,
		});
	}
	if (settings.provider === "sapaicore") {
		Object.assign(options, settings.sap);
	}

	return compact(options);
}

/** Resolve the credential shape expected by the provider gateway. */
export function savedProviderApiKey(
	providerId: string,
	settings: SavedProviderSettings,
): string | undefined {
	const credential =
		settings.auth?.accessToken?.trim() ||
		settings.apiKey?.trim() ||
		settings.auth?.apiKey?.trim();
	if (!credential) return undefined;
	if (providerId === "cline" || providerId === "cline-pass") {
		return credential.toLowerCase().startsWith("workos:")
			? credential
			: `workos:${credential}`;
	}
	return credential;
}

const OAUTH_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** Refresh the shared Cline OAuth bucket and atomically persist token rotation. */
export async function resolveSavedClineOAuthApiKey(
	providerId: string,
	options: { filePath?: string; env?: Record<string, string | undefined> } = {},
): Promise<string | undefined> {
	if (providerId !== "cline" && providerId !== "cline-pass") return undefined;
	const filePath =
		options.filePath ?? gatewayProviderSettingsPath(options.env ?? process.env);
	if (!existsSync(filePath)) return undefined;

	const stored = StoredProviderSettingsSchema.parse(
		JSON.parse(readFileSync(filePath, "utf8")),
	);
	const settings = stored.providers.cline?.settings;
	const auth = settings?.auth;
	const access = auth?.accessToken?.trim();
	const refresh = auth?.refreshToken?.trim();
	if (!auth || !access || !refresh) return undefined;
	const expires = auth.expiresAt ?? 0;
	if (Date.now() < expires - OAUTH_REFRESH_BUFFER_MS) {
		return savedProviderApiKey(providerId, settings);
	}

	const next = await refreshClineOAuthCredentials(
		{
			access: access.toLowerCase().startsWith("workos:")
				? access.slice(7)
				: access,
			refresh,
			expires,
			accountId: auth.accountId,
			metadata: auth.metadata,
		},
		{
			apiBaseUrl:
				settings.baseUrl?.trim() || getClineEnvironmentConfig().apiBaseUrl,
			provider:
				typeof auth.metadata?.provider === "string"
					? auth.metadata.provider
					: undefined,
		},
	);
	const updated = {
		...stored,
		providers: {
			...stored.providers,
			cline: {
				...stored.providers.cline,
				settings: {
					...settings,
					auth: {
						...auth,
						accessToken: next.access,
						refreshToken: next.refresh,
						expiresAt: next.expires,
						accountId: next.accountId,
						metadata: next.metadata,
					},
				},
				updatedAt: new Date().toISOString(),
				tokenSource: "oauth",
			},
		},
	};
	const temporary = `${filePath}.${process.pid}.tmp`;
	try {
		writeFileSync(temporary, `${JSON.stringify(updated, null, 2)}\n`, {
			mode: 0o600,
		});
		chmodSync(temporary, 0o600);
		renameSync(temporary, filePath);
	} finally {
		rmSync(temporary, { force: true });
	}
	return `workos:${next.access}`;
}
