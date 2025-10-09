import EventEmitter from "events"

import { z } from "zod"

import { RooCodeEventName } from "./events.js"
import { TaskStatus, taskMetadataSchema } from "./task.js"
import { globalSettingsSchema } from "./global-settings.js"
import { providerSettingsWithIdSchema } from "./provider-settings.js"
import { mcpMarketplaceItemSchema } from "./marketplace.js"
import { clineMessageSchema, queuedMessageSchema, tokenUsageSchema } from "./message.js"
import { staticAppPropertiesSchema, gitPropertiesSchema } from "./telemetry.js"

/**
 * JWTPayload
 */

export interface JWTPayload {
	iss?: string // Issuer (should be 'rcc')
	sub?: string // Subject - CloudJob ID for job tokens (t:'cj'), User ID for auth tokens (t:'auth')
	exp?: number // Expiration time
	iat?: number // Issued at time
	nbf?: number // Not before time
	v?: number // Version (should be 1)
	r?: {
		u?: string // User ID (always present in valid tokens)
		o?: string // Organization ID (optional - undefined when orgId is null)
		t?: string // Token type: 'cj' for job tokens, 'auth' for auth tokens
	}
}

/**
 * CloudUserInfo
 */

export interface CloudUserInfo {
	id?: string
	name?: string
	email?: string
	picture?: string
	organizationId?: string
	organizationName?: string
	organizationRole?: string
	organizationImageUrl?: string
	extensionBridgeEnabled?: boolean
}

/**
 * CloudOrganization
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

/**
 * CloudOrganizationMembership
 */

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
	allowMembersViewAllTasks: z.boolean().optional(),
})

export type OrganizationCloudSettings = z.infer<typeof organizationCloudSettingsSchema>

/**
 * OrganizationFeatures
 */

export const organizationFeaturesSchema = z.object({
	roomoteControlEnabled: z.boolean().optional(),
})

export type OrganizationFeatures = z.infer<typeof organizationFeaturesSchema>

/**
 * OrganizationSettings
 */

export const organizationSettingsSchema = z.object({
	version: z.number(),
	cloudSettings: organizationCloudSettingsSchema.optional(),
	defaultSettings: organizationDefaultSettingsSchema,
	allowList: organizationAllowListSchema,
	features: organizationFeaturesSchema.optional(),
	hiddenMcps: z.array(z.string()).optional(),
	hideMarketplaceMcps: z.boolean().optional(),
	mcps: z.array(mcpMarketplaceItemSchema).optional(),
	providerProfiles: z.record(z.string(), providerSettingsWithIdSchema).optional(),
})

export type OrganizationSettings = z.infer<typeof organizationSettingsSchema>

/**
 * User Settings Schemas
 */

export const userFeaturesSchema = z.object({
	roomoteControlEnabled: z.boolean().optional(),
})

export type UserFeatures = z.infer<typeof userFeaturesSchema>

export const userSettingsConfigSchema = z.object({
	extensionBridgeEnabled: z.boolean().optional(),
	taskSyncEnabled: z.boolean().optional(),
})

export type UserSettingsConfig = z.infer<typeof userSettingsConfigSchema>

export const userSettingsDataSchema = z.object({
	features: userFeaturesSchema,
	settings: userSettingsConfigSchema,
	version: z.number(),
})

export type UserSettingsData = z.infer<typeof userSettingsDataSchema>

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
		allowMembersViewAllTasks: true,
	},
	defaultSettings: {},
	allowList: ORGANIZATION_ALLOW_ALL,
} as const

/**
 * ShareVisibility
 */

export type ShareVisibility = "organization" | "public"

/**
 * ShareResponse
 */

export const shareResponseSchema = z.object({
	success: z.boolean(),
	shareUrl: z.string().optional(),
	error: z.string().optional(),
	isNewShare: z.boolean().optional(),
	manageUrl: z.string().optional(),
})

export type ShareResponse = z.infer<typeof shareResponseSchema>

/**
 * AuthService
 */

export type AuthState = "initializing" | "logged-out" | "active-session" | "attempting-session" | "inactive-session"

export interface AuthService extends EventEmitter<AuthServiceEvents> {
	// Lifecycle
	initialize(): Promise<void>
	broadcast(): void

	// Authentication methods
	login(landingPageSlug?: string): Promise<void>
	logout(): Promise<void>
	handleCallback(code: string | null, state: string | null, organizationId?: string | null): Promise<void>
	switchOrganization(organizationId: string | null): Promise<void>

	// State methods
	getState(): AuthState
	isAuthenticated(): boolean
	hasActiveSession(): boolean
	hasOrIsAcquiringActiveSession(): boolean

