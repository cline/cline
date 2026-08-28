import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as LlmsModels from "@cline/llms";
import { ReasoningLevelSchema } from "@cline/shared";
import { resolveClineDataDir } from "@cline/shared/storage";
import {
	emptyStoredProviderSettings,
	type ProviderSettings,
	ProviderSettingsSchemaTyped as ProviderSettingsSchema,
} from "../../types/provider-settings";
import {
	readModelsFileSync,
	type StoredModelEntry,
	type StoredModelsFile,
	writeModelsFileSync,
} from "../providers/local-provider-registry";
import type { ProviderSettingsManager } from "./provider-settings-manager";

type LegacyMode = "plan" | "act";

/**
 * Legacy `OpenAiCompatibleModelInfo` snapshot persisted by the old extension
 * under `planModeOpenAiModelInfo` / `actModeOpenAiModelInfo`. Only the
 * user-editable fields the legacy settings form exposed are read here.
 */
interface LegacyOpenAiModelInfo {
	maxTokens?: number;
	contextWindow?: number;
	supportsImages?: boolean;
	supportsPromptCache?: boolean;
	inputPrice?: number;
	outputPrice?: number;
	temperature?: number;
}

interface LegacyGlobalState {
	mode?: LegacyMode;
	planModeApiProvider?: string;
	actModeApiProvider?: string;
	planModeApiModelId?: string;
	actModeApiModelId?: string;
	planModeReasoningEffort?: string;
	actModeReasoningEffort?: string;
	planModeOcaReasoningEffort?: string;
	actModeOcaReasoningEffort?: string;
	planModeThinkingBudgetTokens?: number;
	actModeThinkingBudgetTokens?: number;
	geminiPlanModeThinkingLevel?: string;
	geminiActModeThinkingLevel?: string;
	anthropicBaseUrl?: string;
	openAiBaseUrl?: string;
	ollamaBaseUrl?: string;
	lmStudioBaseUrl?: string;
	liteLlmBaseUrl?: string;
	geminiBaseUrl?: string;
	requestyBaseUrl?: string;
	asksageApiUrl?: string;
	difyBaseUrl?: string;
	ocaBaseUrl?: string;
	aihubmixBaseUrl?: string;
	openAiHeaders?: Record<string, string>;
	requestTimeoutMs?: number;
	awsRegion?: string;
	awsAuthentication?: "credentials" | "iam" | "api-key" | "apikey" | "profile";
	awsUseProfile?: boolean;
	awsProfile?: string;
	awsUseCrossRegionInference?: boolean;
	awsUseGlobalInference?: boolean;
	awsBedrockUsePromptCache?: boolean;
	awsBedrockEndpoint?: string;
	planModeAwsBedrockCustomModelBaseId?: string;
	actModeAwsBedrockCustomModelBaseId?: string;
	vertexProjectId?: string;
	vertexRegion?: string;
	azureApiVersion?: string;
	azureIdentity?: boolean;
	sapAiCoreTokenUrl?: string;
	sapAiCoreBaseUrl?: string;
	sapAiResourceGroup?: string;
	sapAiCoreUseOrchestrationMode?: boolean;
	ocaMode?: "internal" | "external";
	qwenApiLine?: "china" | "international";
	moonshotApiLine?: "china" | "international";
	zaiApiLine?: "china" | "international";
	minimaxApiLine?: "china" | "international";
	planModeOpenRouterModelId?: string;
	actModeOpenRouterModelId?: string;
	planModeClineModelId?: string;
	actModeClineModelId?: string;
	planModeOpenAiModelId?: string;
	actModeOpenAiModelId?: string;
	planModeOpenAiModelInfo?: LegacyOpenAiModelInfo;
	actModeOpenAiModelInfo?: LegacyOpenAiModelInfo;
	planModeOllamaModelId?: string;
	actModeOllamaModelId?: string;
	planModeLmStudioModelId?: string;
	actModeLmStudioModelId?: string;
	planModeLiteLlmModelId?: string;
	actModeLiteLlmModelId?: string;
	planModeRequestyModelId?: string;
	actModeRequestyModelId?: string;
	planModeTogetherModelId?: string;
	actModeTogetherModelId?: string;
	planModeFireworksModelId?: string;
	actModeFireworksModelId?: string;
	planModeSapAiCoreModelId?: string;
	actModeSapAiCoreModelId?: string;
	planModeSapAiCoreDeploymentId?: string;
	actModeSapAiCoreDeploymentId?: string;
	planModeGroqModelId?: string;
	actModeGroqModelId?: string;
	planModeBasetenModelId?: string;
	actModeBasetenModelId?: string;
	planModeHuggingFaceModelId?: string;
	actModeHuggingFaceModelId?: string;
	planModeHuaweiCloudMaasModelId?: string;
	actModeHuaweiCloudMaasModelId?: string;
	planModeOcaModelId?: string;
	actModeOcaModelId?: string;
	planModeAihubmixModelId?: string;
	actModeAihubmixModelId?: string;
	planModeHicapModelId?: string;
	actModeHicapModelId?: string;
	planModeNousResearchModelId?: string;
	actModeNousResearchModelId?: string;
	planModeVercelAiGatewayModelId?: string;
	actModeVercelAiGatewayModelId?: string;
}

