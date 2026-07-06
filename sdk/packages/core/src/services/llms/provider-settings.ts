import * as Llms from "@cline/llms";
import { z } from "zod";
import {
	DEFAULT_EXTERNAL_OCA_BASE_URL,
	DEFAULT_INTERNAL_OCA_BASE_URL,
} from "../../auth/oca";
import { getPersistedProviderApiKey } from "../../auth/provider-auth-registry";
import {
	OPENAI_COMPATIBLE_PROVIDERS,
	type ProviderDefaults,
} from "./provider-defaults";

export type ModelInfo = Llms.ModelInfo;
export type ProviderClient = Llms.ProviderClient;
export type ProviderProtocol = Llms.ProviderProtocol;
export type ProviderId = Llms.ProviderId;
export type ProviderCapability = Llms.ProviderCapability;
export type ProviderConfig = Llms.ProviderConfig;
export type BuiltInProviderId = Llms.BuiltInProviderId;

export const BUILT_IN_PROVIDER = Llms.BUILT_IN_PROVIDER;
export const BUILT_IN_PROVIDER_IDS = Llms.BUILT_IN_PROVIDER_IDS;
export const isBuiltInProviderId = Llms.isBuiltInProviderId;
export const normalizeProviderId = Llms.normalizeProviderId;

function nonNegativeFiniteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: undefined;
}

function positiveFiniteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: undefined;
}

export type ProviderDefaultsConfig = ProviderDefaults;

export const ProviderIdSchema = z
	.string()
	.min(1)
	.regex(/^[a-z0-9][a-z0-9-]*$/i);

export const ProviderProtocolSchema = z.enum([
	"anthropic",
	"gemini",
	"openai-chat",
	"openai-responses",
	"openai-r1",
	"ai-sdk",
]);

export const ProviderClientSchema = z.enum([
	"anthropic",
	"ai-sdk",
	"ai-sdk-community",
	"openai",
	"openai-compatible",
	"openai-r1",
	"gemini",
	"bedrock",
	"custom",
	"fetch",
	"vertex",
]);

export const AuthSettingsSchema = z.object({
	apiKey: z.string().optional(),
	accessToken: z.string().optional(),
	refreshToken: z.string().optional(),
	expiresAt: z.number().int().positive().optional(),
	accountId: z.string().optional(),
});

export type AuthSettings = z.infer<typeof AuthSettingsSchema>;

const ReasoningLevelSchema = z.enum(["none", "low", "medium", "high", "xhigh"]);

export const ReasoningSettingsSchema = z.object({
	enabled: z.boolean().optional(),
	effort: ReasoningLevelSchema.optional(),
	budgetTokens: z.number().int().positive().optional(),
});

export type ReasoningSettings = z.infer<typeof ReasoningSettingsSchema>;

export const AwsSettingsSchema = z.object({
	accessKey: z.string().optional(),
	secretKey: z.string().optional(),
	sessionToken: z.string().optional(),
	region: z.string().optional(),
	profile: z.string().optional(),
	authentication: z.enum(["iam", "api-key", "apikey", "profile"]).optional(),
	usePromptCache: z.boolean().optional(),
	useCrossRegionInference: z.boolean().optional(),
	useGlobalInference: z.boolean().optional(),
	endpoint: z.string().url().optional(),
	customModelBaseId: z.string().optional(),
});

export type AwsSettings = z.infer<typeof AwsSettingsSchema>;

export const GcpSettingsSchema = z.object({
	projectId: z.string().optional(),
	region: z.string().optional(),
});

export type GcpSettings = z.infer<typeof GcpSettingsSchema>;

export const AzureSettingsSchema = z.object({
	apiVersion: z.string().optional(),
	useIdentity: z.boolean().optional(),
});

export type AzureSettings = z.infer<typeof AzureSettingsSchema>;

export const SapSettingsSchema = z.object({
	clientId: z.string().optional(),
	clientSecret: z.string().optional(),
	tokenUrl: z.string().url().optional(),
	resourceGroup: z.string().optional(),
	deploymentId: z.string().optional(),
	useOrchestrationMode: z.boolean().optional(),
	api: z.enum(["orchestration", "foundation-models"]).optional(),
	defaultSettings: z.record(z.string(), z.unknown()).optional(),
});

export type SapSettings = z.infer<typeof SapSettingsSchema>;