	// Token and user info
	getSessionToken(): string | undefined
	getUserInfo(): CloudUserInfo | null
	getStoredOrganizationId(): string | null

	// Organization management
	getOrganizationMemberships(): Promise<CloudOrganizationMembership[]>
}

/**
 * AuthServiceEvents
 */

export interface AuthServiceEvents {
	"auth-state-changed": [
		data: {
			state: AuthState
			previousState: AuthState
		},
	]
	"user-info": [data: { userInfo: CloudUserInfo }]
}

/**
 * SettingsService
 */

/**
 * Interface for settings services that provide organization settings
 */
export interface SettingsService {
	/**
	 * Get the organization allow list
	 * @returns The organization allow list or default if none available
	 */
	getAllowList(): OrganizationAllowList

	/**
	 * Get the current organization settings
	 * @returns The organization settings or undefined if none available
	 */
	getSettings(): OrganizationSettings | undefined

	/**
	 * Get the current user settings
	 * @returns The user settings data or undefined if none available
	 */
	getUserSettings(): UserSettingsData | undefined

	/**
	 * Get the current user features
	 * @returns The user features or empty object if none available
	 */
	getUserFeatures(): UserFeatures

	/**
	 * Get the current user settings configuration
	 * @returns The user settings configuration or empty object if none available
	 */
	getUserSettingsConfig(): UserSettingsConfig

	/**
	 * Update user settings with partial configuration
	 * @param settings Partial user settings configuration to update
	 * @returns Promise that resolves to true if successful, false otherwise
	 */
	updateUserSettings(settings: Partial<UserSettingsConfig>): Promise<boolean>

	/**
	 * Determines if task sync/recording is enabled based on organization and user settings
	 * Organization settings take precedence over user settings.
	 * User settings default to true if unspecified.
	 * @returns true if task sync is enabled, false otherwise
	 */
	isTaskSyncEnabled(): boolean

	/**
	 * Dispose of the settings service and clean up resources
	 */
	dispose(): void
}

/**
 * SettingsServiceEvents
 */

export interface SettingsServiceEvents {
	"settings-updated": [data: Record<string, never>]
}

/**
 * CloudServiceEvents
 */

export type CloudServiceEvents = AuthServiceEvents & SettingsServiceEvents

/**
 * ConnectionState
 */

export enum ConnectionState {
	DISCONNECTED = "disconnected",
	CONNECTING = "connecting",
	CONNECTED = "connected",
	RETRYING = "retrying",
	FAILED = "failed",
}

/**
 * RetryConfig
 */

export interface RetryConfig {
	maxInitialAttempts: number
	initialDelay: number
	maxDelay: number
	backoffMultiplier: number
}

/**
 * Constants
 */

export const HEARTBEAT_INTERVAL_MS = 20_000
export const INSTANCE_TTL_SECONDS = 60

/**
 * ExtensionTask
 */

const extensionTaskSchema = z.object({
	taskId: z.string(),
	taskStatus: z.nativeEnum(TaskStatus),
	taskAsk: clineMessageSchema.optional(),
	queuedMessages: z.array(queuedMessageSchema).optional(),
	parentTaskId: z.string().optional(),
	childTaskId: z.string().optional(),
	tokenUsage: tokenUsageSchema.optional(),
	...taskMetadataSchema.shape,
})

export type ExtensionTask = z.infer<typeof extensionTaskSchema>

/**
 * ExtensionInstance
 */

export const extensionInstanceSchema = z.object({
	instanceId: z.string(),
	userId: z.string(),
	workspacePath: z.string(),
	appProperties: staticAppPropertiesSchema,
	gitProperties: gitPropertiesSchema.optional(),
	lastHeartbeat: z.coerce.number(),
	task: extensionTaskSchema,
	taskAsk: clineMessageSchema.optional(),
	taskHistory: z.array(z.string()),
	mode: z.string().optional(),
	modes: z.array(z.object({ slug: z.string(), name: z.string() })).optional(),
	providerProfile: z.string().optional(),
	providerProfiles: z.array(z.object({ name: z.string(), provider: z.string().optional() })).optional(),
	isCloudAgent: z.boolean().optional(),
})

export type ExtensionInstance = z.infer<typeof extensionInstanceSchema>

/**
 * ExtensionBridgeEvent
 */

export enum ExtensionBridgeEventName {
	TaskCreated = RooCodeEventName.TaskCreated,
	TaskStarted = RooCodeEventName.TaskStarted,
	TaskCompleted = RooCodeEventName.TaskCompleted,
	TaskAborted = RooCodeEventName.TaskAborted,
	TaskFocused = RooCodeEventName.TaskFocused,
	TaskUnfocused = RooCodeEventName.TaskUnfocused,
	TaskActive = RooCodeEventName.TaskActive,
	TaskInteractive = RooCodeEventName.TaskInteractive,
	TaskResumable = RooCodeEventName.TaskResumable,
	TaskIdle = RooCodeEventName.TaskIdle,

