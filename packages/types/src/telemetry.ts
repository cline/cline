import { z } from "zod"

import { providerNames } from "./provider-settings.js"
import { clineMessageSchema } from "./message.js"

/**
 * TelemetrySetting
 */

export const telemetrySettings = ["unset", "enabled", "disabled"] as const

export const telemetrySettingsSchema = z.enum(telemetrySettings)

export type TelemetrySetting = z.infer<typeof telemetrySettingsSchema>

/**
 * TelemetryEventName
 */

export enum TelemetryEventName {
	TASK_CREATED = "Task Created",
	TASK_RESTARTED = "Task Reopened",
	TASK_COMPLETED = "Task Completed",
	TASK_MESSAGE = "Task Message",
	TASK_CONVERSATION_MESSAGE = "Conversation Message",
	LLM_COMPLETION = "LLM Completion",
	MODE_SWITCH = "Mode Switched",
	TOOL_USED = "Tool Used",

	CHECKPOINT_CREATED = "Checkpoint Created",
	CHECKPOINT_RESTORED = "Checkpoint Restored",
	CHECKPOINT_DIFFED = "Checkpoint Diffed",

	CONTEXT_CONDENSED = "Context Condensed",
	SLIDING_WINDOW_TRUNCATION = "Sliding Window Truncation",

	CODE_ACTION_USED = "Code Action Used",
	PROMPT_ENHANCED = "Prompt Enhanced",

	TITLE_BUTTON_CLICKED = "Title Button Clicked",

	AUTHENTICATION_INITIATED = "Authentication Initiated",

	MARKETPLACE_ITEM_INSTALLED = "Marketplace Item Installed",
	MARKETPLACE_ITEM_REMOVED = "Marketplace Item Removed",

	SCHEMA_VALIDATION_ERROR = "Schema Validation Error",
	DIFF_APPLICATION_ERROR = "Diff Application Error",
	SHELL_INTEGRATION_ERROR = "Shell Integration Error",
	CONSECUTIVE_MISTAKE_ERROR = "Consecutive Mistake Error",
}

/**
 * TelemetryProperties
 */

export const appPropertiesSchema = z.object({
	appName: z.string(),
	appVersion: z.string(),
	vscodeVersion: z.string(),
	platform: z.string(),
	editorName: z.string(),
	language: z.string(),
	mode: z.string(),
})

export const taskPropertiesSchema = z.object({
	taskId: z.string().optional(),
	apiProvider: z.enum(providerNames).optional(),
	modelId: z.string().optional(),
	diffStrategy: z.string().optional(),
	isSubtask: z.boolean().optional(),
})

export const telemetryPropertiesSchema = z.object({
	...appPropertiesSchema.shape,
	...taskPropertiesSchema.shape,
})

export type TelemetryProperties = z.infer<typeof telemetryPropertiesSchema>

/**
 * TelemetryEvent
 */

export type TelemetryEvent = {
	event: TelemetryEventName
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	properties?: Record<string, any>
}

/**
 * RooCodeTelemetryEvent
 */

export const rooCodeTelemetryEventSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.enum([
			TelemetryEventName.TASK_CREATED,
			TelemetryEventName.TASK_RESTARTED,
			TelemetryEventName.TASK_COMPLETED,
			TelemetryEventName.TASK_CONVERSATION_MESSAGE,
			TelemetryEventName.MODE_SWITCH,
			TelemetryEventName.TOOL_USED,
			TelemetryEventName.CHECKPOINT_CREATED,
			TelemetryEventName.CHECKPOINT_RESTORED,
			TelemetryEventName.CHECKPOINT_DIFFED,
			TelemetryEventName.CODE_ACTION_USED,
			TelemetryEventName.PROMPT_ENHANCED,
			TelemetryEventName.TITLE_BUTTON_CLICKED,
			TelemetryEventName.AUTHENTICATION_INITIATED,
			TelemetryEventName.MARKETPLACE_ITEM_INSTALLED,
			TelemetryEventName.MARKETPLACE_ITEM_REMOVED,
			TelemetryEventName.SCHEMA_VALIDATION_ERROR,
			TelemetryEventName.DIFF_APPLICATION_ERROR,
			TelemetryEventName.SHELL_INTEGRATION_ERROR,
			TelemetryEventName.CONSECUTIVE_MISTAKE_ERROR,
			TelemetryEventName.CONTEXT_CONDENSED,
			TelemetryEventName.SLIDING_WINDOW_TRUNCATION,
		]),
		properties: telemetryPropertiesSchema,
	}),
	z.object({
		type: z.literal(TelemetryEventName.TASK_MESSAGE),
		properties: z.object({
			...telemetryPropertiesSchema.shape,
			taskId: z.string(),
			message: clineMessageSchema,
		}),
	}),
	z.object({
		type: z.literal(TelemetryEventName.LLM_COMPLETION),
		properties: z.object({
			...telemetryPropertiesSchema.shape,
			inputTokens: z.number(),
			outputTokens: z.number(),
			cacheReadTokens: z.number().optional(),
			cacheWriteTokens: z.number().optional(),
			cost: z.number().optional(),
		}),
	}),
])

export type RooCodeTelemetryEvent = z.infer<typeof rooCodeTelemetryEventSchema>

/**
 * TelemetryEventSubscription
 */

export type TelemetryEventSubscription =
	| { type: "include"; events: TelemetryEventName[] }
	| { type: "exclude"; events: TelemetryEventName[] }

/**
 * TelemetryPropertiesProvider
 */

export interface TelemetryPropertiesProvider {
	getTelemetryProperties(): Promise<TelemetryProperties>
}

/**
 * TelemetryClient
 */

export interface TelemetryClient {
	subscription?: TelemetryEventSubscription

	setProvider(provider: TelemetryPropertiesProvider): void
	capture(options: TelemetryEvent): Promise<void>
	updateTelemetryState(didUserOptIn: boolean): void
	isTelemetryEnabled(): boolean
	shutdown(): Promise<void>
}