export const OcaSettingsSchema = z.object({
	mode: z.enum(["internal", "external"]).optional(),
	usePromptCache: z.boolean().optional(),
});

export type OcaSettings = z.infer<typeof OcaSettingsSchema>;

export const ModelCatalogSettingsSchema = z.object({
	loadLatestOnInit: z.boolean().optional(),
	loadPrivateOnAuth: z.boolean().optional(),
	url: z.string().url().optional(),
	cacheTtlMs: z.number().int().positive().optional(),
	failOnError: z.boolean().optional(),
});

export const PricingSettingsSchema = z.object({
	input: z.number().nonnegative(),
	output: z.number().nonnegative(),
	cacheRead: z.number().nonnegative(),
	cacheWrite: z.number().nonnegative(),
});

export type PricingSettings = z.infer<typeof PricingSettingsSchema>;
export type ModelCatalogSettings = z.infer<typeof ModelCatalogSettingsSchema>;
export type ModelCatalogConfig = ModelCatalogSettings;

export const ProviderSettingsSchema = z.object({
	provider: ProviderIdSchema,
	apiKey: z.string().optional(),
	auth: AuthSettingsSchema.optional(),
	model: z.string().optional(),
	protocol: ProviderProtocolSchema.optional(),
	client: ProviderClientSchema.optional(),
	routingProviderId: ProviderIdSchema.optional(),
	maxTokens: z.union([z.literal(-1), z.number().int().positive()]).optional(),
	contextWindow: z.number().int().positive().optional(),
	/** Pricing per million tokens (for usage tracking). */
	pricing: PricingSettingsSchema.optional(),
	temperature: z.number().optional(),
	baseUrl: z.string().url().optional(),
	headers: z.record(z.string(), z.string()).optional(),
	timeout: z.number().int().positive().optional(),
	reasoning: ReasoningSettingsSchema.optional(),
	aws: AwsSettingsSchema.optional(),
	gcp: GcpSettingsSchema.optional(),
	azure: AzureSettingsSchema.optional(),
	sap: SapSettingsSchema.optional(),
	oca: OcaSettingsSchema.optional(),
	region: z.string().optional(),
	apiLine: z.enum(["china", "international"]).optional(),
	capabilities: z
		.array(
			z.enum([
				"reasoning",
				"prompt-cache",
				"streaming",
				"tools",
				"vision",
				"computer-use",
				"oauth",
				"popular",
			]),
		)
		.optional(),
	modelCatalog: ModelCatalogSettingsSchema.optional(),
});

export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>;

export interface ToProviderConfigOptions {
	includeKnownModels?: boolean;
}

export function parseSettings(input: unknown): ProviderSettings {
	return ProviderSettingsSchema.parse(input);
}

export function safeParseSettings(
	input: unknown,
): ReturnType<typeof ProviderSettingsSchema.safeParse> {
	return ProviderSettingsSchema.safeParse(input);
}

function shouldRouteThroughOpenAIResponses(
	settings: ProviderSettings,
): boolean {
	return (
		settings.protocol === "openai-responses" || settings.client === "openai"
	);
}