interface LegacySecrets {
	apiKey?: string;
	clineApiKey?: string;
	"cline:clineAccountId"?: string;
	clineAccountId?: string;
	openRouterApiKey?: string;
	awsAccessKey?: string;
	awsSecretKey?: string;
	awsSessionToken?: string;
	awsBedrockApiKey?: string;
	openAiApiKey?: string;
	geminiApiKey?: string;
	openAiNativeApiKey?: string;
	ollamaApiKey?: string;
	deepSeekApiKey?: string;
	requestyApiKey?: string;
	togetherApiKey?: string;
	fireworksApiKey?: string;
	qwenApiKey?: string;
	doubaoApiKey?: string;
	mistralApiKey?: string;
	liteLlmApiKey?: string;
	asksageApiKey?: string;
	xaiApiKey?: string;
	moonshotApiKey?: string;
	zaiApiKey?: string;
	huggingFaceApiKey?: string;
	nebiusApiKey?: string;
	sambanovaApiKey?: string;
	cerebrasApiKey?: string;
	sapAiCoreClientId?: string;
	sapAiCoreClientSecret?: string;
	groqApiKey?: string;
	huaweiCloudMaasApiKey?: string;
	basetenApiKey?: string;
	vercelAiGatewayApiKey?: string;
	difyApiKey?: string;
	minimaxApiKey?: string;
	hicapApiKey?: string;
	aihubmixApiKey?: string;
	nousResearchApiKey?: string;
	ocaApiKey?: string;
	ocaRefreshToken?: string;
	"openai-codex-oauth-credentials"?: string;
}

interface LegacyProviderStorage {
	globalState: LegacyGlobalState;
	secrets: LegacySecrets;
}

const LEGACY_OPENAI_COMPATIBLE_PROVIDER_ID = "openai";
const OPENAI_COMPATIBLE_PROVIDER_ID =
	LlmsModels.BUILT_IN_PROVIDER.OPENAI_COMPATIBLE;
const LEGACY_OPENAI_COMPATIBLE_CONTEXT_WINDOW = 128_000;

export interface MigrateLegacyProviderSettingsOptions {
	providerSettingsManager: ProviderSettingsManager;
	dataDir?: string;
	globalStatePath?: string;
	secretsPath?: string;
}

export interface MigrateLegacyProviderSettingsResult {
	migrated: boolean;
	providerCount: number;
	lastUsedProvider?: string;
}

export type LegacyClineUserInfo = {
	idToken: string;
	expiresAt: number;
	refreshToken: string;
	userInfo: {
		id: string;
		email: string;
		displayName: string;
		termsAcceptedAt: string;
		clineBenchConsent: boolean;
		createdAt: string;
		updatedAt: string;
	};
	provider: string;
	startedAt: number;
};

/**
 * Resolves legacy Cline account auth data from the raw `cline:clineAccountId`
 * secret string into the auth fields used by `ProviderSettings`.
 *
 * Returns `undefined` when the input is missing, empty, whitespace-only, or
 * unparseable JSON.
 */
export function resolveLegacyClineAuth(
	rawAccountData: string | undefined,
): ProviderSettings["auth"] | undefined {
	const trimmed = rawAccountData?.trim();
	if (!trimmed) {
		return undefined;
	}
	try {
		const data = JSON.parse(trimmed) as LegacyClineUserInfo;
		if (!data) {
			return undefined;
		}
		const expiresAt =
			typeof data.expiresAt === "number" && Number.isFinite(data.expiresAt)
				? // Classic VS Code auth stored expiresAt in seconds; providers.json uses
					// milliseconds. Preserve millisecond-looking values for compatibility
					// with tests/older migration attempts.
					data.expiresAt < 10_000_000_000
					? data.expiresAt * 1000
					: data.expiresAt
				: undefined;
		return {
			accessToken: data.idToken,
			refreshToken: data.refreshToken,
			expiresAt,
			accountId: data.userInfo?.id,
		};
	} catch {
		return undefined;
	}
}

