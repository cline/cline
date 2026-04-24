import { z } from "zod";

/**
 * Zod schemas for automation spec frontmatter. Used by the parser in
 * `@clinebot/core` to validate frontmatter shape before normalization.
 *
 * The schemas are deliberately permissive: they accept the raw parsed YAML
 * object and let the parser layer apply normalization rules (trim, default
 * enabled, resolve title, body->prompt fallback, etc).
 */

const nonEmptyString = z.string().min(1);

const tagsSchema = z.array(z.string()).optional();

const metadataSchema = z.record(z.string(), z.unknown()).optional();

const modeSchema = z.enum(["act", "plan", "yolo", "zen"]).optional();

const modelSelectionSchema = z
	.object({
		providerId: nonEmptyString,
		modelId: z.string().optional(),
	})
	.optional();

/**
 * Fields accepted across every trigger kind. Trigger-specific fields live on
 * their respective discriminants and are rejected when they appear on the
 * wrong kind.
 */
const commonFrontmatterFields = {
	id: z.string().optional(),
	title: z.string().optional(),
	prompt: z.string().optional(),
	workspaceRoot: z.string().optional(),
	cwd: z.string().optional(),
	modelSelection: modelSelectionSchema,
	systemPrompt: z.string().optional(),
	mode: modeSchema,
	timeoutSeconds: z.number().int().positive().optional(),
	maxIterations: z.number().int().positive().optional(),
	tags: tagsSchema,
	enabled: z.boolean().optional(),
	metadata: metadataSchema,
} as const;

export const AutomationOneOffFrontmatterSchema = z
	.object({
		...commonFrontmatterFields,
	})
	.strict();

export const AutomationScheduleFrontmatterSchema = z
	.object({
		...commonFrontmatterFields,
		schedule: nonEmptyString,
		timezone: z.string().optional(),
	})
	.strict();

export const AutomationEventFrontmatterSchema = z
	.object({
		...commonFrontmatterFields,
		event: nonEmptyString,
		filters: z.record(z.string(), z.unknown()).optional(),
		debounceSeconds: z.number().int().nonnegative().optional(),
		dedupeWindowSeconds: z.number().int().nonnegative().optional(),
		cooldownSeconds: z.number().int().nonnegative().optional(),
		maxParallel: z.number().int().positive().optional(),
	})
	.strict();

/**
 * Field names that are only valid on schedule specs.
 */
export const SCHEDULE_ONLY_FIELDS = ["schedule", "timezone"] as const;

/**
 * Field names that are only valid on event specs.
 */
export const EVENT_ONLY_FIELDS = [
	"event",
	"filters",
	"debounceSeconds",
	"dedupeWindowSeconds",
	"cooldownSeconds",
	"maxParallel",
] as const;

export type AutomationOneOffFrontmatter = z.infer<
	typeof AutomationOneOffFrontmatterSchema
>;
export type AutomationScheduleFrontmatter = z.infer<
	typeof AutomationScheduleFrontmatterSchema
>;
export type AutomationEventFrontmatter = z.infer<
	typeof AutomationEventFrontmatterSchema
>;
