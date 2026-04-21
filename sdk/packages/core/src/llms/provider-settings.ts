import * as Llms from "@clinebot/llms";
import { z } from "zod";
import {
	DEFAULT_EXTERNAL_OCA_BASE_URL,
	DEFAULT_INTERNAL_OCA_BASE_URL,
} from "../auth/oca";
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

export type ProviderDefaultsConfig = ProviderDefaults;

export const ProviderIdSchema = z
	.string()
	.min(1)
	.regex(/^[a-z0-9][a-z0-9-]*$/i);

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
	authentication: z.enum(["iam", "api-key", "profile"]).optional(),
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

export type ModelCatalogSettings = z.infer<typeof ModelCatalogSettingsSchema>;
export type ModelCatalogConfig = ModelCatalogSettings;

export const ProviderSettingsSchema = z.object({
	provider: ProviderIdSchema,
	apiKey: z.string().optional(),
	auth: AuthSettingsSchema.optional(),
	model: z.string().optional(),
	maxTokens: z.number().int().positive().optional(),
	contextWindow: z.number().int().positive().optional(),
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
			]),
		)
		.optional(),
	modelCatalog: ModelCatalogSettingsSchema.optional(),
});

export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>;

export function parseSettings(input: unknown): ProviderSettings {
	return ProviderSettingsSchema.parse(input);
}

export function safeParseSettings(
	input: unknown,
): ReturnType<typeof ProviderSettingsSchema.safeParse> {
	return ProviderSettingsSchema.safeParse(input);
}

export function toProviderConfig(settings: ProviderSettings): ProviderConfig {
	const providerId = settings.provider as ProviderId;
	const normalizedProviderId = normalizeProviderId(providerId);
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

	const apiKey =
		settings.auth?.accessToken ?? settings.apiKey ?? settings.auth?.apiKey;
	const resolvedBaseUrl =
		settings.baseUrl ??
		(normalizedProviderId === "oca"
			? settings.oca?.mode === "internal"
				? DEFAULT_INTERNAL_OCA_BASE_URL
				: DEFAULT_EXTERNAL_OCA_BASE_URL
			: providerDefaults?.baseUrl);

	const config: ProviderConfig = {
		providerId,
		modelId: settings.model ?? providerDefaults?.modelId ?? "default",
		knownModels:
			providerDefaults?.knownModels ??
			(Object.keys(generatedKnownModels).length > 0
				? generatedKnownModels
				: undefined),
		apiKey,
		accessToken: settings.auth?.accessToken,
		refreshToken: settings.auth?.refreshToken,
		accountId: settings.auth?.accountId,
		baseUrl: resolvedBaseUrl,
		headers: settings.headers,
		timeoutMs: settings.timeout,
		maxOutputTokens: settings.maxTokens,
		maxContextTokens: settings.contextWindow,
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