export function toProviderConfig(
	settings: ProviderSettings,
	options: ToProviderConfigOptions = {},
): ProviderConfig {
	const providerId = settings.provider as ProviderId;
	const normalizedProviderId = normalizeProviderId(providerId);
	const includeKnownModels = options.includeKnownModels !== false;
	const unifiedReasoningLevel = settings.reasoning?.effort || "none";
	const reasoningEffort =
		unifiedReasoningLevel === "none" ? undefined : unifiedReasoningLevel;

	const providerDefaults = OPENAI_COMPATIBLE_PROVIDERS[normalizedProviderId];
	const generatedKnownModels = Object.assign(
		{},
		...Llms.resolveProviderModelCatalogKeys(normalizedProviderId).map(
			(catalogKey) => Llms.getGeneratedModelsForProvider(catalogKey),
		),
	);
	const generatedDefaultModelId = Object.keys(generatedKnownModels)[0];

	const apiKey = getPersistedProviderApiKey(normalizedProviderId, settings);
	const resolvedBaseUrl =
		settings.baseUrl ??
		(normalizedProviderId === "oca"
			? settings.oca?.mode === "internal"
				? DEFAULT_INTERNAL_OCA_BASE_URL
				: DEFAULT_EXTERNAL_OCA_BASE_URL
			: providerDefaults?.baseUrl);
	const routingProviderId =
		settings.routingProviderId ??
		(shouldRouteThroughOpenAIResponses(settings) &&
		normalizedProviderId !== BUILT_IN_PROVIDER.OPENAI_NATIVE
			? BUILT_IN_PROVIDER.OPENAI_NATIVE
			: undefined);

	const supportsCustomModelSettings = normalizedProviderId === BUILT_IN_PROVIDER.OPENAI_COMPATIBLE;
	const temperature = nonNegativeFiniteNumber(settings.temperature);
	const maxTokens = positiveFiniteNumber(settings.maxTokens);
	const configuredModelInfo = supportsCustomModelSettings && settings.model
		? {
				id: settings.model,
				name: settings.model,
				maxTokens,
				contextWindow: settings.contextWindow,
				maxInputTokens: settings.contextWindow,
				temperature: settings.temperature,
				pricing: settings.pricing
					? {
							input: settings.pricing.input,
							output: settings.pricing.output,
							cacheRead: settings.pricing.cacheRead,
							cacheWrite: settings.pricing.cacheWrite,
						}
					: undefined,
			}
		: undefined;

	const knownModels = includeKnownModels
		? (configuredModelInfo
			? { ...(providerDefaults?.knownModels ?? generatedKnownModels), [settings.model as string]: configuredModelInfo }
			: (providerDefaults?.knownModels ??
				(Object.keys(generatedKnownModels).length > 0
					? generatedKnownModels
					: undefined)))
		: undefined;

	const config: ProviderConfig = {
		providerId,
		clientType: settings.client,
		routingProviderId,
		modelId:
			settings.model ??
			providerDefaults?.modelId ??
			generatedDefaultModelId ??
			"default",
		...(includeKnownModels ? { knownModels } : {}),
		apiKey,
		accessToken: settings.auth?.accessToken,
		refreshToken: settings.auth?.refreshToken,
		accountId: settings.auth?.accountId,
		baseUrl: resolvedBaseUrl,
		headers: settings.headers,
		timeoutMs: settings.timeout,
		maxOutputTokens: maxTokens,
		maxInputTokens: settings.contextWindow,
		temperature,
		thinking: settings.reasoning?.enabled,
		reasoningEffort,
		thinkingBudgetTokens: settings.reasoning?.budgetTokens,
		region: settings.region ?? settings.aws?.region ?? settings.gcp?.region,
		apiLine: settings.apiLine,
		useCrossRegionInference: settings.aws?.useCrossRegionInference,
		useGlobalInference: settings.aws?.useGlobalInference,
		aws: settings.aws
			? {
					accessKey: settings.aws.accessKey,
					secretKey: settings.aws.secretKey,
					sessionToken: settings.aws.sessionToken,
					authentication: settings.aws.authentication,
					profile: settings.aws.profile,
					usePromptCache: settings.aws.usePromptCache,
					endpoint: settings.aws.endpoint,
					customModelBaseId: settings.aws.customModelBaseId,
				}
			: undefined,
		gcp: settings.gcp
			? {
					projectId: settings.gcp.projectId,
					region: settings.gcp.region,
				}
			: undefined,
		azure: settings.azure,
		sap: settings.sap,
		oca: settings.oca,
		capabilities: (settings.capabilities ?? providerDefaults?.capabilities) as
			| ProviderCapability[]
			| undefined,
		modelCatalog: settings.modelCatalog
			? {
					loadLatestOnInit: settings.modelCatalog.loadLatestOnInit,
					loadPrivateOnAuth: settings.modelCatalog.loadPrivateOnAuth,
					url: settings.modelCatalog.url,
					cacheTtlMs: settings.modelCatalog.cacheTtlMs,
					failOnError: settings.modelCatalog.failOnError,
				}
			: undefined,
	};

	return Object.fromEntries(
		Object.entries(config).filter(([_, value]) => value !== undefined),
	) as ProviderConfig;
}

export function createProviderConfig(input: unknown): ProviderConfig {
	const settings = parseSettings(input);
	return toProviderConfig(settings);
}

export function safeCreateProviderConfig(
	input: unknown,
):
	| { success: true; config: ProviderConfig }
	| { success: false; error: z.ZodError } {
	const result = safeParseSettings(input);
	if (result.success) {
		return { success: true, config: toProviderConfig(result.data) };
	}
	return { success: false, error: result.error };
}
