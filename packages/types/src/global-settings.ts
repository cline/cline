import { z } from "zod"

import type { Keys } from "./type-fu.js"
import {
	type ProviderSettings,
	PROVIDER_SETTINGS_KEYS,
	providerSettingsEntrySchema,
	providerSettingsSchema,
} from "./provider-settings.js"
import { historyItemSchema } from "./history.js"
import { codebaseIndexModelsSchema, codebaseIndexConfigSchema } from "./codebase-index.js"
import { experimentsSchema } from "./experiment.js"
import { telemetrySettingsSchema } from "./telemetry.js"
import { modeConfigSchema } from "./mode.js"
import { customModePromptsSchema, customSupportPromptsSchema } from "./mode.js"
import { languagesSchema } from "./vscode.js"

/**
 * GlobalSettings
 */

export const globalSettingsSchema = z.object({
	currentApiConfigName: z.string().optional(),
	listApiConfigMeta: z.array(providerSettingsEntrySchema).optional(),
	pinnedApiConfigs: z.record(z.string(), z.boolean()).optional(),

	lastShownAnnouncementId: z.string().optional(),
	customInstructions: z.string().optional(),
	taskHistory: z.array(historyItemSchema).optional(),

	condensingApiConfigId: z.string().optional(),
	customCondensingPrompt: z.string().optional(),

	autoApprovalEnabled: z.boolean().optional(),
	alwaysAllowReadOnly: z.boolean().optional(),
	alwaysAllowReadOnlyOutsideWorkspace: z.boolean().optional(),
	codebaseIndexModels: codebaseIndexModelsSchema.optional(),
	codebaseIndexConfig: codebaseIndexConfigSchema.optional(),
	alwaysAllowWrite: z.boolean().optional(),
	alwaysAllowWriteOutsideWorkspace: z.boolean().optional(),
	writeDelayMs: z.number().optional(),
	alwaysAllowBrowser: z.boolean().optional(),
	alwaysApproveResubmit: z.boolean().optional(),
	requestDelaySeconds: z.number().optional(),
	alwaysAllowMcp: z.boolean().optional(),
	alwaysAllowModeSwitch: z.boolean().optional(),
	alwaysAllowSubtasks: z.boolean().optional(),
	alwaysAllowExecute: z.boolean().optional(),
	allowedCommands: z.array(z.string()).optional(),
	allowedMaxRequests: z.number().nullish(),
	autoCondenseContextPercent: z.number().optional(),

	browserToolEnabled: z.boolean().optional(),
	browserViewportSize: z.string().optional(),
	screenshotQuality: z.number().optional(),
	remoteBrowserEnabled: z.boolean().optional(),
	remoteBrowserHost: z.string().optional(),
	cachedChromeHostUrl: z.string().optional(),

	enableCheckpoints: z.boolean().optional(),

	ttsEnabled: z.boolean().optional(),
	ttsSpeed: z.number().optional(),
	soundEnabled: z.boolean().optional(),
	soundVolume: z.number().optional(),

	maxOpenTabsContext: z.number().optional(),
	maxWorkspaceFiles: z.number().optional(),
	showRooIgnoredFiles: z.boolean().optional(),
	maxReadFileLine: z.number().optional(),

	terminalOutputLineLimit: z.number().optional(),
	terminalShellIntegrationTimeout: z.number().optional(),
	terminalShellIntegrationDisabled: z.boolean().optional(),
	terminalCommandDelay: z.number().optional(),
	terminalPowershellCounter: z.boolean().optional(),
	terminalZshClearEolMark: z.boolean().optional(),
	terminalZshOhMy: z.boolean().optional(),
	terminalZshP10k: z.boolean().optional(),
	terminalZdotdir: z.boolean().optional(),
	terminalCompressProgressBar: z.boolean().optional(),

	rateLimitSeconds: z.number().optional(),
	diffEnabled: z.boolean().optional(),
	fuzzyMatchThreshold: z.number().optional(),
	experiments: experimentsSchema.optional(),

	language: languagesSchema.optional(),

	telemetrySetting: telemetrySettingsSchema.optional(),

	mcpEnabled: z.boolean().optional(),
	enableMcpServerCreation: z.boolean().optional(),

	mode: z.string().optional(),
	modeApiConfigs: z.record(z.string(), z.string()).optional(),
	customModes: z.array(modeConfigSchema).optional(),
	customModePrompts: customModePromptsSchema.optional(),
	customSupportPrompts: customSupportPromptsSchema.optional(),
	enhancementApiConfigId: z.string().optional(),
	historyPreviewCollapsed: z.boolean().optional(),
})

export type GlobalSettings = z.infer<typeof globalSettingsSchema>

type GlobalSettingsRecord = Record<Keys<GlobalSettings>, undefined>

