import * as Llms from "@cline/llms";
import { z } from "zod";

export type ModelInfo = Llms.ModelInfo;
export type ProviderConfig = Llms.ProviderConfig;
export type ProviderId = "bedrock";
export type BuiltInProviderId = "bedrock";
export type ProviderClient = "bedrock";
export type ProviderProtocol = "ai-sdk";
export type ProviderCapability = Llms.ProviderCapability;

export const BUILT_IN_PROVIDER = Llms.BUILT_IN_PROVIDER;
export const BUILT_IN_PROVIDER_IDS = Llms.BUILT_IN_PROVIDER_IDS;
export const isBuiltInProviderId = Llms.isBuiltInProviderId;
export const normalizeProviderId = Llms.normalizeProviderId;

export const ProviderIdSchema = z.literal("bedrock");
export const ProviderProtocolSchema = z.literal("ai-sdk");
export const ProviderClientSchema = z.literal("bedrock");

export const ReasoningSettingsSchema = z.object({
	enabled: z.boolean().optional(),
	effort: z.enum(["none", "low", "medium", "high", "xhigh"]).optional(),
	budgetTokens: z.number().int().positive().optional(),
});
export type ReasoningSettings = z.infer<typeof ReasoningSettingsSchema>;

export const BedrockConnectionSchema = z.object({
	region: z.string().trim().min(1).default("us-east-1"),
	profile: z.string().trim().min(1).optional(),
	endpoint: z.string().url().startsWith("https://").optional(),
	caBundlePath: z.string().trim().min(1).optional(),
});
export type BedrockConnectionSettings = z.infer<
	typeof BedrockConnectionSchema
>;

export const ProviderSettingsSchema = z.object({
	provider: z.literal("bedrock").default("bedrock"),
	model: z.string().trim().min(1).default(Llms.BEDROCK_DEFAULT_MODEL_ID),
	connection: BedrockConnectionSchema.default({ region: "us-east-1" }),
	reasoning: ReasoningSettingsSchema.optional(),
	maxTokens: z.number().int().positive().optional(),
	contextWindow: z.number().int().positive().optional(),
});
export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>;

export type ToProviderConfigOptions = {
	workspaceRoot?: string;
};

export function parseSettings(input: unknown): ProviderSettings {
	return ProviderSettingsSchema.parse(input);
}

export function safeParseSettings(
	input: unknown,
): ReturnType<typeof ProviderSettingsSchema.safeParse> {
	return ProviderSettingsSchema.safeParse(input);
}

export function toProviderConfig(
	settings: ProviderSettings,
	options: ToProviderConfigOptions = {},
): ProviderConfig {
	const effort = settings.reasoning?.effort;
	return {
		providerId: "bedrock",
		modelId: settings.model,
		connection: settings.connection,
		workspaceRoot: options.workspaceRoot,
		knownModels: Llms.BEDROCK_MODELS,
		maxOutputTokens: settings.maxTokens,
		maxInputTokens: settings.contextWindow,
		thinking: settings.reasoning?.enabled,
		reasoningEffort:
			effort && effort !== "none" ? effort : undefined,
		thinkingBudgetTokens: settings.reasoning?.budgetTokens,
	};
}

export function createProviderConfig(input: unknown): ProviderConfig {
	return toProviderConfig(parseSettings(input));
}

export function safeCreateProviderConfig(
	input: unknown,
):
	| { success: true; config: ProviderConfig }
	| { success: false; error: z.ZodError } {
	const result = safeParseSettings(input);
	return result.success
		? { success: true, config: toProviderConfig(result.data) }
		: { success: false, error: result.error };
}

export type ProviderDefaultsConfig = Partial<
	Omit<ProviderConfig, "providerId" | "modelId" | "connection">
>;