function trimNonEmpty(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function normalizeLegacyBedrockAuthentication(
	authentication: LegacyGlobalState["awsAuthentication"],
): "iam" | "api-key" | "apikey" | "profile" | undefined {
	return authentication === "credentials" ? "iam" : authentication;
}

function readJsonObject<T extends object>(filePath: string): T | undefined {
	if (!existsSync(filePath)) {
		return undefined;
	}
	try {
		const raw = readFileSync(filePath, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as T;
		}
	} catch {
		// Invalid legacy file should not block startup.
	}
	return undefined;
}

function resolveLegacyStorage(
	options: MigrateLegacyProviderSettingsOptions,
): LegacyProviderStorage | undefined {
	const dataDir = options.dataDir ?? resolveClineDataDir();
	const globalStatePath =
		options.globalStatePath ?? join(dataDir, "globalState.json");
	const secretsPath = options.secretsPath ?? join(dataDir, "secrets.json");
	const globalState = readJsonObject<LegacyGlobalState>(globalStatePath);
	const secrets = readJsonObject<LegacySecrets>(secretsPath);
	if (!globalState && !secrets) {
		return undefined;
	}
	return {
		globalState: globalState ?? {},
		secrets: secrets ?? {},
	};
}

function resolveMigratedProviderId(providerId: string): string {
	// normalizeProviderId maps "openai" -> "openai-compatible" and collapses
	// the remaining declared aliases (e.g. "togetherai" -> "together").
	return LlmsModels.normalizeProviderId(providerId);
}

/**
 * Collapses declared provider-id aliases (e.g. "togetherai" -> "together") to
 * the ids used by this module's legacy lookup tables. "openai" is kept as-is:
 * it is the legacy id for the OpenAI-compatible provider and only becomes
 * "openai-compatible" at the final resolveMigratedProviderId boundary.
 */
function normalizeLegacyProviderId(providerId: string): string {
	if (providerId === LEGACY_OPENAI_COMPATIBLE_PROVIDER_ID) {
		return providerId;
	}
	return LlmsModels.normalizeProviderId(providerId);
}

function resolveModelForProvider(
	legacy: LegacyGlobalState,
	providerId: string,
	mode: LegacyMode,
	activeProviderForMode: string | undefined,
): string | undefined {
	const modePrefix = mode === "plan" ? "planMode" : "actMode";
	const fallbackModel =
		providerId === activeProviderForMode
			? trimNonEmpty(
					mode === "plan"
						? legacy.planModeApiModelId
						: legacy.actModeApiModelId,
				)
			: undefined;
	const providerModelKeyById: Record<string, keyof LegacyGlobalState> = {
		openrouter: `${modePrefix}OpenRouterModelId` as keyof LegacyGlobalState,
		cline: `${modePrefix}ClineModelId` as keyof LegacyGlobalState,
		openai: `${modePrefix}OpenAiModelId` as keyof LegacyGlobalState,
		ollama: `${modePrefix}OllamaModelId` as keyof LegacyGlobalState,
		lmstudio: `${modePrefix}LmStudioModelId` as keyof LegacyGlobalState,
		litellm: `${modePrefix}LiteLlmModelId` as keyof LegacyGlobalState,
		requesty: `${modePrefix}RequestyModelId` as keyof LegacyGlobalState,
		together: `${modePrefix}TogetherModelId` as keyof LegacyGlobalState,
		fireworks: `${modePrefix}FireworksModelId` as keyof LegacyGlobalState,
		sapaicore: `${modePrefix}SapAiCoreModelId` as keyof LegacyGlobalState,
		groq: `${modePrefix}GroqModelId` as keyof LegacyGlobalState,
		baseten: `${modePrefix}BasetenModelId` as keyof LegacyGlobalState,
		huggingface: `${modePrefix}HuggingFaceModelId` as keyof LegacyGlobalState,
		"huawei-cloud-maas":
			`${modePrefix}HuaweiCloudMaasModelId` as keyof LegacyGlobalState,
		oca: `${modePrefix}OcaModelId` as keyof LegacyGlobalState,
		aihubmix: `${modePrefix}AihubmixModelId` as keyof LegacyGlobalState,
		hicap: `${modePrefix}HicapModelId` as keyof LegacyGlobalState,
		nousResearch: `${modePrefix}NousResearchModelId` as keyof LegacyGlobalState,
		"vercel-ai-gateway":
			`${modePrefix}VercelAiGatewayModelId` as keyof LegacyGlobalState,
	};
	const providerModelKey = providerModelKeyById[providerId];
	const providerModel = providerModelKey
		? trimNonEmpty(
				typeof legacy[providerModelKey] === "string"
					? (legacy[providerModelKey] as string)
					: undefined,
			)
		: undefined;
	return providerModel ?? fallbackModel;
}

function resolveReasoning(
	legacy: LegacyGlobalState,
	providerId: string,
	mode: LegacyMode,
): ProviderSettings["reasoning"] | undefined {
	const budgetTokens =
		mode === "plan"
			? legacy.planModeThinkingBudgetTokens
			: legacy.actModeThinkingBudgetTokens;
	// ProviderSettings has one reasoning effort; legacy state had mode-specific
	// fields, with OCA/Gemini using provider-specific variants.
	const rawEffort = [
		...(providerId === "oca"
			? [legacy.actModeOcaReasoningEffort, legacy.planModeOcaReasoningEffort]
			: []),
		...(providerId === "gemini"
			? [legacy.geminiActModeThinkingLevel, legacy.geminiPlanModeThinkingLevel]
			: []),
		legacy.actModeReasoningEffort,
		legacy.planModeReasoningEffort,
	]
		.map(trimNonEmpty)
		.find(Boolean);
	const parsedEffort = ReasoningLevelSchema.safeParse(rawEffort);
	const effort = parsedEffort.success ? parsedEffort.data : undefined;
	const normalizedBudget =
		typeof budgetTokens === "number" &&
		Number.isInteger(budgetTokens) &&
		budgetTokens > 0
			? budgetTokens
			: undefined;
	if (!effort && normalizedBudget === undefined) {
		return undefined;
	}
	return {
		...(effort ? { effort } : {}),
		...(normalizedBudget !== undefined
			? { budgetTokens: normalizedBudget }
			: {}),
	};
}

function resolveLegacyCodexAuth(
	legacySecrets: LegacySecrets,
): Pick<ProviderSettings, "apiKey" | "auth"> | undefined {
	const raw = legacySecrets["openai-codex-oauth-credentials"];
	if (!raw) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(raw) as {
			access_token?: string;
			refresh_token?: string;
			accountId?: string;
		};
		const access = trimNonEmpty(parsed.access_token);
		const refresh = trimNonEmpty(parsed.refresh_token);
		const accountId = trimNonEmpty(parsed.accountId);
		if (!access && !refresh && !accountId) {
			return undefined;
		}
		return {
			...(access ? { apiKey: access } : {}),
			auth: {
				...(access ? { accessToken: access } : {}),
				...(refresh ? { refreshToken: refresh } : {}),
				...(accountId ? { accountId } : {}),
			},
		};
	} catch {
		return undefined;
	}
}