	TaskPaused = RooCodeEventName.TaskPaused,
	TaskUnpaused = RooCodeEventName.TaskUnpaused,
	TaskSpawned = RooCodeEventName.TaskSpawned,

	TaskUserMessage = RooCodeEventName.TaskUserMessage,

	TaskTokenUsageUpdated = RooCodeEventName.TaskTokenUsageUpdated,

	ModeChanged = RooCodeEventName.ModeChanged,
	ProviderProfileChanged = RooCodeEventName.ProviderProfileChanged,

	InstanceRegistered = "instance_registered",
	InstanceUnregistered = "instance_unregistered",
	HeartbeatUpdated = "heartbeat_updated",
}

export const extensionBridgeEventSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal(ExtensionBridgeEventName.TaskCreated),
		instance: extensionInstanceSchema,
		timestamp: z.number(),
	}),
	z.object({
		type: z.literal(ExtensionBridgeEventName.TaskStarted),
		instance: extensionInstanceSchema,
		timestamp: z.number(),
	}),
	z.object({
		type: z.literal(ExtensionBridgeEventName.TaskCompleted),
		instance: extensionInstanceSchema,
		timestamp: z.number(),
	}),
	z.object({
		type: z.literal(ExtensionBridgeEventName.TaskAborted),
		instance: extensionInstanceSchema,
		timestamp: z.number(),
	}),
	z.object({
		type: z.literal(ExtensionBridgeEventName.TaskFocused),
		instance: extensionInstanceSchema,
		timestamp: z.number(),
	}),
	z.object({
		type: z.literal(ExtensionBridgeEventName.TaskUnfocused),
		instance: extensionInstanceSchema,
		timestamp: z.number(),
	}),
	z.object({
		type: z.literal(ExtensionBridgeEventName.TaskActive),
		instance: extensionInstanceSchema,
		timestamp: z.number(),
	}),
	z.object({
		type: z.literal(ExtensionBridgeEventName.TaskInteractive),
		instance: extensionInstanceSchema,
		timestamp: z.number(),
	}),
	z.object({
		type: z.literal(ExtensionBridgeEventName.TaskResumable),
		instance: extensionInstanceSchema,
		timestamp: z.number(),
	}),
	z.object({
		type: z.literal(ExtensionBridgeEventName.TaskIdle),
		instance: extensionInstanceSchema,
		timestamp: z.number(),
	}),

	z.object({
		type: z.literal(ExtensionBridgeEventName.TaskPaused),
		instance: extensionInstanceSchema,
		timestamp: z.number(),
	}),
	z.object({
		type: z.literal(ExtensionBridgeEventName.TaskUnpaused),
		instance: extensionInstanceSchema,
		timestamp: z.number(),
	}),
	z.object({
		type: z.literal(ExtensionBridgeEventName.TaskSpawned),
		instance: extensionInstanceSchema,
		timestamp: z.number(),
	}),

	z.object({
		type: z.literal(ExtensionBridgeEventName.TaskUserMessage),
		instance: extensionInstanceSchema,
		timestamp: z.number(),
	}),

	z.object({
		type: z.literal(ExtensionBridgeEventName.TaskTokenUsageUpdated),
		instance: extensionInstanceSchema,
		timestamp: z.number(),
	}),

	z.object({
		type: z.literal(ExtensionBridgeEventName.ModeChanged),
		instance: extensionInstanceSchema,
		mode: z.string(),
		timestamp: z.number(),
	}),
	z.object({
		type: z.literal(ExtensionBridgeEventName.ProviderProfileChanged),
		instance: extensionInstanceSchema,
		providerProfile: z.object({ name: z.string(), provider: z.string().optional() }),
		timestamp: z.number(),
	}),

	z.object({
		type: z.literal(ExtensionBridgeEventName.InstanceRegistered),
		instance: extensionInstanceSchema,
		timestamp: z.number(),
	}),
	z.object({
		type: z.literal(ExtensionBridgeEventName.InstanceUnregistered),
		instance: extensionInstanceSchema,
		timestamp: z.number(),
	}),
	z.object({
		type: z.literal(ExtensionBridgeEventName.HeartbeatUpdated),
		instance: extensionInstanceSchema,
		timestamp: z.number(),
	}),
])

export type ExtensionBridgeEvent = z.infer<typeof extensionBridgeEventSchema>

/**
 * ExtensionBridgeCommand
 */

