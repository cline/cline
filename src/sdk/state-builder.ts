/**
 * State Builder
 *
 * Constructs the ExtensionState object that the webview expects from
 * legacy settings, SDK session state, and current messages. This is
 * the "interface contract" between the SDK adapter layer and the
 * existing webview.
 *
 * The webview's ExtensionStateContext receives this object and
 * distributes it to all React components.
 */

import type {
	ClineMessage,
	ExtensionState,
	Platform,
} from "@shared/ExtensionMessage"
import type { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import type { BrowserSettings } from "@shared/BrowserSettings"
import type { FocusChainSettings } from "@shared/FocusChainSettings"
import type { HistoryItem } from "@shared/HistoryItem"
import type { ApiConfiguration } from "@shared/api"
import type { ClineRulesToggles } from "@shared/cline-rules"
import type { McpDisplayMode } from "@shared/McpDisplayMode"
import type { TelemetrySetting } from "@shared/TelemetrySetting"
import type { UserInfo } from "@shared/UserInfo"
import type { Mode } from "@shared/storage/types"
import type { LegacyStateReader } from "./legacy-state-reader"
import type { ClineAuthCredentials } from "./legacy-state-reader"

// ---------------------------------------------------------------------------
// Default values for ExtensionState fields
// ---------------------------------------------------------------------------

const DEFAULT_AUTO_APPROVAL: AutoApprovalSettings = {
	enabled: false,
	actions: {
		readFiles: false,
		editFiles: false,
		executeCommands: false,
		useBrowser: false,
		useMcp: false,
	},
	notifications: {
		sound: false,
		tts: false,
	},
	maxRequests: 20,
	enableNotifications: false,
	favorites: {},
	version: 0,
}

const DEFAULT_BROWSER_SETTINGS: BrowserSettings = {
	headless: true,
	viewport: {
		width: 900,
		height: 600,
	},
}

const DEFAULT_FOCUS_CHAIN_SETTINGS: FocusChainSettings = {
	enabled: false,
}

// ---------------------------------------------------------------------------
// StateBuilderInput — what the state builder needs
// ---------------------------------------------------------------------------

export interface StateBuilderInput {
	/** Legacy state reader for reading persisted settings */
	legacyState?: LegacyStateReader

	/** Current ClineMessages (from MessageTranslator) */
	clineMessages?: ClineMessage[]

	/** Current task's HistoryItem (if a session is active) */
	currentTaskItem?: HistoryItem

	/** Task history (from persisted storage) */
	taskHistory?: HistoryItem[]

	/** Current mode (plan/act) */
	mode?: Mode

	/** API configuration */
	apiConfiguration?: ApiConfiguration

	/** User info (from Cline auth) */
	userInfo?: UserInfo

	/** Extension version */
	version?: string

	/** Distinct ID for telemetry */
	distinctId?: string

	/** Platform */
	platform?: Platform

	/** Whether background command is running */
	backgroundCommandRunning?: boolean

	/** Override for any ExtensionState fields */
	overrides?: Partial<ExtensionState>
}

// ---------------------------------------------------------------------------
// buildExtensionState — the core function
// ---------------------------------------------------------------------------

/**
 * Build an ExtensionState object suitable for posting to the webview.
 *
 * This produces an object with every field the webview expects,
 * using sensible defaults for anything not provided. The webview
 * should render correctly with any subset of inputs.
 */
export function buildExtensionState(input: StateBuilderInput = {}): ExtensionState {
	const legacyState = input.legacyState
	const globalState = legacyState?.readGlobalState()
	const autoApproval = globalState?.autoApprovalSettings

	// Merge auto-approval from legacy state with defaults
	const autoApprovalSettings: AutoApprovalSettings = autoApproval
		? { ...DEFAULT_AUTO_APPROVAL, ...autoApproval }
		: DEFAULT_AUTO_APPROVAL

	// Process task history: filter valid items, sort by ts desc, limit to 100
	const rawHistory = input.taskHistory ?? globalState?.taskHistory ?? []
	const processedTaskHistory = rawHistory
		.filter((item) => item.ts && item.task)
		.sort((a, b) => b.ts - a.ts)
		.slice(0, 100)

	// Build ClineMessages array — spread to create new reference for React
	const clineMessages = [...(input.clineMessages ?? [])]

	const state: ExtensionState = {
		// Identity & version
		version: input.version ?? "0.0.0",
		distinctId: input.distinctId ?? "",
		platform: input.platform ?? (typeof process !== "undefined" ? (process.platform as Platform) : "unknown"),
		environment: undefined,
		isNewUser: globalState?.isNewUser ?? true,
		welcomeViewCompleted: globalState?.welcomeViewCompleted ?? false,
		onboardingModels: undefined,

		// API / Provider
		apiConfiguration: input.apiConfiguration ?? globalState?.apiConfiguration,

		// Session state
		clineMessages,
		currentTaskItem: input.currentTaskItem,
		currentFocusChainChecklist: null,
		checkpointManagerErrorMessage: undefined,

		// Task history
		taskHistory: processedTaskHistory,

		// Settings
		autoApprovalSettings,
		browserSettings: globalState?.browserSettings ?? DEFAULT_BROWSER_SETTINGS,
		focusChainSettings: globalState?.focusChainSettings ?? DEFAULT_FOCUS_CHAIN_SETTINGS,
		preferredLanguage: globalState?.preferredLanguage,
		mode: input.mode ?? globalState?.mode ?? "act",
		strictPlanModeEnabled: globalState?.strictPlanModeEnabled,
		yoloModeToggled: globalState?.yoloModeToggled,
		useAutoCondense: globalState?.useAutoCondense,
		subagentsEnabled: globalState?.subagentsEnabled,
		planActSeparateModelsSetting: globalState?.planActSeparateModelsSetting ?? false,
		enableCheckpointsSetting: globalState?.enableCheckpointsSetting ?? true,
		telemetrySetting: (globalState?.telemetrySetting as TelemetrySetting) ?? "unset",
		shellIntegrationTimeout: globalState?.shellIntegrationTimeout ?? 15000,
		terminalReuseEnabled: globalState?.terminalReuseEnabled,
		terminalOutputLineLimit: globalState?.terminalOutputLineLimit ?? 500,
		maxConsecutiveMistakes: globalState?.maxConsecutiveMistakes ?? 3,
		defaultTerminalProfile: (globalState?.defaultTerminalProfile as string | undefined),
		availableTerminalProfiles: [],
		vscodeTerminalExecutionMode: (globalState?.vscodeTerminalExecutionMode as string | undefined) ?? "default",
		customPrompt: (globalState?.customPrompt as "compact" | undefined),
		mcpMarketplaceEnabled: (globalState?.mcpMarketplaceEnabled as boolean | undefined),
		mcpDisplayMode: (globalState?.mcpDisplayMode as McpDisplayMode) ?? "expanded",
		mcpResponsesCollapsed: (globalState?.mcpResponsesCollapsed as boolean | undefined),

		// User
		userInfo: input.userInfo,
		shouldShowAnnouncement: false,

		// Rules toggles
		globalClineRulesToggles: (globalState?.globalClineRulesToggles as ClineRulesToggles) ?? {},
		localClineRulesToggles: {},
		localWorkflowToggles: {},
		globalWorkflowToggles: (globalState?.globalWorkflowToggles as ClineRulesToggles) ?? {},
		localCursorRulesToggles: {},
		localWindsurfRulesToggles: {},
		localAgentsRulesToggles: {},
		remoteRulesToggles: undefined,
		remoteWorkflowToggles: undefined,

		// Skills
		globalSkillsToggles: (globalState?.globalSkillsToggles as Record<string, boolean>) ?? {},
		localSkillsToggles: {},

		// Model favorites
		favoritedModelIds: (globalState?.favoritedModelIds as string[]) ?? [],

		// Workspace
		workspaceRoots: [],
		primaryRootIndex: 0,
		isMultiRootWorkspace: false,
		multiRootSetting: { user: false, featureFlag: true },
		clineWebToolsEnabled: { user: false, featureFlag: true },
		worktreesEnabled: { user: false, featureFlag: true },

		// Banners
		lastDismissedInfoBannerVersion: (globalState?.lastDismissedInfoBannerVersion as number) ?? 0,
		lastDismissedModelBannerVersion: (globalState?.lastDismissedModelBannerVersion as number) ?? 0,
		lastDismissedCliBannerVersion: (globalState?.lastDismissedCliBannerVersion as number) ?? 0,
		dismissedBanners: undefined,
		banners: [],
		welcomeBanners: [],

		// Hooks
		hooksEnabled: (globalState?.hooksEnabled as boolean | undefined) ?? false,

		// Remote config
		remoteConfigSettings: undefined,

		// Feature flags
		nativeToolCallSetting: (globalState?.nativeToolCallEnabled as boolean | undefined) ?? undefined,
		enableParallelToolCalling: (globalState?.enableParallelToolCalling as boolean | undefined) ?? undefined,
		backgroundEditEnabled: (globalState?.backgroundEditEnabled as boolean | undefined) ?? undefined,
		optOutOfRemoteConfig: (globalState?.optOutOfRemoteConfig as boolean | undefined) ?? undefined,
		doubleCheckCompletionEnabled: (globalState?.doubleCheckCompletionEnabled as boolean | undefined) ?? undefined,
		lazyTeammateModeEnabled: (globalState?.lazyTeammateModeEnabled as boolean | undefined) ?? undefined,
		showFeatureTips: (globalState?.showFeatureTips as boolean | undefined) ?? undefined,
		openAiCodexIsAuthenticated: false,

		// Background command
		backgroundCommandRunning: input.backgroundCommandRunning,
		backgroundCommandTaskId: undefined,

		// Apply any overrides last
		...input.overrides,
	}

	return state
}

// ---------------------------------------------------------------------------
// Interface Contract — list of fields the webview actually reads
// ---------------------------------------------------------------------------

/**
 * These are the ExtensionState fields that the webview's
 * ExtensionStateContext.tsx and React components actually read.
 * If any of these are missing or wrong-typed, the UI will break.
 *
 * This list was extracted by grepping the webview source for
 * `state.` patterns and component prop usage.
 */
export const REQUIRED_STATE_FIELDS: (keyof ExtensionState)[] = [
	"version",
	"apiConfiguration",
	"clineMessages",
	"taskHistory",
	"currentTaskItem",
	"mode",
	"autoApprovalSettings",
	"browserSettings",
	"focusChainSettings",
	"telemetrySetting",
	"planActSeparateModelsSetting",
	"platform",
	"isNewUser",
	"welcomeViewCompleted",
	"shouldShowAnnouncement",
	"globalClineRulesToggles",
	"localClineRulesToggles",
	"localCursorRulesToggles",
	"localWindsurfRulesToggles",
	"localAgentsRulesToggles",
	"localWorkflowToggles",
	"globalWorkflowToggles",
	"mcpDisplayMode",
	"shellIntegrationTimeout",
	"terminalOutputLineLimit",
	"maxConsecutiveMistakes",
	"vscodeTerminalExecutionMode",
	"workspaceRoots",
	"primaryRootIndex",
	"isMultiRootWorkspace",
	"favoritedModelIds",
	"distinctId",
]