function getDefaultModelForProvider(providerId: string): string | undefined {
	const builtInModels = LlmsModels.getGeneratedModelsForProvider(providerId);
	const providerCollection = LlmsModels.getProviderCollectionSync(providerId);
	const defaultModelId = providerCollection?.provider.defaultModelId;
	// The declared default may live only in the collection's model list (e.g.
	// Cline's generated block holds a few free models while its default,
	// anthropic/claude-sonnet-5, comes from the collection catalog).
	if (
		defaultModelId &&
		(builtInModels[defaultModelId] ||
			providerCollection?.models?.[defaultModelId])
	) {
		return defaultModelId;
	}

	const firstModelId = Object.keys(builtInModels)[0];
	return firstModelId ?? undefined;
}

/**
 * Cline is a fixed-catalog provider: an unknown legacy model id (retired
 * model, a suffixed variant like `...:1m`, corrupted state) would otherwise
 * be carried into inference requests as-is. Resolve the legacy id against the
 * runtime catalog (the collection model list, which `buildClineModels` in
 * @cline/llms mirrors), folding alias spellings onto their canonical ids
 * (e.g. OpenRouter's `z-ai/...` -> `zai/...`) so those users keep their
 * model. Returns undefined for unavailable models so the caller falls back
 * to the catalog default.
 */
function resolveKnownClineModel(
	providerId: string,
	modelId: string | undefined,
): string | undefined {
	if (!modelId || providerId !== "cline") {
		return modelId;
	}
	const catalogModels =
		LlmsModels.getProviderCollectionSync(providerId)?.models;
	if (!catalogModels) {
		return modelId;
	}
	if (catalogModels[modelId]) {
		return modelId;
	}
	for (const rule of LlmsModels.VERCEL_OPENROUTER_MODEL_ID_ALIAS_RULES) {
		if (!modelId.startsWith(rule.aliasPrefix)) {
			continue;
		}
		const canonicalModelId = `${rule.canonicalPrefix}${modelId.slice(rule.aliasPrefix.length)}`;
		if (catalogModels[canonicalModelId]) {
			return canonicalModelId;
		}
	}
	return undefined;
}