export enum ExtensionBridgeCommandName {
	StartTask = "start_task",
	StopTask = "stop_task",
	ResumeTask = "resume_task",
}

export const extensionBridgeCommandSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal(ExtensionBridgeCommandName.StartTask),
		instanceId: z.string(),
		payload: z.object({
			text: z.string(),
			images: z.array(z.string()).optional(),
			mode: z.string().optional(),
			providerProfile: z.string().optional(),
		}),
		timestamp: z.number(),
	}),
	z.object({
		type: z.literal(ExtensionBridgeCommandName.StopTask),
		instanceId: z.string(),
		payload: z.object({ taskId: z.string() }),
		timestamp: z.number(),
	}),
	z.object({
		type: z.literal(ExtensionBridgeCommandName.ResumeTask),
		instanceId: z.string(),
		payload: z.object({ taskId: z.string() }),
		timestamp: z.number(),
	}),
])

export type ExtensionBridgeCommand = z.infer<typeof extensionBridgeCommandSchema>

/**
 * TaskBridgeEvent
 */

export enum TaskBridgeEventName {
	Message = RooCodeEventName.Message,
	TaskModeSwitched = RooCodeEventName.TaskModeSwitched,
	TaskInteractive = RooCodeEventName.TaskInteractive,
}

export const taskBridgeEventSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal(TaskBridgeEventName.Message),
		taskId: z.string(),
		action: z.string(),
		message: clineMessageSchema,
	}),
	z.object({
		type: z.literal(TaskBridgeEventName.TaskModeSwitched),
		taskId: z.string(),
		mode: z.string(),
	}),
	z.object({
		type: z.literal(TaskBridgeEventName.TaskInteractive),
		taskId: z.string(),
	}),
])

export type TaskBridgeEvent = z.infer<typeof taskBridgeEventSchema>

/**
 * TaskBridgeCommand
 */

export enum TaskBridgeCommandName {
	Message = "message",
	ApproveAsk = "approve_ask",
	DenyAsk = "deny_ask",
}

export const taskBridgeCommandSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal(TaskBridgeCommandName.Message),
		taskId: z.string(),
		payload: z.object({
			text: z.string(),
			images: z.array(z.string()).optional(),
			mode: z.string().optional(),
			providerProfile: z.string().optional(),
		}),
		timestamp: z.number(),
	}),
	z.object({
		type: z.literal(TaskBridgeCommandName.ApproveAsk),
		taskId: z.string(),
		payload: z.object({
			text: z.string().optional(),
			images: z.array(z.string()).optional(),
		}),
		timestamp: z.number(),
	}),
	z.object({
		type: z.literal(TaskBridgeCommandName.DenyAsk),
		taskId: z.string(),
		payload: z.object({
			text: z.string().optional(),
			images: z.array(z.string()).optional(),
		}),
		timestamp: z.number(),
	}),
])

export type TaskBridgeCommand = z.infer<typeof taskBridgeCommandSchema>

/**
 * ExtensionSocketEvents
 */

export enum ExtensionSocketEvents {
	CONNECTED = "extension:connected",

	REGISTER = "extension:register",
	UNREGISTER = "extension:unregister",

	HEARTBEAT = "extension:heartbeat",

	EVENT = "extension:event", // event from extension instance
	RELAYED_EVENT = "extension:relayed_event", // relay from server

	COMMAND = "extension:command", // command from user
	RELAYED_COMMAND = "extension:relayed_command", // relay from server
}

/**
 * TaskSocketEvents
 */

export enum TaskSocketEvents {
	JOIN = "task:join",
	LEAVE = "task:leave",

	EVENT = "task:event", // event from extension task
	RELAYED_EVENT = "task:relayed_event", // relay from server

	COMMAND = "task:command", // command from user
	RELAYED_COMMAND = "task:relayed_command", // relay from server
}

/**
 * `emit()` Response Types
 */

export type JoinResponse = {
	success: boolean
	error?: string
	taskId?: string
	timestamp?: string
}

export type LeaveResponse = {
	success: boolean
	taskId?: string
	timestamp?: string
}

/**
 * UsageStats
 */

export const usageStatsSchema = z.object({
	success: z.boolean(),
	data: z.object({
		dates: z.array(z.string()), // Array of date strings
		tasks: z.array(z.number()), // Array of task counts
		tokens: z.array(z.number()), // Array of token counts
		costs: z.array(z.number()), // Array of costs in USD
		totals: z.object({
			tasks: z.number(),
			tokens: z.number(),
			cost: z.number(), // Total cost in USD
		}),
	}),
	period: z.number(), // Period in days (e.g., 30)
})

export type UsageStats = z.infer<typeof usageStatsSchema>
