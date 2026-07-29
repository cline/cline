/**
 * Driveagent home + derived graph schemas (DRV-DRIVEAGENT-HOME, ARD-0001/0002).
 *
 * Canonical YAML under `.driveagent/<slug>/`; `.derived/graph.json` is output only.
 */

import { z } from "zod";
import { DriveagentSlugSchema } from "../agentRef";

/** Forbidden plaintext secret keys in env.yaml `values` (DEC / DRV-DRIVEAGENT-HOME). */
export const DRIVE_ENV_FORBIDDEN_SECRET_KEYS = [
	"apiKey",
	"token",
	"accessToken",
	"secret",
	"password",
	"privateKey",
	"clientSecret",
] as const;

const DriveagentToolIdSchema = z.string().min(1);
const DriveagentSkillIdSchema = z.string().min(1);

export const DriveagentAgentYamlSchema = z
	.object({
		name: DriveagentSlugSchema,
		description: z.string().min(1),
		tools: z.array(DriveagentToolIdSchema).optional(),
		skills: z.array(DriveagentSkillIdSchema).optional(),
		systemPrompt: z.string().min(1).optional(),
		promptPath: z.string().min(1).optional(),
		providerId: z.string().min(1).optional(),
		modelId: z.string().min(1).optional(),
		maxIterations: z.number().int().positive().optional(),
		editable: z.boolean().optional(),
	})
	.strict()
	.superRefine((agent, ctx) => {
		if (!agent.systemPrompt && !agent.promptPath) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "agent.yaml requires systemPrompt or promptPath",
				path: ["systemPrompt"],
			});
		}
	});
export type DriveagentAgentYaml = z.infer<typeof DriveagentAgentYamlSchema>;

export const DriveagentPermissionPresetIntentSchema = z.enum([
	"readonly",
	"standard",
	"full",
]);
export type DriveagentPermissionPresetIntent = z.infer<
	typeof DriveagentPermissionPresetIntentSchema
>;

export const DriveagentPermissionsYamlSchema = z
	.object({
		presetIntent: DriveagentPermissionPresetIntentSchema,
		approvalHooks: z.array(z.string().min(1)).default([]),
		notes: z.string().optional(),
	})
	.strict();
export type DriveagentPermissionsYaml = z.infer<
	typeof DriveagentPermissionsYamlSchema
>;

/** Opaque secret reference — never a plaintext credential. */
export const DriveagentSecretRefEntrySchema = z
	.object({
		key: z.string().min(1),
		secretRef: z.string().min(1),
	})
	.strict();
export type DriveagentSecretRefEntry = z.infer<
	typeof DriveagentSecretRefEntrySchema
>;

const EnvPlainValueSchema = z.union([
	z.string(),
	z.number(),
	z.boolean(),
]);

export const DriveagentEnvYamlSchema = z
	.object({
		values: z.record(z.string(), EnvPlainValueSchema).default({}),
		secretRefs: z.array(DriveagentSecretRefEntrySchema).default([]),
	})
	.strict()
	.superRefine((env, ctx) => {
		for (const key of Object.keys(env.values)) {
			if (
				(DRIVE_ENV_FORBIDDEN_SECRET_KEYS as readonly string[]).includes(
					key,
				)
			) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: `plaintext secret key '${key}' is forbidden in env.yaml values; use secretRefs`,
					path: ["values", key],
				});
			}
		}
	});
export type DriveagentEnvYaml = z.infer<typeof DriveagentEnvYamlSchema>;

export const DriveagentGraphNodeKindSchema = z.enum([
	"capability",
	"case",
	"constraint",
	"artifact",
	"concept",
]);
export type DriveagentGraphNodeKind = z.infer<
	typeof DriveagentGraphNodeKindSchema
>;

export const DriveagentGraphEdgeKindSchema = z.enum([
	"has_capability",
	"applied_in",
	"requires",
	"conflicts_with",
	"related_to",
	"learned_from",
]);
export type DriveagentGraphEdgeKind = z.infer<
	typeof DriveagentGraphEdgeKindSchema
>;

export const DriveagentGraphNodeSchema = z
	.object({
		id: z.string().min(1),
		kind: DriveagentGraphNodeKindSchema,
		label: z.string().min(1),
	})
	.strict();
export type DriveagentGraphNode = z.infer<typeof DriveagentGraphNodeSchema>;

export const DriveagentGraphEdgeSchema = z
	.object({
		from: z.string().min(1),
		to: z.string().min(1),
		kind: DriveagentGraphEdgeKindSchema,
	})
	.strict();
export type DriveagentGraphEdge = z.infer<typeof DriveagentGraphEdgeSchema>;

/** Minimal derived graph (`.derived/graph.json`). Not an input to compile. */
export const DriveagentDerivedGraphSchema = z
	.object({
		version: z.literal(1),
		agentSlug: DriveagentSlugSchema,
		nodes: z.array(DriveagentGraphNodeSchema),
		edges: z.array(DriveagentGraphEdgeSchema),
		compiledAt: z.string().min(1),
	})
	.strict();
export type DriveagentDerivedGraph = z.infer<
	typeof DriveagentDerivedGraphSchema
>;

/** Parsed home inputs for compile (knowledge optional at Phase 0 stub). */
export const DriveagentHomeSchema = z
	.object({
		slug: DriveagentSlugSchema,
		agent: DriveagentAgentYamlSchema,
		permissions: DriveagentPermissionsYamlSchema,
		env: DriveagentEnvYamlSchema,
	})
	.strict()
	.superRefine((home, ctx) => {
		if (home.agent.name !== home.slug) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: `agent.yaml name '${home.agent.name}' must match home slug '${home.slug}'`,
				path: ["agent", "name"],
			});
		}
	});
export type DriveagentHome = z.infer<typeof DriveagentHomeSchema>;

export function parseDriveagentAgentYaml(input: unknown): DriveagentAgentYaml {
	return DriveagentAgentYamlSchema.parse(input);
}

export function parseDriveagentPermissionsYaml(
	input: unknown,
): DriveagentPermissionsYaml {
	return DriveagentPermissionsYamlSchema.parse(input);
}

export function parseDriveagentEnvYaml(input: unknown): DriveagentEnvYaml {
	return DriveagentEnvYamlSchema.parse(input);
}

export function parseDriveagentDerivedGraph(
	input: unknown,
): DriveagentDerivedGraph {
	return DriveagentDerivedGraphSchema.parse(input);
}

export function parseDriveagentHome(input: unknown): DriveagentHome {
	return DriveagentHomeSchema.parse(input);
}