function buildLegacyProviderSettings(
	providerId: string,
	legacyGlobalState: LegacyGlobalState,
	legacySecrets: LegacySecrets,
	mode: LegacyMode,
): ProviderSettings | undefined {
	const targetProviderId = resolveMigratedProviderId(providerId);
	const rawActiveProviderForMode = trimNonEmpty(
		mode === "plan"
			? legacyGlobalState.planModeApiProvider
			: legacyGlobalState.actModeApiProvider,
	);
	const activeProviderForMode = rawActiveProviderForMode
		? normalizeLegacyProviderId(rawActiveProviderForMode)
		: undefined;
	const model =
		resolveKnownClineModel(
			targetProviderId,
			resolveModelForProvider(
				legacyGlobalState,
				providerId,
				mode,
				activeProviderForMode,
			),
		) ?? getDefaultModelForProvider(targetProviderId);
	const reasoning = resolveReasoning(legacyGlobalState, targetProviderId, mode);
	const timeout =
		typeof legacyGlobalState.requestTimeoutMs === "number" &&
		Number.isInteger(legacyGlobalState.requestTimeoutMs) &&
		legacyGlobalState.requestTimeoutMs > 0
			? legacyGlobalState.requestTimeoutMs
			: undefined;

	const secretByProvider: Record<string, string | undefined> = {
		anthropic: legacySecrets.apiKey,
		cline: legacySecrets.clineApiKey,
		openai: legacySecrets.openAiApiKey,
		"openai-native": legacySecrets.openAiNativeApiKey,
		openrouter: legacySecrets.openRouterApiKey,
		bedrock: legacySecrets.awsBedrockApiKey,
		gemini: legacySecrets.geminiApiKey,
		ollama: legacySecrets.ollamaApiKey,
		deepseek: legacySecrets.deepSeekApiKey,
		requesty: legacySecrets.requestyApiKey,
		together: legacySecrets.togetherApiKey,
		fireworks: legacySecrets.fireworksApiKey,
		qwen: legacySecrets.qwenApiKey,
		doubao: legacySecrets.doubaoApiKey,
		mistral: legacySecrets.mistralApiKey,
		litellm: legacySecrets.liteLlmApiKey,
		asksage: legacySecrets.asksageApiKey,
		xai: legacySecrets.xaiApiKey,
		moonshot: legacySecrets.moonshotApiKey,
		zai: legacySecrets.zaiApiKey,
		huggingface: legacySecrets.huggingFaceApiKey,
		nebius: legacySecrets.nebiusApiKey,
		sambanova: legacySecrets.sambanovaApiKey,
		cerebras: legacySecrets.cerebrasApiKey,
		groq: legacySecrets.groqApiKey,
		"huawei-cloud-maas": legacySecrets.huaweiCloudMaasApiKey,
		baseten: legacySecrets.basetenApiKey,
		"vercel-ai-gateway": legacySecrets.vercelAiGatewayApiKey,
		dify: legacySecrets.difyApiKey,
		minimax: legacySecrets.minimaxApiKey,
		hicap: legacySecrets.hicapApiKey,
		aihubmix: legacySecrets.aihubmixApiKey,
		nousResearch: legacySecrets.nousResearchApiKey,
		oca: legacySecrets.ocaApiKey,
	};

	const providerSpecific: Partial<ProviderSettings> = {};
	if (providerId === "openai-codex") {
		Object.assign(providerSpecific, resolveLegacyCodexAuth(legacySecrets));
	}
	if (providerId === "cline") {
		try {
			const legacyAuthString = trimNonEmpty(
				legacySecrets["cline:clineAccountId"],
			);

			if (legacyAuthString) {
				providerSpecific.auth = {
					...(providerSpecific.auth ?? {}),
					...resolveLegacyClineAuth(legacyAuthString),
				};
			}
		} catch {
			// Failed to parse stored cline auth data
		}
	}
	if (
		providerId === LEGACY_OPENAI_COMPATIBLE_PROVIDER_ID &&
		legacyGlobalState.openAiHeaders
	) {
		providerSpecific.headers = legacyGlobalState.openAiHeaders;
	}
	if (providerId === "bedrock") {
		const bedrockAuthentication = normalizeLegacyBedrockAuthentication(
			legacyGlobalState.awsAuthentication,
		);
		const useBedrockProfile =
			bedrockAuthentication === "profile" ||
			legacyGlobalState.awsUseProfile === true;
		providerSpecific.aws = {
			accessKey: trimNonEmpty(legacySecrets.awsAccessKey),
			secretKey: trimNonEmpty(legacySecrets.awsSecretKey),
			sessionToken: trimNonEmpty(legacySecrets.awsSessionToken),
			region: trimNonEmpty(legacyGlobalState.awsRegion),
			authentication: bedrockAuthentication,
			profile: useBedrockProfile
				? trimNonEmpty(legacyGlobalState.awsProfile)
				: undefined,
			usePromptCache: legacyGlobalState.awsBedrockUsePromptCache,
			useCrossRegionInference: legacyGlobalState.awsUseCrossRegionInference,
			useGlobalInference: legacyGlobalState.awsUseGlobalInference,
			endpoint: trimNonEmpty(legacyGlobalState.awsBedrockEndpoint),
			customModelBaseId: trimNonEmpty(
				mode === "plan"
					? legacyGlobalState.planModeAwsBedrockCustomModelBaseId
					: legacyGlobalState.actModeAwsBedrockCustomModelBaseId,
			),
		};
	}
	if (providerId === "vertex") {
		providerSpecific.gcp = {
			projectId: trimNonEmpty(legacyGlobalState.vertexProjectId),
			region: trimNonEmpty(legacyGlobalState.vertexRegion),
		};
	}
	if (
		providerId === LEGACY_OPENAI_COMPATIBLE_PROVIDER_ID &&
		(legacyGlobalState.azureApiVersion ||
			legacyGlobalState.azureIdentity !== undefined)
	) {
		providerSpecific.azure = {
			apiVersion: trimNonEmpty(legacyGlobalState.azureApiVersion),
			useIdentity: legacyGlobalState.azureIdentity,
		};
	}
	if (providerId === "sapaicore") {
		const useOrchestrationMode =
			legacyGlobalState.sapAiCoreUseOrchestrationMode ?? true;
		providerSpecific.sap = {
			clientId: trimNonEmpty(legacySecrets.sapAiCoreClientId),
			clientSecret: trimNonEmpty(legacySecrets.sapAiCoreClientSecret),
			tokenUrl: trimNonEmpty(legacyGlobalState.sapAiCoreTokenUrl),
			resourceGroup: trimNonEmpty(legacyGlobalState.sapAiResourceGroup),
			deploymentId: useOrchestrationMode
				? undefined
				: trimNonEmpty(
						mode === "plan"
							? legacyGlobalState.planModeSapAiCoreDeploymentId
							: legacyGlobalState.actModeSapAiCoreDeploymentId,
					),
			useOrchestrationMode,
		};
	}
	if (providerId === "oca") {
		providerSpecific.oca = {
			mode: legacyGlobalState.ocaMode,
		};
		const refreshToken = trimNonEmpty(legacySecrets.ocaRefreshToken);
		if (refreshToken) {
			providerSpecific.auth = {
				...(providerSpecific.auth ?? {}),
				refreshToken,
			};
		}
	}
	if (providerId === "qwen") {
		providerSpecific.apiLine = legacyGlobalState.qwenApiLine;
	}
	if (providerId === "moonshot") {
		providerSpecific.apiLine = legacyGlobalState.moonshotApiLine;
	}
	if (providerId === "zai") {
		providerSpecific.apiLine = legacyGlobalState.zaiApiLine;
	}
	if (providerId === "minimax") {
		providerSpecific.apiLine = legacyGlobalState.minimaxApiLine;
	}

	const baseUrlByProvider: Record<string, string | undefined> = {
		anthropic: legacyGlobalState.anthropicBaseUrl,
		openai: legacyGlobalState.openAiBaseUrl,
		ollama: legacyGlobalState.ollamaBaseUrl,
		lmstudio: legacyGlobalState.lmStudioBaseUrl,
		litellm: legacyGlobalState.liteLlmBaseUrl,
		gemini: legacyGlobalState.geminiBaseUrl,
		requesty: legacyGlobalState.requestyBaseUrl,
		asksage: legacyGlobalState.asksageApiUrl,
		dify: legacyGlobalState.difyBaseUrl,
		oca: legacyGlobalState.ocaBaseUrl,
		aihubmix: legacyGlobalState.aihubmixBaseUrl,
		sapaicore: legacyGlobalState.sapAiCoreBaseUrl,
	};

	const apiKey = trimNonEmpty(secretByProvider[providerId]);
	const baseUrl = trimNonEmpty(baseUrlByProvider[providerId]);

	const settings: ProviderSettings = {
		provider: targetProviderId as ProviderSettings["provider"],
		...(apiKey ? { apiKey } : {}),
		...(model ? { model } : {}),
		...(baseUrl ? { baseUrl } : {}),
		...(reasoning ? { reasoning } : {}),
		...(timeout ? { timeout } : {}),
		...providerSpecific,
	};
	const parsed = ProviderSettingsSchema.safeParse(settings);
	if (!parsed.success) {
		return undefined;
	}
	const hasNonProviderFields =
		Object.keys(settings).filter((key) => key !== "provider").length > 0;
	return hasNonProviderFields ? parsed.data : undefined;
}

function positiveFiniteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: undefined;
}

function resolveLegacyCustomProviderRegistration(
	providerId: string,
	settings: ProviderSettings,
	legacyModelInfo?: LegacyOpenAiModelInfo,
): StoredModelsFile["providers"][string] | undefined {
	if (providerId !== OPENAI_COMPATIBLE_PROVIDER_ID) {
		return undefined;
	}
	if (!settings.baseUrl || !settings.model) {
		return undefined;
	}
	// Carry the user-authored legacy model overrides into the seeded entry.
	// This entry becomes the source of truth for openai-compatible models, and
	// later override migrations skip models that already exist here — so
	// seeding bare defaults would silently discard the user's configuration.
	// Legacy treated maxTokens -1, temperature 0, and prices 0 as unset.
	const contextWindow =
		positiveFiniteNumber(legacyModelInfo?.contextWindow) ??
		LEGACY_OPENAI_COMPATIBLE_CONTEXT_WINDOW;
	const maxTokens = positiveFiniteNumber(legacyModelInfo?.maxTokens);
	const inputPrice = positiveFiniteNumber(legacyModelInfo?.inputPrice);
	const outputPrice = positiveFiniteNumber(legacyModelInfo?.outputPrice);
	const temperature = positiveFiniteNumber(legacyModelInfo?.temperature);
	const capabilities: NonNullable<StoredModelEntry["capabilities"]> = [
		"streaming",
		"tools",
	];
	if (legacyModelInfo?.supportsImages !== false) {
		capabilities.push("images");
	}
	if (legacyModelInfo?.supportsPromptCache === true) {
		capabilities.push("prompt-cache");
	}
	return {
		provider: {
			name: "OpenAI Compatible",
			baseUrl: settings.baseUrl,
			defaultModelId: settings.model,
		},
		models: {
			[settings.model]: {
				id: settings.model,
				name: settings.model,
				contextWindow,
				maxInputTokens: contextWindow,
				capabilities,
				...(maxTokens !== undefined ? { maxTokens } : {}),
				...(inputPrice !== undefined ? { inputPrice } : {}),
				...(outputPrice !== undefined ? { outputPrice } : {}),
				...(temperature !== undefined ? { temperature } : {}),
			},
		},
	};
}

