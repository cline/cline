import { z } from "zod";
import {
	BotIdSchema,
	ClientIdSchema,
	PrincipalIdSchema,
	RunIdSchema,
	SessionIdSchema,
} from "./ids";

export const ToolIdSchema = z
	.string()
	.min(3)
	.max(192)
	.regex(/^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._/-]*$/);
export type ToolId = z.infer<typeof ToolIdSchema>;

export const ToolExecutorIdSchema = z.string().min(1).max(192);
export type ToolExecutorId = z.infer<typeof ToolExecutorIdSchema>;

export const ToolRiskSchema = z.enum([
	"read",
	"write",
	"execute",
	"network",
	"privileged",
]);
export type ToolRisk = z.infer<typeof ToolRiskSchema>;

export const ToolSourceSchema = z.enum([
	"builtin",
	"worker",
	"plugin",
	"mcp",
	"provider",
	"client",
	"connector",
]);
export const ToolExecutionTargetSchema = z.enum([
	"worker",
	"gateway",
	"client",
	"mcp",
	"provider",
]);

const JsonSchemaSchema = z.record(z.string(), z.unknown());

export const ToolAssignmentSelectorSchema = z
	.object({
		providers: z.array(z.string()).optional(),
		models: z.array(z.string()).optional(),
		modelPatterns: z.array(z.string()).optional(),
		capabilities: z.array(z.string()).optional(),
		excludeProviders: z.array(z.string()).optional(),
		excludeModels: z.array(z.string()).optional(),
	})
	.strict();
export type ToolAssignmentSelector = z.infer<
	typeof ToolAssignmentSelectorSchema
>;

export const ToolApprovalRuleSchema = z.discriminatedUnion("mode", [
	z.object({ mode: z.literal("never") }).strict(),
	z.object({ mode: z.literal("always") }).strict(),
	z.object({ mode: z.literal("risk"), minimumRisk: ToolRiskSchema }).strict(),
	z
		.object({ mode: z.literal("predicate"), predicateId: z.string().min(1) })
		.strict(),
]);
export type ToolApprovalRule = z.infer<typeof ToolApprovalRuleSchema>;

export const ToolDescriptorSchema = z
	.object({
		id: ToolIdSchema,
		version: z.string().min(1),
		displayName: z.string().min(1),
		description: z.string().min(1),
		inputSchema: JsonSchemaSchema,
		outputSchema: JsonSchemaSchema.optional(),
		configurationSchema: JsonSchemaSchema.optional(),
		inputExamples: z.array(z.unknown()).optional(),
		source: ToolSourceSchema,
		execution: ToolExecutionTargetSchema,
		risk: ToolRiskSchema,
		capabilities: z.array(z.string()),
		strict: z.enum(["disabled", "preferred", "required"]),
		approval: ToolApprovalRuleSchema,
		resultMode: z.enum(["single", "preliminary-and-final"]),
		supportsProgress: z.boolean(),
		supportsCancellation: z.boolean(),
		dynamic: z.boolean(),
		providerCompatibility: ToolAssignmentSelectorSchema.optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
	})
	.strict();
export type ToolDescriptor = z.infer<typeof ToolDescriptorSchema>;

export const ToolConfigurationSchema = z
	.object({
		enabled: z.boolean().optional(),
		configuration: z.record(z.string(), z.unknown()).optional(),
		approval: z.enum(["always", "on-risk", "never"]).optional(),
		strict: z.enum(["disabled", "preferred", "required"]).optional(),
		toolChoice: z.enum(["auto", "required", "none"]).optional(),
	})
	.strict();
export type ToolConfiguration = z.infer<typeof ToolConfigurationSchema>;

export const ToolAssignmentRuleSchema = z
	.object({
		when: ToolAssignmentSelectorSchema.optional(),
		useProfiles: z.array(z.string()).optional(),
		enable: z.array(ToolIdSchema).optional(),
		disable: z.array(ToolIdSchema).optional(),
		deny: z.array(ToolIdSchema).optional(),
	})
	.strict();