const globalSettingsRecord: GlobalSettingsRecord = {
	codebaseIndexModels: undefined,
	codebaseIndexConfig: undefined,
	currentApiConfigName: undefined,
	listApiConfigMeta: undefined,
	pinnedApiConfigs: undefined,

	lastShownAnnouncementId: undefined,
	customInstructions: undefined,
	taskHistory: undefined,

	condensingApiConfigId: undefined,
	customCondensingPrompt: undefined,

	autoApprovalEnabled: undefined,
	alwaysAllowReadOnly: undefined,
	alwaysAllowReadOnlyOutsideWorkspace: undefined,
	alwaysAllowWrite: undefined,
	alwaysAllowWriteOutsideWorkspace: undefined,
	writeDelayMs: undefined,
	alwaysAllowBrowser: undefined,
	alwaysApproveResubmit: undefined,
	requestDelaySeconds: undefined,
	alwaysAllowMcp: undefined,
	alwaysAllowModeSwitch: undefined,
	alwaysAllowSubtasks: undefined,
	alwaysAllowExecute: undefined,
	allowedCommands: undefined,
	allowedMaxRequests: undefined,
	autoCondenseContextPercent: undefined,

	browserToolEnabled: undefined,
	browserViewportSize: undefined,
	screenshotQuality: undefined,
	remoteBrowserEnabled: undefined,
	remoteBrowserHost: undefined,

	enableCheckpoints: undefined,

	ttsEnabled: undefined,
	ttsSpeed: undefined,
	soundEnabled: undefined,
	soundVolume: undefined,

	maxOpenTabsContext: undefined,
	maxWorkspaceFiles: undefined,
	showRooIgnoredFiles: undefined,
	maxReadFileLine: undefined,

	terminalOutputLineLimit: undefined,
	terminalShellIntegrationTimeout: undefined,
	terminalShellIntegrationDisabled: undefined,
	terminalCommandDelay: undefined,
	terminalPowershellCounter: undefined,
	terminalZshClearEolMark: undefined,
	terminalZshOhMy: undefined,
	terminalZshP10k: undefined,
	terminalZdotdir: undefined,
	terminalCompressProgressBar: undefined,

	rateLimitSeconds: undefined,
	diffEnabled: undefined,
	fuzzyMatchThreshold: undefined,
	experiments: undefined,

	language: undefined,

	telemetrySetting: undefined,

	mcpEnabled: undefined,
	enableMcpServerCreation: undefined,

	mode: undefined,
	modeApiConfigs: undefined,
	customModes: undefined,
	customModePrompts: undefined,
	customSupportPrompts: undefined,
	enhancementApiConfigId: undefined,
	cachedChromeHostUrl: undefined,
	historyPreviewCollapsed: undefined,
}

export const GLOBAL_SETTINGS_KEYS = Object.keys(globalSettingsRecord) as Keys<GlobalSettings>[]

/**
 * RooCodeSettings
 */

export const rooCodeSettingsSchema = providerSettingsSchema.merge(globalSettingsSchema)

export type RooCodeSettings = GlobalSettings & ProviderSettings

/**
 * SecretState
 */

export type SecretState = Pick<
	ProviderSettings,
	| "apiKey"
	| "glamaApiKey"
	| "openRouterApiKey"
	| "awsAccessKey"
	| "awsSecretKey"
	| "awsSessionToken"
	| "openAiApiKey"
	| "geminiApiKey"
	| "openAiNativeApiKey"
	| "deepSeekApiKey"
	| "mistralApiKey"
	| "unboundApiKey"
	| "requestyApiKey"
	| "xaiApiKey"
	| "groqApiKey"
	| "chutesApiKey"
	| "litellmApiKey"
	| "codeIndexOpenAiKey"
	| "codeIndexQdrantApiKey"
>

export type CodeIndexSecrets = "codeIndexOpenAiKey" | "codeIndexQdrantApiKey"

type SecretStateRecord = Record<Keys<SecretState>, undefined>

const secretStateRecord: SecretStateRecord = {
	apiKey: undefined,
	glamaApiKey: undefined,
	openRouterApiKey: undefined,
	awsAccessKey: undefined,
	awsSecretKey: undefined,
	awsSessionToken: undefined,
	openAiApiKey: undefined,
	geminiApiKey: undefined,
	openAiNativeApiKey: undefined,
	deepSeekApiKey: undefined,
	mistralApiKey: undefined,
	unboundApiKey: undefined,
	requestyApiKey: undefined,
	xaiApiKey: undefined,
	groqApiKey: undefined,
	chutesApiKey: undefined,
	litellmApiKey: undefined,
	codeIndexOpenAiKey: undefined,
	codeIndexQdrantApiKey: undefined,
}

export const SECRET_STATE_KEYS = Object.keys(secretStateRecord) as Keys<SecretState>[]

export const isSecretStateKey = (key: string): key is Keys<SecretState> =>
	SECRET_STATE_KEYS.includes(key as Keys<SecretState>)

/**
 * GlobalState
 */

export type GlobalState = Omit<RooCodeSettings, Keys<SecretState>>

export const GLOBAL_STATE_KEYS = [...GLOBAL_SETTINGS_KEYS, ...PROVIDER_SETTINGS_KEYS].filter(
	(key: Keys<RooCodeSettings>) => !SECRET_STATE_KEYS.includes(key as Keys<SecretState>),
) as Keys<GlobalState>[]

export const isGlobalStateKey = (key: string): key is Keys<GlobalState> =>
	GLOBAL_STATE_KEYS.includes(key as Keys<GlobalState>)