function collectCandidateProviderIds(
	legacyGlobalState: LegacyGlobalState,
	legacySecrets: LegacySecrets,
): Set<string> {
	const candidates = new Set<string>();
	for (const maybeProvider of [
		legacyGlobalState.actModeApiProvider,
		legacyGlobalState.planModeApiProvider,
	]) {
		const provider = trimNonEmpty(maybeProvider);
		if (provider) {
			candidates.add(normalizeLegacyProviderId(provider));
		}
	}
	if (trimNonEmpty(legacySecrets.apiKey)) candidates.add("anthropic");
	if (trimNonEmpty(legacySecrets.openRouterApiKey))
		candidates.add("openrouter");
	if (trimNonEmpty(legacySecrets.openAiApiKey)) {
		candidates.add(LEGACY_OPENAI_COMPATIBLE_PROVIDER_ID);
	}
	if (trimNonEmpty(legacySecrets.openAiNativeApiKey))
		candidates.add("openai-native");
	if (trimNonEmpty(legacySecrets["openai-codex-oauth-credentials"]))
		candidates.add("openai-codex");
	if (trimNonEmpty(legacySecrets.geminiApiKey)) candidates.add("gemini");
	if (trimNonEmpty(legacySecrets.ollamaApiKey)) candidates.add("ollama");
	if (trimNonEmpty(legacySecrets.deepSeekApiKey)) candidates.add("deepseek");
	if (trimNonEmpty(legacySecrets.requestyApiKey)) candidates.add("requesty");
	if (trimNonEmpty(legacySecrets.togetherApiKey)) candidates.add("together");
	if (trimNonEmpty(legacySecrets.fireworksApiKey)) candidates.add("fireworks");
	if (trimNonEmpty(legacySecrets.qwenApiKey)) candidates.add("qwen");
	if (trimNonEmpty(legacySecrets.doubaoApiKey)) candidates.add("doubao");
	if (trimNonEmpty(legacySecrets.mistralApiKey)) candidates.add("mistral");
	if (trimNonEmpty(legacySecrets.liteLlmApiKey)) candidates.add("litellm");
	if (trimNonEmpty(legacySecrets.asksageApiKey)) candidates.add("asksage");
	if (trimNonEmpty(legacySecrets.xaiApiKey)) candidates.add("xai");
	if (trimNonEmpty(legacySecrets.moonshotApiKey)) candidates.add("moonshot");
	if (trimNonEmpty(legacySecrets.zaiApiKey)) candidates.add("zai");
	if (trimNonEmpty(legacySecrets.huggingFaceApiKey))
		candidates.add("huggingface");
	if (trimNonEmpty(legacySecrets.nebiusApiKey)) candidates.add("nebius");
	if (trimNonEmpty(legacySecrets.sambanovaApiKey)) candidates.add("sambanova");
	if (trimNonEmpty(legacySecrets.cerebrasApiKey)) candidates.add("cerebras");
	if (trimNonEmpty(legacySecrets.groqApiKey)) candidates.add("groq");
	if (trimNonEmpty(legacySecrets.huaweiCloudMaasApiKey))
		candidates.add("huawei-cloud-maas");
	if (trimNonEmpty(legacySecrets.basetenApiKey)) candidates.add("baseten");
	if (trimNonEmpty(legacySecrets.vercelAiGatewayApiKey))
		candidates.add("vercel-ai-gateway");
	if (trimNonEmpty(legacySecrets.difyApiKey)) candidates.add("dify");
	if (trimNonEmpty(legacySecrets.minimaxApiKey)) candidates.add("minimax");
	if (trimNonEmpty(legacySecrets.hicapApiKey)) candidates.add("hicap");
	if (trimNonEmpty(legacySecrets.aihubmixApiKey)) candidates.add("aihubmix");
	if (trimNonEmpty(legacySecrets.nousResearchApiKey))
		candidates.add("nousResearch");
	if (
		trimNonEmpty(legacySecrets.awsAccessKey) ||
		trimNonEmpty(legacySecrets.awsBedrockApiKey) ||
		legacyGlobalState.awsAuthentication !== undefined ||
		legacyGlobalState.awsUseProfile === true ||
		trimNonEmpty(legacyGlobalState.awsProfile)
	)
		candidates.add("bedrock");
	if (
		trimNonEmpty(legacyGlobalState.vertexProjectId) ||
		trimNonEmpty(legacyGlobalState.vertexRegion)
	) {
		candidates.add("vertex");
	}
	if (trimNonEmpty(legacySecrets.clineApiKey)) candidates.add("cline");
	const legacyClineAuth = resolveLegacyClineAuth(
		trimNonEmpty(legacySecrets["cline:clineAccountId"]),
	);
	if (
		legacyClineAuth?.accessToken ||
		legacyClineAuth?.refreshToken ||
		legacyClineAuth?.accountId
	) {
		candidates.add("cline");
	}
	if (trimNonEmpty(legacySecrets.ocaApiKey)) candidates.add("oca");
	if (
		trimNonEmpty(legacySecrets.sapAiCoreClientId) ||
		trimNonEmpty(legacySecrets.sapAiCoreClientSecret) ||
		trimNonEmpty(legacyGlobalState.sapAiCoreTokenUrl) ||
		trimNonEmpty(legacyGlobalState.sapAiCoreBaseUrl) ||
		trimNonEmpty(legacyGlobalState.sapAiResourceGroup) ||
		legacyGlobalState.sapAiCoreUseOrchestrationMode !== undefined
	) {
		candidates.add("sapaicore");
	}
	return candidates;
}

