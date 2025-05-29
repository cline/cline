import { z } from "zod"

export interface CloudUserInfo {
	name?: string
	email?: string
	picture?: string
}

/**
 * Organization Allow List
 */

export const organizationAllowListSchema = z.object({
	allowAll: z.boolean(),
	providers: z.record(
		z.object({
			allowAll: z.boolean(),
			models: z.array(z.string()).optional(),
		}),
	),
})

export type OrganizationAllowList = z.infer<typeof organizationAllowListSchema>

export const ORGANIZATION_ALLOW_ALL: OrganizationAllowList = {
	allowAll: true,
	providers: {},
} as const

/**
 * Organization Settings
 */

export const organizationSettingsSchema = z.object({
	version: z.number(),
	defaultSettings: z
		.object({
			enableCheckpoints: z.boolean().optional(),
			maxOpenTabsContext: z.number().optional(),
			maxWorkspaceFiles: z.number().optional(),
			showRooIgnoredFiles: z.boolean().optional(),
			maxReadFileLine: z.number().optional(),
			fuzzyMatchThreshold: z.number().optional(),
		})
		.optional(),
	cloudSettings: z
		.object({
			recordTaskMessages: z.boolean().optional(),
		})
		.optional(),
	allowList: organizationAllowListSchema,
})

export type OrganizationSettings = z.infer<typeof organizationSettingsSchema>
