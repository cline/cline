import { AutoApprovalSettings, DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { ApiProvider, BEDROCK_DEFAULT_MODEL_ID, BEDROCK_DEFAULT_REGION, DEFAULT_API_PROVIDER } from "@shared/api"
import { BrowserSettings, DEFAULT_BROWSER_SETTINGS } from "@shared/BrowserSettings"
import { ClineRulesToggles } from "@shared/cline-rules"
import { DEFAULT_FOCUS_CHAIN_SETTINGS, FocusChainSettings } from "@shared/FocusChainSettings"
import { HistoryItem } from "@shared/HistoryItem"
import { DEFAULT_MCP_DISPLAY_MODE, McpDisplayMode } from "@shared/McpDisplayMode"
import { WorkspaceRoot } from "@shared/multi-root/types"
import { GlobalInstructionsFile } from "@shared/remote-config/schema"
import { Mode } from "@shared/storage/types"
import { TelemetrySetting } from "@shared/TelemetrySetting"
import { type BlobStoreSettings } from "./types"

// ============================================================================
// SINGLE SOURCE OF TRUTH FOR STORAGE KEYS
//
// Property definitions with types, default values, and metadata
// NOTE: When adding a new field, the scripts/generate-state-proto.mjs will be
// executed automatically to regenerate the proto/cline/state.proto file with the
// new fields once the file is staged and committed.
// ============================================================================

/**
 * Defines the shape of a field definition. Each field must have a `default` value,
 * and optionally can have `isAsync`, `isComputed`, or `transform` metadata.
 *
 * The type casting on `default` (e.g., `true as boolean`) is necessary because
 * TypeScript would otherwise infer the literal type (`true`) instead of the
 * wider type (`boolean`). This ensures the generated interfaces allow any
 * value of that type, not just the default literal.
 */
type FieldDefinition<T> = {
	default: T // The default value for the field with proper type casting using as (e.g., `true as boolean | undefined`)
	isAsync?: boolean
	isComputed?: boolean
	transform?: (value: any) => T
}

type FieldDefinitions = Record<string, FieldDefinition<any>>

const REMOTE_CONFIG_EXTRA_FIELDS = {
	remoteConfiguredProviders: { default: [] as ApiProvider[] },
	allowedMCPServers: { default: [] as Array<{ id: string }> },
	remoteMCPServers: { default: undefined as Array<{ name: string; url: string; alwaysEnabled?: boolean }> | undefined },
	previousRemoteMCPServers: { default: undefined as Array<{ name: string; url: string }> | undefined },
	remoteGlobalRules: { default: undefined as GlobalInstructionsFile[] | undefined },
	remoteGlobalWorkflows: { default: undefined as GlobalInstructionsFile[] | undefined },
	remoteGlobalSkills: { default: undefined as GlobalInstructionsFile[] | undefined },
	blockPersonalRemoteMCPServers: { default: false as boolean },
	openTelemetryOtlpHeaders: { default: undefined as Record<string, string> | undefined },
	otlpMetricsHeaders: { default: undefined as Record<string, string> | undefined },
	otlpLogsHeaders: { default: undefined as Record<string, string> | undefined },
	blobStoreConfig: { default: undefined as BlobStoreSettings | undefined },
} satisfies FieldDefinitions

const GLOBAL_STATE_FIELDS = {
	clineVersion: { default: undefined as string | undefined },
	bedrockInferenceMigrationVersion: { default: 0 as number },
	"cline.generatedMachineId": { default: undefined as string | undefined }, // Note, distinctId reads/writes this directly from/to StorageContext before StateManager is initialized.
	lastShownAnnouncementId: { default: undefined as string | undefined },
	taskHistory: { default: [] as HistoryItem[], isAsync: true },
	mcpMarketplaceEnabled: { default: true as boolean },
	mcpResponsesCollapsed: { default: false as boolean },
	terminalReuseEnabled: { default: true as boolean },
	vscodeTerminalExecutionMode: {
		// Default to background execution to match the CLI's behavior. Users who
		// previously chose a mode keep their saved value (we can't distinguish an
		// explicit choice from a coincidentally-saved old default, so we honor it).
		default: "backgroundExec" as "vscodeTerminal" | "backgroundExec",
	},
	isNewUser: { default: true as boolean },
	welcomeViewCompleted: { default: undefined as boolean | undefined },
	mcpDisplayMode: { default: DEFAULT_MCP_DISPLAY_MODE as McpDisplayMode },
	workspaceRoots: { default: undefined as WorkspaceRoot[] | undefined },
	primaryRootIndex: { default: 0 as number },
	multiRootEnabled: { default: true as boolean },
	lastDismissedInfoBannerVersion: { default: 0 as number },
	lastDismissedModelBannerVersion: { default: 0 as number },
	lastDismissedCliBannerVersion: { default: 0 as number },
	remoteRulesToggles: { default: {} as ClineRulesToggles },
	remoteWorkflowToggles: { default: {} as ClineRulesToggles },
	remoteSkillsToggles: { default: {} as ClineRulesToggles },
	dismissedBanners: { default: [] as Array<{ bannerId: string; dismissedAt: number }> },
	// Path to worktree that should auto-open Cline sidebar when launched
	worktreeAutoOpenPath: { default: undefined as string | undefined },
} satisfies FieldDefinitions

// Fields that map directly to ApiHandlerOptions in @shared/api.ts
const API_HANDLER_SETTINGS_FIELDS = {
	awsRegion: { default: BEDROCK_DEFAULT_REGION as string },
	awsProfile: { default: undefined as string | undefined },
	awsBedrockEndpoint: { default: undefined as string | undefined },
	awsBedrockCaBundlePath: { default: undefined as string | undefined },
	planModeApiModelId: { default: BEDROCK_DEFAULT_MODEL_ID as string },
	planModeThinkingBudgetTokens: { default: undefined as number | undefined },
	planModeReasoningEffort: { default: undefined as string | undefined },
	actModeApiModelId: { default: BEDROCK_DEFAULT_MODEL_ID as string },
	actModeThinkingBudgetTokens: { default: undefined as number | undefined },
	actModeReasoningEffort: { default: undefined as string | undefined },
	planModeApiProvider: { default: DEFAULT_API_PROVIDER as ApiProvider },
	actModeApiProvider: { default: DEFAULT_API_PROVIDER as ApiProvider },
} satisfies FieldDefinitions

const USER_SETTINGS_FIELDS = {
	// Settings that are NOT part of ApiHandlerOptions
	autoApprovalSettings: {
		default: DEFAULT_AUTO_APPROVAL_SETTINGS as AutoApprovalSettings,
	},
	globalClineRulesToggles: { default: {} as ClineRulesToggles },
	globalWorkflowToggles: { default: {} as ClineRulesToggles },
	globalSkillsToggles: { default: {} as Record<string, boolean> },
	browserSettings: {
		default: DEFAULT_BROWSER_SETTINGS as BrowserSettings,
		transform: (v: any) => ({ ...DEFAULT_BROWSER_SETTINGS, ...v }),
	},
	telemetrySetting: { default: "unset" as TelemetrySetting },
	planActSeparateModelsSetting: { default: false as boolean, isComputed: true },
	enableCheckpointsSetting: { default: true as boolean },
	shellIntegrationTimeout: { default: 4000 as number },
	defaultTerminalProfile: { default: "default" as string },
	maxConsecutiveMistakes: { default: 3 as number },
	hooksEnabled: { default: true as boolean },
	yoloModeToggled: { default: false as boolean },
	autoApproveAllToggled: { default: false as boolean },
	useAutoCondense: { default: false as boolean },
	subagentsEnabled: { default: false as boolean },
	worktreesEnabled: { default: false as boolean },
	preferredLanguage: { default: "English" as string },
	mode: { default: "act" as Mode },
	focusChainSettings: { default: DEFAULT_FOCUS_CHAIN_SETTINGS as FocusChainSettings },
	customPrompt: { default: undefined as "compact" | undefined },
	backgroundEditEnabled: { default: false as boolean },
	optOutOfRemoteConfig: { default: false as boolean },
	showFeatureTips: { default: true as boolean },

	// OpenTelemetry configuration
	openTelemetryEnabled: { default: true as boolean },
	openTelemetryMetricsExporter: { default: undefined as string | undefined },
	openTelemetryLogsExporter: { default: undefined as string | undefined },
	openTelemetryOtlpProtocol: { default: "http/json" as string | undefined },
	openTelemetryOtlpEndpoint: { default: "http://localhost:4318" as string | undefined },
	openTelemetryOtlpMetricsProtocol: { default: undefined as string | undefined },
	openTelemetryOtlpMetricsEndpoint: { default: undefined as string | undefined },
	openTelemetryOtlpLogsProtocol: { default: undefined as string | undefined },
	openTelemetryOtlpLogsEndpoint: { default: undefined as string | undefined },
	openTelemetryMetricExportInterval: { default: 60000 as number | undefined },
	openTelemetryOtlpInsecure: { default: false as boolean | undefined },
	openTelemetryLogBatchSize: { default: 512 as number | undefined },
	openTelemetryLogBatchTimeout: { default: 5000 as number | undefined },
	openTelemetryLogMaxQueueSize: { default: 2048 as number | undefined },
} satisfies FieldDefinitions

const SETTINGS_FIELDS = { ...API_HANDLER_SETTINGS_FIELDS, ...USER_SETTINGS_FIELDS }
const GLOBAL_STATE_AND_SETTINGS_FIELDS = { ...GLOBAL_STATE_FIELDS, ...SETTINGS_FIELDS }

// ============================================================================
// SECRET KEYS AND LOCAL STATE - Static definitions
// ============================================================================

// MCP OAuth is unrelated to model authentication and remains supported.
const SECRETS_KEYS = ["mcpOAuthSecrets"] as const

// WARNING, these are not ALL of the local state keys in practice. For example, FileContextTracker
// uses dynamic keys like pendingFileContextWarning_${taskId}.
export const LocalStateKeys = [
	"localClineRulesToggles",
	"localCursorRulesToggles",
	"localWindsurfRulesToggles",
	"localAgentsRulesToggles",
	"localSkillsToggles",
	"workflowToggles",
] as const

// ============================================================================
// GENERATED TYPES - Auto-generated from property definitions
// ============================================================================

type ExtractDefault<T> = T extends { default: infer U } ? U : never
type BuildInterface<T extends Record<string, { default: any }>> = { [K in keyof T]: ExtractDefault<T[K]> }

export type GlobalState = BuildInterface<typeof GLOBAL_STATE_FIELDS>
export type Settings = BuildInterface<typeof SETTINGS_FIELDS>
type RemoteConfigExtra = BuildInterface<typeof REMOTE_CONFIG_EXTRA_FIELDS>
export type ApiHandlerOptionSettings = BuildInterface<typeof API_HANDLER_SETTINGS_FIELDS>
export type ApiHandlerSettings = ApiHandlerOptionSettings & Secrets
export type GlobalStateAndSettings = GlobalState & Settings
export type RemoteConfigFields = GlobalStateAndSettings & RemoteConfigExtra

// ============================================================================
// TYPE ALIASES
// ============================================================================

export type Secrets = { [K in (typeof SecretKeys)[number]]: string | undefined }
export type LocalState = { [K in (typeof LocalStateKeys)[number]]: ClineRulesToggles }
export type SecretKey = (typeof SecretKeys)[number]
export type GlobalStateKey = keyof GlobalState
export type LocalStateKey = keyof LocalState
export type SettingsKey = keyof Settings
export type GlobalStateAndSettingsKey = keyof GlobalStateAndSettings

// ============================================================================
// GENERATED KEYS AND LOOKUP SETS - Auto-generated from property definitions
// ============================================================================

const GlobalStateKeys = new Set(Object.keys(GLOBAL_STATE_FIELDS))
const SettingsKeysSet = new Set(Object.keys(SETTINGS_FIELDS))
const GlobalStateAndSettingsKeySet = new Set(Object.keys(GLOBAL_STATE_AND_SETTINGS_FIELDS))
const ApiHandlerSettingsKeysSet = new Set(Object.keys(API_HANDLER_SETTINGS_FIELDS))

export const SecretKeys = Array.from(SECRETS_KEYS)
export const SettingsKeys = Array.from(SettingsKeysSet) as (keyof Settings)[]
export const ApiHandlerSettingsKeys = Array.from(ApiHandlerSettingsKeysSet) as (keyof ApiHandlerOptionSettings)[]
export const GlobalStateAndSettingKeys = Array.from(GlobalStateAndSettingsKeySet) as GlobalStateAndSettingsKey[]

// GENERATED DEFAULTS - Auto-generated from property definitions
// ============================================================================

export const GLOBAL_STATE_DEFAULTS = extractDefaults(GLOBAL_STATE_FIELDS)
export const SETTINGS_DEFAULTS = extractDefaults(SETTINGS_FIELDS)
export const SETTINGS_TRANSFORMS = extractTransforms(SETTINGS_FIELDS)
const ASYNC_PROPERTIES = extractMetadata({ ...GLOBAL_STATE_FIELDS, ...SETTINGS_FIELDS }, "isAsync")
const COMPUTED_PROPERTIES = extractMetadata({ ...GLOBAL_STATE_FIELDS, ...SETTINGS_FIELDS }, "isComputed")

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

export const isGlobalStateKey = (key: string): key is GlobalStateKey => GlobalStateKeys.has(key)
export const isSettingsKey = (key: string): key is SettingsKey => SettingsKeysSet.has(key)
export const isSecretKey = (key: string): key is SecretKey => new Set(SECRETS_KEYS).has(key as SecretKey)
export const isLocalStateKey = (key: string): key is LocalStateKey => new Set(LocalStateKeys).has(key as LocalStateKey)

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export const isAsyncProperty = (key: string): boolean => ASYNC_PROPERTIES.has(key)
export const isComputedProperty = (key: string): boolean => COMPUTED_PROPERTIES.has(key)

export const getDefaultValue = <K extends GlobalStateAndSettingsKey>(key: K): GlobalStateAndSettings[K] | undefined => {
	return ((GLOBAL_STATE_DEFAULTS as any)[key] ?? (SETTINGS_DEFAULTS as any)[key]) as GlobalStateAndSettings[K] | undefined
}

export const hasTransform = (key: string): boolean => key in SETTINGS_TRANSFORMS
export const applyTransform = <T>(key: string, value: T): T => {
	const transform = SETTINGS_TRANSFORMS[key]
	return transform ? transform(value) : value
}

function extractDefaults<T extends Record<string, any>>(props: T): Partial<BuildInterface<T>> {
	return Object.fromEntries(
		Object.entries(props)
			.map(([key, prop]) => [key, prop.default])
			.filter(([_, value]) => value !== undefined),
	) as Partial<BuildInterface<T>>
}

function extractTransforms<T extends Record<string, any>>(props: T): Record<string, (value: any) => any> {
	return Object.fromEntries(
		Object.entries(props)
			.filter(([_, prop]) => "transform" in prop && prop.transform !== undefined)
			.map(([key, prop]) => [key, prop.transform]),
	)
}

function extractMetadata<T extends Record<string, any>>(props: T, field: string): Set<string> {
	return new Set(
		Object.entries(props)
			.filter(([_, prop]) => field in prop && prop[field] === true)
			.map(([key]) => key),
	)
}