export function migrateLegacyProviderSettings(
	options: MigrateLegacyProviderSettingsOptions,
): MigrateLegacyProviderSettingsResult {
	const existing = options.providerSettingsManager.read();
	const legacyStorage = resolveLegacyStorage(options);
	if (!legacyStorage) {
		return {
			migrated: false,
			providerCount: Object.keys(existing.providers).length,
			lastUsedProvider: existing.lastUsedProvider,
		};
	}

	const { globalState, secrets } = legacyStorage;
	const mode: LegacyMode = globalState.mode === "plan" ? "plan" : "act";
	const otherMode: LegacyMode = mode === "plan" ? "act" : "plan";
	const rawCurrentModeProvider = trimNonEmpty(
		mode === "plan"
			? globalState.planModeApiProvider
			: globalState.actModeApiProvider,
	);
	const currentModeProvider = rawCurrentModeProvider
		? normalizeLegacyProviderId(rawCurrentModeProvider)
		: undefined;
	const rawOtherModeProvider = trimNonEmpty(
		mode === "plan"
			? globalState.actModeApiProvider
			: globalState.planModeApiProvider,
	);
	const otherModeProvider = rawOtherModeProvider
		? normalizeLegacyProviderId(rawOtherModeProvider)
		: undefined;
	const candidates = collectCandidateProviderIds(globalState, secrets);
	const next = emptyStoredProviderSettings();
	next.providers = { ...existing.providers };
	next.lastUsedProvider = existing.lastUsedProvider;
	const now = new Date().toISOString();
	let addedProviderCount = 0;
	const modelsPath = join(
		dirname(options.providerSettingsManager.getFilePath()),
		"models.json",
	);
	const modelsState = readModelsFileSync(modelsPath);
	let addedCustomProviderCount = 0;

	for (const legacyProviderId of candidates) {
		const providerId = resolveMigratedProviderId(legacyProviderId);
		if (next.providers[providerId]) {
			continue;
		}
		// A provider selected only in the non-current mode must be read through
		// that mode, or its per-mode model falls back to the catalog default.
		const modeForProvider =
			legacyProviderId !== currentModeProvider &&
			legacyProviderId === otherModeProvider
				? otherMode
				: mode;
		const settings = buildLegacyProviderSettings(
			legacyProviderId,
			globalState,
			secrets,
			modeForProvider,
		);
		if (!settings) {
			continue;
		}
		next.providers[providerId] = {
			settings,
			updatedAt: now,
			tokenSource: "migration",
		};
		addedProviderCount += 1;
		const registration = resolveLegacyCustomProviderRegistration(
			providerId,
			settings,
			modeForProvider === "plan"
				? globalState.planModeOpenAiModelInfo
				: globalState.actModeOpenAiModelInfo,
		);
		if (registration && !modelsState.providers[providerId]) {
			modelsState.providers[providerId] = registration;
			addedCustomProviderCount += 1;
		}
	}

	if (addedProviderCount === 0 && addedCustomProviderCount === 0) {
		return {
			migrated: false,
			providerCount: Object.keys(existing.providers).length,
			lastUsedProvider: existing.lastUsedProvider,
		};
	}

	const preferredProvider = trimNonEmpty(
		mode === "plan"
			? globalState.planModeApiProvider
			: globalState.actModeApiProvider,
	);
	const migratedPreferredProvider = preferredProvider
		? resolveMigratedProviderId(preferredProvider)
		: undefined;
	next.lastUsedProvider =
		existing.lastUsedProvider ??
		(migratedPreferredProvider && next.providers[migratedPreferredProvider]
			? migratedPreferredProvider
			: Object.keys(next.providers)[0]);

	options.providerSettingsManager.write(next);
	if (addedCustomProviderCount > 0) {
		writeModelsFileSync(modelsPath, modelsState);
	}

	return {
		migrated: addedProviderCount > 0 || addedCustomProviderCount > 0,
		providerCount: Object.keys(next.providers).length,
		lastUsedProvider: next.lastUsedProvider,
	};
}
