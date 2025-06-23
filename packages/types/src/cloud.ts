import { z } from "zod"

import { globalSettingsSchema } from "./global-settings.js"

/**
 * CloudUserInfo
 */

export interface CloudUserInfo {
	name?: string
	email?: string
	picture?: string
	organizationId?: string
	organizationName?: string
	organizationRole?: string
	organizationImageUrl?: string
}

/**
 * CloudOrganization Types
 */

export interface CloudOrganization {
	id: string
	name: string
	slug?: string
	image_url?: string
	has_image?: boolean
	created_at?: number
	updated_at?: number
}

export interface CloudOrganizationMembership {
	id: string
	organization: CloudOrganization
	role: string
	permissions?: string[]
	created_at?: number
	updated_at?: number
}

/**
 * OrganizationAllowList
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

/**
 * OrganizationDefaultSettings
 */

export const organizationDefaultSettingsSchema = globalSettingsSchema
	.pick({
		enableCheckpoints: true,
		fuzzyMatchThreshold: true,
		maxOpenTabsContext: true,
		maxReadFileLine: true,
		maxWorkspaceFiles: true,
		showRooIgnoredFiles: true,
		terminalCommandDelay: true,
		terminalCompressProgressBar: true,
		terminalOutputLineLimit: true,
		terminalShellIntegrationDisabled: true,
		terminalShellIntegrationTimeout: true,
		terminalZshClearEolMark: true,
	})
	// Add stronger validations for some fields.
	.merge(
		z.object({
			maxOpenTabsContext: z.number().int().nonnegative().optional(),
			maxReadFileLine: z.number().int().gte(-1).optional(),
			maxWorkspaceFiles: z.number().int().nonnegative().optional(),
			terminalCommandDelay: z.number().int().nonnegative().optional(),
			terminalOutputLineLimit: z.number().int().nonnegative().optional(),
			terminalShellIntegrationTimeout: z.number().int().nonnegative().optional(),
		}),
	)

export type OrganizationDefaultSettings = z.infer<typeof organizationDefaultSettingsSchema>

/**
 * OrganizationCloudSettings
 */

export const organizationCloudSettingsSchema = z.object({
	recordTaskMessages: z.boolean().optional(),
	enableTaskSharing: z.boolean().optional(),
	taskShareExpirationDays: z.number().int().positive().optional(),
})

export type OrganizationCloudSettings = z.infer<typeof organizationCloudSettingsSchema>

/**
 * Organization Settings
 */

export const organizationSettingsSchema = z.object({
	version: z.number(),
	cloudSettings: organizationCloudSettingsSchema.optional(),
	defaultSettings: organizationDefaultSettingsSchema,
	allowList: organizationAllowListSchema,
})

export type OrganizationSettings = z.infer<typeof organizationSettingsSchema>

/**
 * Constants
 */

export const ORGANIZATION_ALLOW_ALL: OrganizationAllowList = {
	allowAll: true,
	providers: {},
} as const

export const ORGANIZATION_DEFAULT: OrganizationSettings = {
	version: 0,
	cloudSettings: {
		recordTaskMessages: true,
		enableTaskSharing: true,
		taskShareExpirationDays: 30,
	},
	defaultSettings: {},
	allowList: ORGANIZATION_ALLOW_ALL,
} as const

/**
 * Share Types
 */

export const shareResponseSchema = z.object({
	success: z.boolean(),
	shareUrl: z.string().optional(),
	error: z.string().optional(),
	isNewShare: z.boolean().optional(),
	manageUrl: z.string().optional(),
})

export type ShareResponse = z.infer<typeof shareResponseSchema>