export type ToolAssignmentRule = z.infer<typeof ToolAssignmentRuleSchema>;

export const BotToolConfigurationSchema = z
	.object({
		profiles: z.array(z.string()).optional(),
		tools: z.record(ToolIdSchema, ToolConfigurationSchema).optional(),
		assignments: z.array(ToolAssignmentRuleSchema).optional(),
	})
	.strict();
export type BotToolConfiguration = z.infer<typeof BotToolConfigurationSchema>;

export const ToolProfileSchema = z
	.object({
		name: z.string().min(1),
		revision: z.number().int().positive(),
		extends: z.array(z.string()).optional(),
		required: z.array(ToolIdSchema),
		optional: z.array(ToolIdSchema),
	})
	.strict();
export type ToolProfile = z.infer<typeof ToolProfileSchema>;

export const ResolvedToolBindingSchema = z
	.object({
		id: ToolIdSchema,
		version: z.string(),
		modelFacingName: z.string(),
		configurationRevision: z.number().int().nonnegative(),
		executorId: ToolExecutorIdSchema,
		execution: ToolExecutionTargetSchema,
		strictEnabled: z.boolean(),
		approval: ToolApprovalRuleSchema,
		configuration: z.record(z.string(), z.unknown()).optional(),
	})
	.strict();
export type ResolvedToolBinding = z.infer<typeof ResolvedToolBindingSchema>;

export const RunExecutionSnapshotSchema = z
	.object({
		providerId: z.string(),
		modelId: z.string(),
		modelManifestRevision: z.string(),
		catalogGeneration: z.number().int().nonnegative(),
		profileRevisions: z.record(z.string(), z.number().int().positive()),
		tools: z.array(ResolvedToolBindingSchema),
		effectivePolicyHash: z.string(),
		createdAt: z.number().int().nonnegative(),
	})
	.strict();
export type RunExecutionSnapshot = z.infer<typeof RunExecutionSnapshotSchema>;

export const ToolResolutionSchema = z
	.object({
		toolId: ToolIdSchema,
		status: z.enum([
			"enabled",
			"disabled",
			"denied",
			"incompatible",
			"unavailable",
			"required_missing",
		]),
		required: z.boolean(),
		reason: z.string(),
		source: z.string(),
	})
	.strict();
export type ToolResolution = z.infer<typeof ToolResolutionSchema>;

export interface EffectiveToolPreview {
	readonly providerId: string;
	readonly modelId: string;
	readonly modelCapabilities: readonly string[];
	readonly resolutions: readonly ToolResolution[];
	readonly canStartRun: boolean;
}

export const ToolExecutionContextSchema = z
	.object({
		botId: BotIdSchema,
		sessionId: SessionIdSchema,
		workspaceRoot: z.string(),
		principalId: PrincipalIdSchema.optional(),
		policyHash: z.string(),
		clientId: ClientIdSchema.optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
	})
	.strict();

export const ToolExecutionRequestSchema = z
	.object({
		toolCallId: z.string().min(1),
		runId: RunIdSchema,
		attempt: z.number().int().positive(),
		toolId: ToolIdSchema,
		toolVersion: z.string(),
		executorId: ToolExecutorIdSchema,
		input: z.unknown(),
		configurationRevision: z.number().int().nonnegative(),
		idempotencyKey: z.string().min(1),
		deadline: z.number().int().optional(),
		context: ToolExecutionContextSchema,
	})
	.strict();
export type ToolExecutionRequest = z.infer<typeof ToolExecutionRequestSchema>;

export const ToolExecutionUpdateSchema = z.discriminatedUnion("type", [
	z
		.object({
			type: z.literal("progress"),
			message: z.string().optional(),
			percent: z.number().min(0).max(100).optional(),
		})
		.strict(),
	z
		.object({ type: z.literal("preliminary-result"), output: z.unknown() })
		.strict(),
	z.object({ type: z.literal("final-result"), output: z.unknown() }).strict(),
]);
export type ToolExecutionUpdate = z.infer<typeof ToolExecutionUpdateSchema>;
