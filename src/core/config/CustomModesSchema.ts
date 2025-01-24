import { z } from "zod"
import { ModeConfig } from "../../shared/modes"
import { TOOL_GROUPS, ToolGroup } from "../../shared/tool-groups"

// Create a schema for valid tool groups using the keys of TOOL_GROUPS
const ToolGroupSchema = z.enum(Object.keys(TOOL_GROUPS) as [ToolGroup, ...ToolGroup[]])

// Schema for group options with regex validation
const GroupOptionsSchema = z.object({
	fileRegex: z
		.string()
		.optional()
		.refine(
			(pattern) => {
				if (!pattern) return true // Optional, so empty is valid
				try {
					new RegExp(pattern)
					return true
				} catch {
					return false
				}
			},
			{ message: "Invalid regular expression pattern" },
		),
	fileRegexDescription: z.string().optional(),
})

// Schema for a group entry - either a tool group string or a tuple of [group, options]
const GroupEntrySchema = z.union([ToolGroupSchema, z.tuple([ToolGroupSchema, GroupOptionsSchema])])

// Schema for array of groups
const GroupsArraySchema = z
	.array(GroupEntrySchema)
	.min(1, "At least one tool group is required")
	.refine(
		(groups) => {
			const seen = new Set()
			return groups.every((group) => {
				// For tuples, check the group name (first element)
				const groupName = Array.isArray(group) ? group[0] : group
				if (seen.has(groupName)) return false
				seen.add(groupName)
				return true
			})
		},
		{ message: "Duplicate groups are not allowed" },
	)

// Schema for mode configuration
export const CustomModeSchema = z.object({
	slug: z.string().regex(/^[a-zA-Z0-9-]+$/, "Slug must contain only letters numbers and dashes"),
	name: z.string().min(1, "Name is required"),
	roleDefinition: z.string().min(1, "Role definition is required"),
	customInstructions: z.string().optional(),
	groups: GroupsArraySchema,
}) satisfies z.ZodType<ModeConfig>

// Schema for the entire custom modes settings file
export const CustomModesSettingsSchema = z.object({
	customModes: z.array(CustomModeSchema).refine(
		(modes) => {
			const slugs = new Set()
			return modes.every((mode) => {
				if (slugs.has(mode.slug)) {
					return false
				}
				slugs.add(mode.slug)
				return true
			})
		},
		{
			message: "Duplicate mode slugs are not allowed",
		},
	),
})

export type CustomModesSettings = z.infer<typeof CustomModesSettingsSchema>

/**
 * Validates a custom mode configuration against the schema
 * @throws {z.ZodError} if validation fails
 */
export function validateCustomMode(mode: unknown): asserts mode is ModeConfig {
	CustomModeSchema.parse(mode)
}
