import { HostProvider } from "@hosts/host-provider"
import type { BrowserSettings } from "@shared/BrowserSettings"
import { ShowMessageType } from "@shared/proto/host/window"
import type { TaskFeedbackType } from "@shared/WebviewMessage"
import * as os from "os"
import { ClineAccountUserInfo } from "@/services/auth/AuthService"
import { Setting } from "@/shared/proto/index.host"
import { Logger } from "@/shared/services/Logger"
import { Mode } from "@/shared/storage/types"
import { version as extensionVersion } from "../../../package.json"
import { getDeviceId, setDistinctId } from "../logging/distinctId"
import type { ITelemetryProvider, TelemetryProperties } from "./providers/ITelemetryProvider"
import {
	getRolloutErrorProperties,
	getRolloutTelemetryMetadata,
	ROLLOUT_BUNDLE_ACTIVATED_EVENT,
	type RolloutBundleActivation,
	type RolloutTelemetryMetadata,
} from "./rollout-metadata"
import { TelemetryProviderFactory } from "./TelemetryProviderFactory"

/**
 * Represents telemetry event categories that can be individually enabled or disabled
 * When adding a new category, add it both here and to the initial values in telemetryCategoryEnabled
 * Ensure `if (!this.isCategoryEnabled('<category_name>')` is added to the capture method
 */
type TelemetryCategory = "checkpoints" | "browser" | "focus_chain" | "subagents" | "skills" | "hooks"

/**
 * Terminal type for telemetry differentiation
 */
export type TerminalType = "vscode" | "standalone"

/**
 * VSCode-specific output capture methods.
 *
 * "shell_integration" means the OSC 633 C/D markers were seen and trusted —
 * output and exit code are as reliable as VS Code's shell integration gets.
 * "markerless_heuristic" means completion was inferred from an idle timeout
 * and/or prompt-pattern guess because markers never arrived (e.g. commands
 * run inside an ssh session); this must not be folded into
 * "shell_integration" successes, since it's the exact metric evaluating
 * whether shell integration is working.
 */
export type VscodeOutputMethod = "shell_integration" | "markerless_heuristic" | "clipboard" | "none" | "child_process"

/**
 * Why a markerless command (OSC 633 CommandExecuted marker never arrived) was
 * considered complete:
 * - "prompt_quiet": output went idle on a line that strongly resembles a shell
 *   prompt (bash dollar, root hash, PowerShell/CMD path, Python REPL, starship).
 * - "max_quiet_time": output arrived but then went quiet for the full
 *   MARKERLESS_MAX_QUIET_TIME without a confident prompt match.
 * - "no_data": no output ever arrived and the full quiet time elapsed.
 */
export type MarkerlessCompletionCause = "prompt_quiet" | "max_quiet_time" | "no_data"

/**
 * Standalone-specific output capture methods
 */
export type StandaloneOutputMethod = "child_process" | "child_process_error"

/**
 * Combined type for terminal output methods
 */
export type TerminalOutputMethod = VscodeOutputMethod | StandaloneOutputMethod

/**
 * Enum for terminal output failure reasons
 */
export enum TerminalOutputFailureReason {
	TIMEOUT = "timeout",
	NO_SHELL_INTEGRATION = "no_shell_integration",
	/** The terminal was closed while the command was still running. */
	TERMINAL_CLOSED = "terminal_closed",
}

/**
 * Enum for terminal user intervention actions
 */
export enum TerminalUserInterventionAction {
	PROCESS_WHILE_RUNNING = "process_while_running",
	CANCELLED = "cancelled",
}

/**
 * Enum for terminal hang stages
 */
export enum TerminalHangStage {
	WAITING_FOR_COMPLETION = "waiting_for_completion",
	BUFFER_STUCK = "buffer_stuck",
}

export type TelemetryMetadata = {
	/**
	 * The extension or cline-core version. JetBrains and CLI have different
	 * versioning than the VSCode Extension, but on those platforms this will be the _cline-core version_
	 * which uses the same as the versioning as the VSCode extension.
	 */
	extension_version: string
	/**
	 * The type of cline distribution, e.g VSCode Extension, JetBrains Plugin or CLI. This
	 * is different than the `platform` because there are many variants of VSCode and JetBrains but they
	 * all use the same extension or plugin.
	 */
	cline_type: string
	/**
	 * The version of the host-side Cline distribution package: the JetBrains plugin version
	 * (e.g. 1.1.61) on JetBrains, the extension version on VSCode (where it matches
	 * `extension_version`). Absent when the host does not report one (e.g. CLI).
	 */
	host_plugin_version?: string
	/** The name of the host IDE or environment e.g. VSCode, Cursor, IntelliJ Professional Edition, etc. */
	platform: string
	/** The version of the host environment */
	platform_version: string
	/** The operating system type, e.g. darwin, win32. This is the value returned by os.platform() */
	os_type: string
	/** The operating system version e.g. 'Windows 10 Pro', 'Darwin Kernel Version 21.6.0...'
	 * This is the value returned by os.version() */
	os_version: string
	/** Whether the current workspace is a VS Code remote workspace */
	is_remote_workspace: boolean
	/** Whether the extension is running in development mode */
	is_dev: string | undefined
	/** Present only in bundles built by the combined legacy/next rollout workflow. */
	extension_variant?: RolloutTelemetryMetadata["extension_variant"]
}

/**
 * Maximum length for error messages to prevent excessive data
 */
const MAX_ERROR_MESSAGE_LENGTH = 500

/**
 * TelemetryService handles telemetry event tracking for the Cline extension
 * Uses an abstracted telemetry provider to support multiple analytics backends
 * Respects user privacy settings and VSCode's global telemetry configuration
 */
export class TelemetryService {
	// Map to control specific telemetry categories (event types)
	private telemetryCategoryEnabled: Map<TelemetryCategory, boolean> = new Map([
		["checkpoints", true], // Checkpoints telemetry enabled
		["browser", true], // Browser telemetry enabled
		["focus_chain", true], // Focus Chain telemetry enabled
		["subagents", true], // CLI Subagents telemetry enabled
		["skills", true], // Skills telemetry enabled
		["hooks", true], // Hooks telemetry enabled
	])

	private userId?: string
	private activeOrg: {
		organization_id: string
		organization_name: string
		member_id: string
	} | null = null
	private taskErrorCounts = new Map<string, number>()
	/** Last `pending:migrated` backlog state emitted as an event, so the "backlog" event only reports transitions. */
	private lastLegacyBacklogEventKey?: string
	public static readonly METRICS = {
		TASK: {
			TURNS_TOTAL: "cline.turns.total",
			TURNS_PER_TASK: "cline.turns.per_task",
			TOKENS_INPUT_TOTAL: "cline.tokens.input.total",
			TOKENS_INPUT_PER_RESPONSE: "cline.tokens.input.per_response",
			TOKENS_OUTPUT_TOTAL: "cline.tokens.output.total",
			TOKENS_OUTPUT_PER_RESPONSE: "cline.tokens.output.per_response",
			COST_TOTAL: "cline.cost.total",
			COST_PER_EVENT: "cline.cost.per_event",
		},
		CACHE: {
			WRITE_TOTAL: "cline.cache.write.tokens.total",
			WRITE_PER_EVENT: "cline.cache.write.tokens.per_event",
			READ_TOTAL: "cline.cache.read.tokens.total",
			READ_PER_EVENT: "cline.cache.read.tokens.per_event",
			HITS_TOTAL: "cline.cache.hits.total",
		},
		TOOLS: {
			CALLS_TOTAL: "cline.tool.calls.total",
			CALLS_PER_TASK: "cline.tool.calls.per_task",
		},
		ERRORS: {
			TOTAL: "cline.errors.total",
			PER_TASK: "cline.errors.per_task",
		},
		API: {
			TTFT_SECONDS: "cline.api.ttft.seconds",
			DURATION_SECONDS: "cline.api.duration.seconds",
			THROUGHPUT_TOKENS_PER_SECOND: "cline.api.throughput.tokens_per_second",
		},
		HOOKS: {
			EXECUTIONS_TOTAL: "cline.hooks.executions.total",
			DURATION_SECONDS: "cline.hooks.duration.seconds",
			FAILURES_TOTAL: "cline.hooks.failures.total",
			CANCELLATIONS_TOTAL: "cline.hooks.cancellations.total",
			CONTEXT_MODIFICATIONS_TOTAL: "cline.hooks.context_modifications.total",
			CACHE_ACCESSES_TOTAL: "cline.hooks.cache.accesses.total",
		},
		AI_OUTPUT: {
			ACCEPTED_LINES_ADDED: "cline.ai_output.accepted.lines_added.total",
			ACCEPTED_LINES_DELETED: "cline.ai_output.accepted.lines_deleted.total",
			ACCEPTED_LINES_CHANGED: "cline.ai_output.accepted.lines_changed.total",
			ACCEPTED_FILES_CREATED: "cline.ai_output.accepted.files_created.total",
			ACCEPTED_FILES_DELETED: "cline.ai_output.accepted.files_deleted.total",
			ACCEPTED_FILES_MOVED: "cline.ai_output.accepted.files_moved.total",
			REJECTED_LINES_ADDED: "cline.ai_output.rejected.lines_added.total",
			REJECTED_LINES_DELETED: "cline.ai_output.rejected.lines_deleted.total",
			REJECTED_LINES_CHANGED: "cline.ai_output.rejected.lines_changed.total",
			REJECTED_FILES_CREATED: "cline.ai_output.rejected.files_created.total",
			REJECTED_FILES_DELETED: "cline.ai_output.rejected.files_deleted.total",
			REJECTED_FILES_MOVED: "cline.ai_output.rejected.files_moved.total",
		},
		GRPC: {
			RESPONSE_SIZE_BYTES: "cline.grpc.response.size_bytes",
		},
		MIGRATION: {
			// Fires whenever Cline checks an old pre-SDK task and decides whether/how to migrate it.
			LEGACY_TASK_ATTEMPTS_TOTAL: "cline.migration.legacy_task.attempts.total",
			// Fires when the user opens an old task and Cline successfully copies it into SDK session storage.
			LEGACY_TASK_SUCCESS_TOTAL: "cline.migration.legacy_task.success.total",
			// Fires when Cline tried to migrate an old task but failed while building or writing the SDK session.
			LEGACY_TASK_FAILURES_TOTAL: "cline.migration.legacy_task.failures.total",
			// Fires when no migration happens because it is unnecessary or impossible, e.g. already migrated or missing old messages.
			LEGACY_TASK_SKIPPED_TOTAL: "cline.migration.legacy_task.skipped.total",
			// Fires for every migration decision; measures how long the check/migration took.
			LEGACY_TASK_DURATION_SECONDS: "cline.migration.legacy_task.duration.seconds",
			// Fires when Cline finds old conversation messages; records how many old messages were found.
			LEGACY_TASK_LEGACY_MESSAGES_COUNT: "cline.migration.legacy_task.legacy_messages.count",
			// Fires after conversion; records how many messages made it into SDK-compatible form.
			LEGACY_TASK_CONVERTED_MESSAGES_COUNT: "cline.migration.legacy_task.converted_messages.count",
			// Fires when history is listed; counts old pre-SDK tasks still waiting to be migrated.
			LEGACY_TASK_PENDING_COUNT: "cline.migration.legacy_task.pending.count",
			// Fires when history is listed; counts old tasks that already made it safely into SDK session storage.
			LEGACY_TASK_MIGRATED_COUNT: "cline.migration.legacy_task.migrated.count",
		},
	}
	// Event constants for tracking user interactions and system events
	private static readonly EVENTS = {
		// Task-related events for tracking conversation and execution flow

		USER: {
			OPT_IN: "user.opt_in",
			TELEMETRY_ENABLED: "user.telemetry_enabled",
			EXTENSION_ACTIVATED: "user.extension_activated",
			EXTENSION_STORAGE_ERROR: "user.extension_storage_error",
			AUTH_LOGGED_OUT: "user.auth_logged_out",
			ONBOARDING_PROGRESS: "user.onboarding_progress",
		},
		// Workspace-related events for multi-root support
		WORKSPACE: {
			// Track multi-root checkpoint operations
			MULTI_ROOT_CHECKPOINT: "workspace.multi_root_checkpoint",
		},
		// Organization remote-config lifecycle events
		REMOTE_CONFIG: {
			// Tracks the outcome of every remote-config refresh attempt
			REFRESH: "remote_config.refresh",
			// Tracks the session-start policy gate decision
			SESSION_GATE: "remote_config.session_gate",
		},
		TASK: {
			// Tracks user feedback on completed tasks
			FEEDBACK: "task.feedback",
			// Tracks when users select an option from AI-generated followup questions
			OPTION_SELECTED: "task.option_selected",
			// Tracks when users type a custom response instead of selecting an option from AI-generated followup questions
			OPTIONS_IGNORED: "task.options_ignored",
			// Tracks checkpoint lifecycle actions.
			CHECKPOINT_USED: "task.checkpoint_used",
			// Tracks when MCP tools are used
			MCP_TOOL_CALLED: "task.mcp_tool_called",
			// Tracks legacy VS Code task history migration into SDK sessions
			LEGACY_TASK_MIGRATION: "task.legacy_task_migration",
			// Tracks when the browser tool is started
			BROWSER_TOOL_START: "task.browser_tool_start",
			// Tracks when the browser tool is completed
			BROWSER_TOOL_END: "task.browser_tool_end",
			// Tracks when browser errors occur
			BROWSER_ERROR: "task.browser_error",
			// Tracks when API providers return errors
			PROVIDER_API_ERROR: "task.provider_api_error",
			// Tracks when users enable the focus chain feature
			FOCUS_CHAIN_ENABLED: "task.focus_chain_enabled",
			// Tracks when users disable the focus chain feature
			FOCUS_CHAIN_DISABLED: "task.focus_chain_disabled",
			// Tracks when the first focus chain return is returned by the model
			FOCUS_CHAIN_PROGRESS_FIRST: "task.focus_chain_progress_first",
			// Tracks when subsequent focus chain list returns are returned
			FOCUS_CHAIN_PROGRESS_UPDATE: "task.focus_chain_progress_update",
			// Tracks the statusn of the focus chain list when the task reaches a task completion state
			FOCUS_CHAIN_INCOMPLETE_ON_COMPLETION: "task.focus_chain_incomplete_on_completion",
			// Tracks when users click to open the focus chain markdfown file
			FOCUS_CHAIN_LIST_OPENED: "task.focus_chain_list_opened",
			// Tracks when users save and write to the focus chain markdown file
			FOCUS_CHAIN_LIST_WRITTEN: "task.focus_chain_list_written",
			// Tracks when slash commands or workflows are activated
			SLASH_COMMAND_USED: "task.slash_command_used",
			// Tracks when a feature is toggled on/off
			FEATURE_TOGGLED: "task.feature_toggled",
			// Tracks when individual Cline rules are toggled on/off
			RULE_TOGGLED: "task.rule_toggled",
			// Tracks when auto condense setting is toggled on/off
			AUTO_CONDENSE_TOGGLED: "task.auto_condense_toggled",
			// Tracks task initialization timing
			INITIALIZATION: "task.initialization",
			// Terminal execution telemetry events
			TERMINAL_EXECUTION: "task.terminal_execution",
			TERMINAL_OUTPUT_FAILURE: "task.terminal_output_failure",
			TERMINAL_USER_INTERVENTION: "task.terminal_user_intervention",
			TERMINAL_HANG: "task.terminal_hang",
			// Mention telemetry events
			MENTION_USED: "task.mention_used",
			MENTION_FAILED: "task.mention_failed",
			MENTION_SEARCH_RESULTS: "task.mention_search_results",
			// Multi-workspace search pattern tracking
			WORKSPACE_SEARCH_PATTERN: "task.workspace_search_pattern",
			// CLI Subagents telemetry events
			SUBAGENT_ENABLED: "task.subagent_enabled",
			SUBAGENT_DISABLED: "task.subagent_disabled",
		},
		// UI interaction events for tracking user engagement
		UI: {
			// Tracks when users use the "favorite" button in the model picker
			MODEL_FAVORITE_TOGGLED: "ui.model_favorite_toggled",
			// Tracks when a button is clicked
			BUTTON_CLICKED: "ui.button_clicked",
			// Tracks when the Cline panel becomes visible
			PANEL_OPENED: "ui.panel_opened",
			// Tracks when the user explicitly starts a new task flow
			NEW_TASK_CLICKED: "ui.new_task_clicked",
			// Tracks when the user submits chat composer content
			PROMPT_SUBMITTED: "ui.prompt_submitted",
		},
		// Hooks-related events for tracking hook execution
		HOOKS: {
			// Tracks when hook discovery completes
			DISCOVERY_COMPLETED: "hooks.discovery_completed",
		},
		// Worktree-related events for tracking worktree feature usage
		WORKTREE: {
			// Tracks when user opens worktrees view from home page
			VIEW_OPENED: "worktree.view_opened",
			// Tracks when a worktree is created
			CREATED: "worktree.created",
			// Tracks when a worktree merge is attempted
			MERGE_ATTEMPTED: "worktree.merge_attempted",
		},
	}

	public static async create(): Promise<TelemetryService> {
		const providers = await TelemetryProviderFactory.createProviders()
		const hostVersion = await HostProvider.env.getHostVersion({})
		const metadata: TelemetryMetadata = {
			extension_version: extensionVersion,
			...(hostVersion.clineVersion ? { host_plugin_version: hostVersion.clineVersion } : {}),
			platform: hostVersion.platform || "unknown",
			platform_version: hostVersion.version || "unknown",
			cline_type: hostVersion.clineType || "unknown",
			os_type: os.platform(),
			os_version: os.version(),
			// `remoteName` is normalized by the host bridge to `undefined` for local workspaces.
			is_remote_workspace: !!hostVersion.remoteName,
			is_dev: process.env.IS_DEV,
			...getRolloutTelemetryMetadata(),
		}
		return new TelemetryService(providers, metadata)
	}

	/**
	 * Constructor that accepts multiple telemetry providers for dual tracking
	 * @param providers Array of telemetry providers for dual/multi tracking
	 */
	constructor(
		private providers: ITelemetryProvider[],
		private telemetryMetadata: TelemetryMetadata,
	) {
		this.capture({ event: TelemetryService.EVENTS.USER.TELEMETRY_ENABLED })
		Logger.info(`[TelemetryService] Initialized with ${providers.length} telemetry provider(s)`)
	}

	public addProvider(provider: ITelemetryProvider) {
		this.providers.push(provider)
	}

	public removeProvider(name: string) {
		this.providers = this.providers.filter((p) => p.name !== name)
	}

	/**
	 * Updates the telemetry state based on user preferences and VSCode settings
	 * Only enables telemetry if both VSCode global telemetry is enabled and user has opted in
	 * @param didUserOptIn Whether the user has explicitly opted into telemetry
	 */
	public async updateTelemetryState(didUserOptIn: boolean): Promise<void> {
		// First check global telemetry level - telemetry should only be enabled when level is "all"

		// We only enable telemetry if global host telemetry is enabled
		const hostSetting = await HostProvider.env.getTelemetrySettings({})
		if (hostSetting.isEnabled === Setting.DISABLED) {
			// Only show warning if user has opted in to Cline telemetry but host telemetry is disabled
			if (didUserOptIn) {
				void HostProvider.window
					.showMessage({
						type: ShowMessageType.WARNING,
						message:
							"Anonymous Cline error and usage reporting is enabled, but IDE telemetry is disabled. To enable error and usage reporting for this extension, enable telemetry in IDE settings.",
						options: {
							items: ["Open Settings"],
						},
					})
					.then((response: { selectedOption?: string }) => {
						if (response.selectedOption === "Open Settings") {
							void HostProvider.window.openSettings({
								query: "telemetry.telemetryLevel",
							})
						}
					})
			}
		}
	}

	/**
	 * NOTE — SDK-line telemetry parity gap. This method and several others in
	 * this file have no caller on this line but are called on
	 * `legacy-extension`. They are kept, not deleted: the signals they emit
	 * originate in this bundle (webview UI, VS Code storage, host terminal,
	 * checkpoints, focus chain, legacy-task migration), so @cline/core cannot
	 * emit them and the missing piece is a call site here. Tracked in
	 * https://linear.app/cline-bot/issue/ENG-2401
	 *
	 * Anything whose event @cline/core already emits was deleted instead: a
	 * second capture path for a core-owned event is how the
	 * task.provider_api_error double-emission happened (cline/cline#12820).
	 *
	 * So: do not "clean up" an uncalled capture method here as dead code
	 * without checking `legacy-extension` for callers first.
	 */

	/**
	 * Captures when a user explicitly opts back into telemetry.
	 * Should only be called on explicit user action, not on init/sync.
	 */
	public captureUserOptIn(): void {
		this.capture({ event: TelemetryService.EVENTS.USER.OPT_IN })
	}

	/**
	 * Captures a telemetry event if telemetry is enabled
	 * @param event The event to capture with its properties
	 */
	public capture(event: { event: string; properties?: TelemetryProperties }): void {
		const propertiesWithMetadata: TelemetryProperties = {
			...(event.properties || {}),
			...this.telemetryMetadata,
			...this.getDeviceIdProperty(),
		}
		this.captureToProviders(event.event, propertiesWithMetadata, false)
	}

	/**
	 * Captures a required telemetry event that bypasses user opt-out settings
	 * @param event The event name to capture
	 * @param properties Optional properties to attach to the event
	 */
	public captureRequired(event: string, properties?: TelemetryProperties): void {
		const propertiesWithMetadata: TelemetryProperties = {
			...(properties || {}),
			...this.telemetryMetadata,
			...this.getDeviceIdProperty(),
		}
		this.captureToProviders(event, propertiesWithMetadata, true)
	}

	/**
	 * Internal method to capture events to all providers with error isolation
	 * @param event The event name
	 * @param properties Event properties (must be JSON-serializable)
	 * @param required Whether this is a required event
	 */
	private captureToProviders(event: string, properties: TelemetryProperties, required: boolean): void {
		this.providers.forEach((provider) => {
			try {
				if (required) {
					provider.logRequired(event, properties)
				} else {
					provider.log(event, properties)
				}
			} catch (error) {
				Logger.error(`[TelemetryService] Provider failed for event ${event}:`, error)
			}
		})
	}

	private getStandardAttributes(extra?: TelemetryProperties): TelemetryProperties {
		return {
			...this.telemetryMetadata,
			...this.getDeviceIdProperty(),
			...(this.userId ? { userId: this.userId } : {}),
			...this.activeOrg,
			...(extra ?? {}),
		}
	}

	private getDeviceIdProperty(): TelemetryProperties {
		const deviceId = getDeviceId()
		return deviceId ? { device_id: deviceId } : {}
	}

	private recordCounter(
		name: string,
		value: number,
		attributes?: TelemetryProperties,
		description?: string,
		required = false,
	): void {
		const attrs = this.getStandardAttributes(attributes)
		this.providers.forEach((provider) => {
			try {
				provider.recordCounter(name, value, attrs, description, required)
			} catch (error) {
				Logger.error(`[TelemetryService] recordCounter failed: ${name}`, error)
			}
		})
	}

	private recordHistogram(
		name: string,
		value: number,
		attributes?: TelemetryProperties,
		description?: string,
		required = false,
	): void {
		const attrs = this.getStandardAttributes(attributes)
		this.providers.forEach((provider) => {
			try {
				provider.recordHistogram(name, value, attrs, description, required)
			} catch (error) {
				Logger.error(`[TelemetryService] recordHistogram failed: ${name}`, error)
			}
		})
	}

	/**
	 * Gauge values require explicit cleanup: callers must pass null with the same attribute set
	 * when the series identified by name+attributes ends to prevent stale metric entries.
	 */
	private recordGauge(
		name: string,
		value: number | null,
		attributes?: TelemetryProperties,
		description?: string,
		required = false,
	): void {
		const attrs = this.getStandardAttributes(attributes)
		this.providers.forEach((provider) => {
			try {
				provider.recordGauge(name, value, attrs, description, required)
			} catch (error) {
				Logger.error(`[TelemetryService] recordGauge failed: ${name}`, error)
			}
		})
	}

	private incrementTaskCounter(store: Map<string, number>, ulid: string): number {
		const nextValue = (store.get(ulid) ?? 0) + 1
		store.set(ulid, nextValue)
		return nextValue
	}

	private resetTaskAggregates(ulid: string): void {
		this.taskErrorCounts.delete(ulid)
	}

	public captureExtensionActivated() {
		this.capture({
			event: TelemetryService.EVENTS.USER.EXTENSION_ACTIVATED,
		})
	}

	public captureRolloutBundleActivated(input: RolloutBundleActivation): void {
		if (!this.telemetryMetadata.extension_variant) {
			return
		}

		this.capture({
			event: ROLLOUT_BUNDLE_ACTIVATED_EVENT,
			properties: {
				attempted_bundle: input.attemptedBundle,
				actual_bundle: input.actualBundle,
				fallback: input.fallback,
				...(input.fallback ? getRolloutErrorProperties(input.error) : {}),
			},
		})
	}

	/**
	 * Volume guard for the remote-config events: they fire on every session
	 * start and refresh for ALL users, but the signal is managed-org behavior
	 * and failures. The unmanaged happy path ("nothing to enforce, allowed")
	 * would dominate event volume with no informational value, so it is dropped.
	 */
	private static shouldCaptureRemoteConfigEvent(managed: boolean, outcome: string): boolean {
		return managed || outcome === "failed" || outcome === "blocked" || outcome === "last_known_good"
	}

	public captureRemoteConfigRefresh(input: {
		outcome: "applied" | "cleared" | "failed" | "superseded"
		durationMs: number
		managed: boolean
		configVersion?: string
	}): void {
		if (!TelemetryService.shouldCaptureRemoteConfigEvent(input.managed, input.outcome)) {
			return
		}
		this.capture({
			event: TelemetryService.EVENTS.REMOTE_CONFIG.REFRESH,
			properties: {
				outcome: input.outcome,
				duration_ms: Math.max(0, Math.round(input.durationMs)),
				managed: input.managed,
				...(input.configVersion ? { config_version: input.configVersion.slice(0, 100) } : {}),
			},
		})
	}

	public captureRemoteConfigSessionGate(input: {
		outcome: "refreshed" | "last_known_good" | "unmanaged" | "blocked"
		durationMs: number
		managed: boolean
	}): void {
		if (!TelemetryService.shouldCaptureRemoteConfigEvent(input.managed, input.outcome)) {
			return
		}
		this.capture({
			event: TelemetryService.EVENTS.REMOTE_CONFIG.SESSION_GATE,
			properties: {
				outcome: input.outcome,
				duration_ms: Math.max(0, Math.round(input.durationMs)),
				managed: input.managed,
			},
		})
	}

	public captureExtensionStorageError(errorMessage: string, eventName: string) {
		// Truncate error message to prevent excessive data
		this.capture({
			event: TelemetryService.EVENTS.USER.EXTENSION_STORAGE_ERROR,
			properties: {
				error:
					errorMessage.length > MAX_ERROR_MESSAGE_LENGTH
						? errorMessage.substring(0, MAX_ERROR_MESSAGE_LENGTH) + "..."
						: errorMessage,
				eventName,
			},
		})
	}

	/**
	 * Records when user logs out of their account
	 * @param provider The authentication provider that was used
	 * @param reason The reason for logout (user action, cross-window sync, error, etc.)
	 */
	public captureAuthLoggedOut(provider?: string, reason?: string) {
		this.capture({
			event: TelemetryService.EVENTS.USER.AUTH_LOGGED_OUT,
			properties: {
				provider,
				reason,
			},
		})
	}

	/**
	 * Identifies the accounts user
	 * @param userInfo The user's information
	 */
	public identifyAccount(userInfo: ClineAccountUserInfo) {
		const propertiesWithMetadata: TelemetryProperties = {
			...this.telemetryMetadata,
		}

		this.userId = userInfo.id
		const activeOrg = userInfo.organizations?.find((org) => org.active)
		if (activeOrg) {
			this.activeOrg = {
				organization_id: activeOrg.organizationId,
				organization_name: activeOrg.name,
				member_id: activeOrg.memberId,
			}
		} else {
			this.activeOrg = null
		}
		// Update all providers with error isolation
		this.providers.forEach((provider) => {
			try {
				provider.identifyUser(userInfo, propertiesWithMetadata)
			} catch (error) {
				Logger.error(`[TelemetryService] Provider failed for user identification:`, error)
			}
		})

		if (userInfo.id) {
			setDistinctId(userInfo.id)
		}
	}

	// Task events
	/**
	 * Records user feedback on completed tasks
	 * @param ulid Unique identifier for the task
	 * @param feedbackType The type of feedback ("thumbs_up" or "thumbs_down")
	 */
	public captureTaskFeedback(ulid: string, feedbackType: TaskFeedbackType) {
		Logger.info("TelemetryService: Capturing task feedback", {
			ulid,
			feedbackType,
		})
		this.capture({
			event: TelemetryService.EVENTS.TASK.FEEDBACK,
			properties: {
				ulid,
				feedbackType,
			},
		})
		this.resetTaskAggregates(ulid)
	}

	// Tool events
	/**
	 * Records when an MCP tool is called.
	 * This telemetry event is designed to monitor the usage and performance of MCP tools
	 * without compromising user privacy. It captures the tool's metadata (server, name, and arguments)
	 * but explicitly avoids logging the values of the arguments.
	 *
	 * @param ulid Unique identifier for the task.
	 * @param serverName The name of the MCP server.
	 * @param toolName The name of the tool being called.
	 * @param status The status of the tool call.
	 * @param errorMessage Optional error message if the call failed.
	 * @param argumentKeys Optional array of argument keys for the tool.
	 */
	public captureMcpToolCall(
		ulid: string,
		serverName: string,
		toolName: string,
		status: "started" | "success" | "error",
		errorMessage?: string,
		argumentKeys?: string[],
		isNativeToolCall = false,
	) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.MCP_TOOL_CALLED,
			properties: {
				ulid,
				serverName,
				toolName,
				status,
				errorMessage,
				argumentKeys,
				isNativeToolCall,
			},
		})
	}

	/**
	 * Records checkpoint interactions.
	 * @param ulid Unique identifier for the task
	 * @param action The type of checkpoint action
	 * @param durationMs Optional duration of the operation in milliseconds
	 */
	public captureCheckpointUsage(ulid: string, action: "created" | "restored", durationMs?: number) {
		if (!this.isCategoryEnabled("checkpoints")) {
			return
		}

		this.capture({
			event: TelemetryService.EVENTS.TASK.CHECKPOINT_USED,
			properties: {
				ulid,
				action,
				durationMs,
			},
		})
	}

	/**
	 * Records when the browser tool is started
	 * @param ulid Unique identifier for the task
	 * @param browserSettings The browser settings being used
	 */
	public captureBrowserToolStart(ulid: string, browserSettings: BrowserSettings) {
		if (!this.isCategoryEnabled("browser")) {
			return
		}

		this.capture({
			event: TelemetryService.EVENTS.TASK.BROWSER_TOOL_START,
			properties: {
				ulid,
				viewport: browserSettings.viewport,
				isRemote: !!browserSettings.remoteBrowserEnabled,
				remoteBrowserHost: browserSettings.remoteBrowserHost,
				timestamp: new Date().toISOString(),
			},
		})
	}

	/**
	 * Records when the browser tool is completed
	 * @param ulid Unique identifier for the task
	 * @param stats Statistics about the browser session
	 */
	public captureBrowserToolEnd(
		ulid: string,
		stats: {
			actionCount: number
			duration: number
			actions?: string[]
		},
	) {
		if (!this.isCategoryEnabled("browser")) {
			return
		}

		this.capture({
			event: TelemetryService.EVENTS.TASK.BROWSER_TOOL_END,
			properties: {
				ulid,
				actionCount: stats.actionCount,
				duration: stats.duration,
				actions: stats.actions,
				timestamp: new Date().toISOString(),
			},
		})
	}

	/**
	 * Records when browser errors occur during a task
	 * @param ulid Unique identifier for the task
	 * @param errorType Type of error that occurred (e.g., "launch_error", "connection_error", "navigation_error")
	 * @param errorMessage The error message
	 * @param context Additional context about where the error occurred
	 */
	public captureBrowserError(
		ulid: string,
		errorType: string,
		errorMessage: string,
		context?: {
			action?: string
			url?: string
			isRemote?: boolean
			remoteBrowserHost?: string
			endpoint?: string
		},
	) {
		if (!this.isCategoryEnabled("browser")) {
			return
		}

		this.capture({
			event: TelemetryService.EVENTS.TASK.BROWSER_ERROR,
			properties: {
				ulid,
				errorType,
				errorMessage,
				...(context && { context }),
				timestamp: new Date().toISOString(),
			},
		})
	}

	/**
	 * Records when a user selects an option from AI-generated followup questions
	 * @param ulid Unique identifier for the task
	 * @param qty The quantity of options that were presented
	 * @param mode The mode in which the option was selected ("plan" or "act")
	 */
	public captureOptionSelected(ulid: string, qty: number, mode: Mode) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.OPTION_SELECTED,
			properties: {
				ulid,
				qty,
				mode,
			},
		})
	}

	/**
	 * Records when a user types a custom response instead of selecting one of the AI-generated followup questions
	 * @param ulid Unique identifier for the task
	 * @param qty The quantity of options that were presented
	 * @param mode The mode in which the custom response was provided ("plan" or "act")
	 */
	public captureOptionsIgnored(ulid: string, qty: number, mode: Mode) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.OPTIONS_IGNORED,
			properties: {
				ulid,
				qty,
				mode,
			},
		})
	}

	/**
	 * Records when the user uses the model favorite button in the model picker
	 * @param model The name of the model the user has interacted with
	 * @param isFavorited Whether the model is being favorited (true) or unfavorited (false)
	 */
	public captureModelFavoritesUsage(model: string, isFavorited: boolean) {
		this.capture({
			event: TelemetryService.EVENTS.UI.MODEL_FAVORITE_TOGGLED,
			properties: {
				model,
				isFavorited,
			},
		})
	}

	public captureButtonClick(button: string, ulid?: string) {
		this.capture({
			event: TelemetryService.EVENTS.UI.BUTTON_CLICKED,
			properties: {
				button,
				ulid,
			},
		})
	}

	public capturePanelOpened(source?: string) {
		this.capture({
			event: TelemetryService.EVENTS.UI.PANEL_OPENED,
			properties: { source },
		})
	}

	public captureNewTaskClicked(source?: string, hasActiveTask?: boolean) {
		this.capture({
			event: TelemetryService.EVENTS.UI.NEW_TASK_CLICKED,
			properties: { source, hasActiveTask },
		})
	}

	public capturePromptSubmitted(args: {
		source?: string
		hasText?: boolean
		hasImages?: boolean
		hasFiles?: boolean
		hasActiveTask?: boolean
		textLength?: number
	}) {
		this.capture({
			event: TelemetryService.EVENTS.UI.PROMPT_SUBMITTED,
			properties: args,
		})
	}

	/**
	 * Records telemetry when an API provider returns an error
	 * @param ulid Unique identifier for the task
	 * @param model Identifier of the model used
	 * @param requestId Unique identifier for the specific API request
	 * @param errorMessage Detailed error message from the API provider
	 * @param errorStatus HTTP status code of the error response, if available
	 * @param collect Optional flag to determine if the event should be collected for batch sending
	 */
	public captureProviderApiError(args: {
		ulid: string
		model: string
		errorMessage: string
		provider?: string
		errorStatus?: number | undefined
		requestId?: string | undefined
		errorType?: string | undefined
		failurePhase?: string | undefined
		isNativeToolCall?: boolean
	}) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.PROVIDER_API_ERROR,
			properties: {
				...args,
				errorMessage: args.errorMessage.substring(0, MAX_ERROR_MESSAGE_LENGTH), // Truncate long error messages
				timestamp: new Date().toISOString(),
			},
		})

		this.recordCounter(TelemetryService.METRICS.ERRORS.TOTAL, 1, {
			ulid: args.ulid,
			model: args.model,
			provider: args.provider,
			error_status: args.errorStatus,
			error_type: args.errorType,
			failure_phase: args.failurePhase,
		})
		const errorAttributes = {
			ulid: args.ulid,
			model: args.model,
			provider: args.provider,
			error_status: args.errorStatus,
			error_type: args.errorType,
			failure_phase: args.failurePhase,
		}
		const errorCount = this.incrementTaskCounter(this.taskErrorCounts, args.ulid)
		this.recordHistogram(TelemetryService.METRICS.ERRORS.PER_TASK, errorCount, errorAttributes)
	}

	/**
	 * Records when focus chain is enabled/disabled by the user
	 * @param enabled Whether focus chain was enabled (true) or disabled (false)
	 */
	public captureFocusChainToggle(enabled: boolean) {
		if (!this.isCategoryEnabled("focus_chain")) {
			return
		}

		this.capture({
			event: enabled ? TelemetryService.EVENTS.TASK.FOCUS_CHAIN_ENABLED : TelemetryService.EVENTS.TASK.FOCUS_CHAIN_DISABLED,
			properties: {
				enabled,
			},
		})
	}

	/**
	 * Records when a task progress list is returned by the model for the first time in a task
	 * @param ulid Unique identifier for the task
	 * @param totalItems Number of items in the initial focus chain list
	 */
	public captureFocusChainProgressFirst(ulid: string, totalItems: number) {
		if (!this.isCategoryEnabled("focus_chain")) {
			return
		}

		this.capture({
			event: TelemetryService.EVENTS.TASK.FOCUS_CHAIN_PROGRESS_FIRST,
			properties: {
				ulid,
				totalItems,
			},
		})
	}

	/**
	 * Records when a task progress list is updated by the model mid-task
	 * @param ulid Unique identifier for the task
	 * @param totalItems Total number of items in the focus chain list
	 * @param completedItems Number of completed items in the focus chain list
	 */
	public captureFocusChainProgressUpdate(ulid: string, totalItems: number, completedItems: number) {
		if (!this.isCategoryEnabled("focus_chain")) {
			return
		}

		this.capture({
			event: TelemetryService.EVENTS.TASK.FOCUS_CHAIN_PROGRESS_UPDATE,
			properties: {
				ulid,
				totalItems,
				completedItems,
				completionPercentage: totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0,
			},
		})
	}

	/**
	 * Records when a task ends but the task progress list is not complete
	 * @param ulid Unique identifier for the task
	 * @param totalItems Total number of items in the focus chain list
	 * @param completedItems Number of completed items
	 * @param incompleteItems Number of incomplete items
	 * @param modelId The model ID being used
	 * @param provider The API provider being used
	 */
	public captureFocusChainIncompleteOnCompletion(
		ulid: string,
		totalItems: number,
		completedItems: number,
		incompleteItems: number,
		modelId: string,
		provider: string,
	) {
		if (!this.isCategoryEnabled("focus_chain")) {
			return
		}

		this.capture({
			event: TelemetryService.EVENTS.TASK.FOCUS_CHAIN_INCOMPLETE_ON_COMPLETION,
			properties: {
				ulid,
				totalItems,
				completedItems,
				incompleteItems,
				completionPercentage: totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0,
				modelId,
				provider,
			},
		})
	}

	/**
	 * Records when users click to open the focus chain markdown file
	 * @param ulid Unique identifier for the task
	 */
	public captureFocusChainListOpened(ulid: string) {
		if (!this.isCategoryEnabled("focus_chain")) {
			return
		}

		this.capture({
			event: TelemetryService.EVENTS.TASK.FOCUS_CHAIN_LIST_OPENED,
			properties: {
				ulid,
			},
		})
	}

	/**
	 * Records when users save and write to the focus chain markdown file
	 * @param ulid Unique identifier for the task
	 */
	public captureFocusChainListWritten(ulid: string) {
		if (!this.isCategoryEnabled("focus_chain")) {
			return
		}

		this.capture({
			event: TelemetryService.EVENTS.TASK.FOCUS_CHAIN_LIST_WRITTEN,
			properties: {
				ulid,
			},
		})
	}

	/**
	 * Records when slash commands or workflows are activated
	 * @param ulid Unique identifier for the task
	 * @param commandName The name of the command (e.g., "newtask", "reportbug", or custom workflow name)
	 * @param commandType Whether it's a built-in command, custom workflow, or MCP prompt
	 */
	public captureSlashCommandUsed(ulid: string, commandName: string, commandType: "builtin" | "workflow" | "mcp_prompt") {
		this.capture({
			event: TelemetryService.EVENTS.TASK.SLASH_COMMAND_USED,
			properties: {
				ulid,
				commandName,
				commandType,
			},
		})
	}

	/**
	 * Records when a feature is enabled/disabled by the user
	 * @param ulid Unique identifier for the task
	 * @param featureName The name of the feature being toggled
	 * @param enabled Whether the feature was enabled (true) or disabled (false)
	 * @param modelId The model ID being used when the toggle occurred
	 */
	public captureFeatureToggle(ulid: string, featureName: string, enabled: boolean, modelId: string) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.FEATURE_TOGGLED,
			properties: {
				ulid,
				featureName,
				enabled,
				modelId,
			},
		})
	}

	/**
	 * Records when individual Cline rules are toggled on/off
	 * @param ulid Unique identifier for the task (to track rule changes within task context)
	 * @param ruleFileName The filename of the rule (sanitized to exclude full path)
	 * @param enabled Whether the rule is being enabled (true) or disabled (false)
	 * @param isGlobal Whether this is a global rule or workspace-specific rule
	 */
	public captureClineRuleToggled(ulid: string, ruleFileName: string, enabled: boolean, isGlobal: boolean) {
		// Sanitize filename to remove any path information for privacy
		const sanitizedFileName = ruleFileName.split("/").pop() || ruleFileName.split("\\").pop() || ruleFileName

		this.capture({
			event: TelemetryService.EVENTS.TASK.RULE_TOGGLED,
			properties: {
				ulid,
				ruleFileName: sanitizedFileName,
				enabled,
				isGlobal,
			},
		})
	}

	/**
	 * Records when auto condense is enabled/disabled by the user
	 * @param ulid Unique identifier for the task
	 * @param enabled Whether auto condense was enabled (true) or disabled (false)
	 * @param modelId The model ID being used when the toggle occurred
	 */
	public captureAutoCondenseToggle(ulid: string, enabled: boolean, modelId: string) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.AUTO_CONDENSE_TOGGLED,
			properties: {
				ulid,
				enabled,
				modelId,
			},
		})
	}

	/**
	 * Records task initialization timing and metadata
	 * @param ulid Unique identifier for the task
	 * @param taskId Task ID (timestamp in milliseconds when task was created)
	 * @param durationMs Duration of initialization in milliseconds
	 * @param hasCheckpoints Whether checkpoints are enabled for this task
	 */
	public captureTaskInitialization(ulid: string, taskId: string, durationMs: number, hasCheckpoints: boolean) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.INITIALIZATION,
			properties: {
				ulid,
				taskId,
				durationMs,
				hasCheckpoints,
			},
		})
	}

	// Terminal telemetry methods

	/**
	 * Records terminal command execution outcomes for VSCode terminal
	 * @param success Whether the command output was successfully captured
	 * @param terminalType The type of terminal ("vscode")
	 * @param method The VSCode-specific method used to capture output
	 * @param details Optional dimensions:
	 *   exitCode — the process exit code, when captured (via
	 *   onDidEndTerminalShellExecution, the OSC 633;D marker, or child_process);
	 *   terminalExecutionMode — foreground ("vscodeTerminal") or background
	 *   ("backgroundExec");
	 *   markerlessCause — for method "markerless_heuristic", why the command was
	 *   considered complete;
	 *   terminalClosed — the terminal was closed while the command was running
	 */
	public captureTerminalExecution(
		success: boolean,
		terminalType: "vscode",
		method: VscodeOutputMethod,
		details?: {
			exitCode?: number | null
			terminalExecutionMode?: "vscodeTerminal" | "backgroundExec"
			markerlessCause?: MarkerlessCompletionCause
			terminalClosed?: boolean
		},
	): void
	/**
	 * Records terminal command execution outcomes for standalone terminal
	 * @param success Whether the command output was successfully captured
	 * @param terminalType The type of terminal ("standalone")
	 * @param method The standalone-specific method used to capture output
	 * @param details Optional dimensions: exitCode — the process exit code (useful for
	 * diagnosing failure types: 1=error, 127=not found, 126=permission denied)
	 */
	public captureTerminalExecution(
		success: boolean,
		terminalType: "standalone",
		method: StandaloneOutputMethod,
		details?: { exitCode?: number | null },
	): void
	/**
	 * Implementation of captureTerminalExecution
	 */
	public captureTerminalExecution(
		success: boolean,
		terminalType: TerminalType,
		method: TerminalOutputMethod,
		details?: {
			exitCode?: number | null
			terminalExecutionMode?: "vscodeTerminal" | "backgroundExec"
			markerlessCause?: MarkerlessCompletionCause
			terminalClosed?: boolean
		},
	): void {
		const { exitCode, terminalExecutionMode, markerlessCause, terminalClosed } = details ?? {}
		this.capture({
			event: TelemetryService.EVENTS.TASK.TERMINAL_EXECUTION,
			properties: {
				success,
				terminalType,
				method,
				// Only include exitCode when it's a meaningful value.
				...(exitCode !== undefined && exitCode !== null && { exitCode }),
				...(terminalExecutionMode !== undefined && { terminalExecutionMode }),
				...(markerlessCause !== undefined && { markerlessCause }),
				...(terminalClosed !== undefined && { terminalClosed }),
			},
		})
	}

	/**
	 * Records when terminal output capture fails
	 * @param reason The reason for failure
	 * @param terminalType The type of terminal (defaults to "vscode" for backward compatibility)
	 */
	public captureTerminalOutputFailure(reason: TerminalOutputFailureReason, terminalType: TerminalType = "vscode") {
		this.capture({
			event: TelemetryService.EVENTS.TASK.TERMINAL_OUTPUT_FAILURE,
			properties: {
				reason,
				terminalType,
			},
		})
	}

	/**
	 * Records when user has to intervene with terminal execution
	 * @param action The user action
	 * @param terminalType The type of terminal (defaults to "vscode" for backward compatibility)
	 */
	public captureTerminalUserIntervention(action: TerminalUserInterventionAction, terminalType: TerminalType = "vscode") {
		this.capture({
			event: TelemetryService.EVENTS.TASK.TERMINAL_USER_INTERVENTION,
			properties: {
				action,
				terminalType,
			},
		})
	}

	/**
	 * Records when terminal execution hangs or gets stuck
	 * @param stage Where the hang occurred
	 * @param terminalType The type of terminal (defaults to "vscode" for backward compatibility)
	 */
	public captureTerminalHang(stage: TerminalHangStage, terminalType: TerminalType = "vscode") {
		this.capture({
			event: TelemetryService.EVENTS.TASK.TERMINAL_HANG,
			properties: {
				stage,
				terminalType,
			},
		})
	}

	// Workspace telemetry methods

	/**
	 * Records multi-root checkpoint operations
	 * @param ulid Task identifier
	 * @param action Type of checkpoint action
	 * @param rootCount Number of roots being checkpointed
	 * @param successCount Number of successful checkpoints
	 * @param failureCount Number of failed checkpoints
	 * @param durationMs Total operation duration in milliseconds
	 */
	public captureMultiRootCheckpoint(
		ulid: string,
		action: "initialized" | "committed" | "restored",
		rootCount: number,
		successCount: number,
		failureCount: number,
		durationMs?: number,
	) {
		this.capture({
			event: TelemetryService.EVENTS.WORKSPACE.MULTI_ROOT_CHECKPOINT,
			properties: {
				ulid,
				action,
				root_count: rootCount,
				success_count: successCount,
				failure_count: failureCount,
				success_rate: rootCount > 0 ? successCount / rootCount : 0,
				duration_ms: durationMs,
			},
		})
	}

	/**
	 * Records multi-workspace search patterns and performance
	 * @param ulid Unique identifier for the task
	 * @param searchType Type of search performed
	 * @param workspaceCount Number of workspaces searched
	 * @param hintProvided Whether a workspace hint was provided
	 * @param resultsFound Whether search results were found
	 * @param searchDurationMs Optional search duration in milliseconds
	 */
	public captureWorkspaceSearchPattern(
		ulid: string,
		searchType: "targeted" | "cross_workspace" | "primary_only",
		workspaceCount: number,
		hintProvided: boolean,
		resultsFound: boolean,
		searchDurationMs?: number,
	) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.WORKSPACE_SEARCH_PATTERN,
			properties: {
				ulid,
				search_type: searchType,
				workspace_count: workspaceCount,
				hint_provided: hintProvided,
				results_found: resultsFound,
				search_duration_ms: searchDurationMs,
			},
		})
	}

	/**
	 * Records when user opens the worktrees view
	 * @param source Where the user opened the view from (home_page or menu_bar)
	 */
	public captureWorktreeViewOpened(source: "home_page" | "menu_bar") {
		this.capture({
			event: TelemetryService.EVENTS.WORKTREE.VIEW_OPENED,
			properties: {
				source,
			},
		})
	}

	/**
	 * Records when a worktree is created
	 * @param success Whether the creation was successful
	 * @param worktreeCount Total number of worktrees after creation (to track power users)
	 */
	public captureWorktreeCreated(success: boolean, worktreeCount?: number) {
		this.capture({
			event: TelemetryService.EVENTS.WORKTREE.CREATED,
			properties: {
				success,
				worktree_count: worktreeCount,
			},
		})
	}

	/**
	 * Records when a worktree merge is attempted
	 * @param success Whether the merge was successful
	 * @param hasConflicts Whether merge conflicts were detected
	 * @param deleteAfterMerge Whether user chose to delete worktree after merge
	 */
	public captureWorktreeMergeAttempted(success: boolean, hasConflicts: boolean, deleteAfterMerge: boolean) {
		this.capture({
			event: TelemetryService.EVENTS.WORKTREE.MERGE_ATTEMPTED,
			properties: {
				success,
				has_conflicts: hasConflicts,
				delete_after_merge: deleteAfterMerge,
			},
		})
	}

	/**
	 * Checks if a specific telemetry category is enabled
	 * @param category The telemetry category to check
	 * @returns Boolean indicating whether the specified telemetry category is enabled
	 */
	public isCategoryEnabled(category: TelemetryCategory): boolean {
		// Default to true if category has not been explicitly configured
		return this.telemetryCategoryEnabled.get(category) ?? true
	}

	/**
	 * Get the telemetry provider instances
	 * @returns The array of telemetry providers
	 */
	public getProviders(): ITelemetryProvider[] {
		return [...this.providers]
	}

	/**
	 * Check if telemetry is currently enabled
	 * @returns Boolean indicating whether any provider is enabled
	 */
	public isEnabled(): boolean {
		return this.providers.some((provider) => provider.isEnabled())
	}

	/**
	 * Get current telemetry settings from the first provider
	 * @returns Current telemetry settings
	 */
	public getSettings() {
		return this.providers.length > 0
			? this.providers[0].getSettings()
			: {
					hostEnabled: false,
					level: "off" as const,
				}
	}

	/**
	 * Records when a mention is successfully used and content is retrieved
	 * @param mentionType Type of mention (file, folder, url, problems, terminal, git-changes, commit)
	 * @param contentLength Optional length of content retrieved (for size tracking)
	 */
	public captureMentionUsed(
		mentionType: "file" | "folder" | "url" | "problems" | "terminal" | "git-changes" | "commit",
		contentLength?: number,
	) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.MENTION_USED,
			properties: {
				mentionType,
				contentLength,
				timestamp: new Date().toISOString(),
			},
		})
	}

	/**
	 * Records when a mention fails to retrieve content or when the mention
	 * picker's file/folder search itself fails.
	 *
	 * `ripgrep_spawn_failed` and `workspace_unavailable` are picker-search
	 * failures, surfaced by the `searchFiles` controller; the others are
	 * mention-content retrieval failures.
	 *
	 * @param fsContext Optional filesystem info, emitted as `fs_class` and `fs_type`.
	 */
	public captureMentionFailed(
		mentionType: "file" | "folder" | "url" | "problems" | "terminal" | "git-changes" | "commit",
		errorType:
			| "not_found"
			| "permission_denied"
			| "network_error"
			| "parse_error"
			| "ripgrep_spawn_failed"
			| "workspace_unavailable"
			| "unknown",
		errorMessage?: string,
		fsContext?: { fsClass?: "local" | "network" | "unknown"; fsType?: string },
	) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.MENTION_FAILED,
			properties: {
				mentionType,
				errorType,
				errorMessage: errorMessage?.substring(0, MAX_ERROR_MESSAGE_LENGTH),
				...(fsContext?.fsClass ? { fs_class: fsContext.fsClass } : {}),
				...(fsContext?.fsType ? { fs_type: fsContext.fsType } : {}),
				timestamp: new Date().toISOString(),
			},
		})
	}

	/**
	 * Records search results when user searches for files/folders in mention dropdown
	 * @param query The search query entered by user
	 * @param resultCount Number of results returned
	 * @param searchType Type of search (file, folder, or all)
	 * @param isEmpty Whether the search returned no results
	 * @param fsContext Optional filesystem info, emitted as `fs_class` and `fs_type`.
	 * @param searchSource Which backend served the search: `host_index` (e.g.
	 *   JetBrains FilenameIndex) or `ripgrep` (default everywhere). Emitted as
	 *   the `search_source` property so we can tell, for a given fs_class, how
	 *   often the host index actually picks up the load.
	 */
	public captureMentionSearchResults(
		query: string,
		resultCount: number,
		searchType: "file" | "folder" | "all",
		isEmpty: boolean,
		fsContext?: { fsClass?: "local" | "network" | "unknown"; fsType?: string },
		searchSource?: "host_index" | "ripgrep",
	) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.MENTION_SEARCH_RESULTS,
			properties: {
				queryLength: query.length,
				resultCount,
				searchType,
				isEmpty,
				...(fsContext?.fsClass ? { fs_class: fsContext.fsClass } : {}),
				...(fsContext?.fsType ? { fs_type: fsContext.fsType } : {}),
				...(searchSource ? { search_source: searchSource } : {}),
				timestamp: new Date().toISOString(),
			},
		})
	}

	// CLI Subagents telemetry methods

	/**
	 * Records when CLI subagents feature is enabled/disabled by the user
	 * @param enabled Whether subagents was enabled (true) or disabled (false)
	 */
	public captureSubagentToggle(enabled: boolean) {
		if (!this.isCategoryEnabled("subagents")) {
			return
		}

		this.capture({
			event: enabled ? TelemetryService.EVENTS.TASK.SUBAGENT_ENABLED : TelemetryService.EVENTS.TASK.SUBAGENT_DISABLED,
			properties: {
				enabled,
				timestamp: new Date().toISOString(),
			},
		})
	}

	public captureOnboardingProgress(args: {
		step: number
		action?: string
		page?: string
		pageVariant?: string
		userType?: string
		selectedModelId?: string
		destinationStep?: number
		destinationPage?: string
		completed?: boolean
	}) {
		this.capture({
			event: TelemetryService.EVENTS.USER.ONBOARDING_PROGRESS,
			properties: {
				...args,
			},
		})
	}

	// Hooks telemetry methods

	/**
	 * Records hook discovery cache access (hit or miss)
	 * @param hookName The type of hook being accessed
	 * @param cacheHit Whether the cache had the result (true) or miss (false)
	 */
	public captureHookCacheAccess(hookName: string, cacheHit: boolean) {
		if (!this.isCategoryEnabled("hooks")) {
			return
		}

		// Record cache access counter with hit/miss attribute
		// This allows deriving hit rate: hits / (hits + misses)
		this.recordCounter(TelemetryService.METRICS.HOOKS.CACHE_ACCESSES_TOTAL, 1, {
			hookName,
			cacheHit: cacheHit.toString(),
		})
	}

	// Simplified Hook Telemetry API (following MCP pattern)

	/**
	 * Records hook execution events with a unified status-based approach.
	 * This is the simplified API that consolidates multiple hook execution methods.
	 *
	 * @param ulid Task identifier
	 * @param hookName Type of hook (PreToolUse, PostToolUse, etc.)
	 * @param status Current execution status
	 * @param metadata Optional execution metadata
	 */
	public captureHookExecution(
		ulid: string,
		hookName: string,
		status: "started" | "completed" | "failed" | "cancelled",
		metadata?: {
			source?: "global" | "workspace"
			toolName?: string
			durationMs?: number
			exitCode?: number
			errorType?: "timeout" | "execution" | "validation"
			errorMessage?: string
			cancelRequested?: boolean
			contextModified?: boolean
			contextSize?: number
		},
	) {
		if (!this.isCategoryEnabled("hooks")) {
			return
		}

		const properties: TelemetryProperties = {
			ulid,
			hookName,
			status,
			timestamp: new Date().toISOString(),
			...(metadata?.source && { source: metadata.source }),
			...(metadata?.toolName && { toolName: metadata.toolName }),
			...(metadata?.durationMs !== undefined && { durationMs: metadata.durationMs }),
			...(metadata?.exitCode !== undefined && { exitCode: metadata.exitCode }),
			...(metadata?.errorType && { errorType: metadata.errorType }),
			...(metadata?.errorMessage && {
				errorMessage: metadata.errorMessage.substring(0, MAX_ERROR_MESSAGE_LENGTH),
			}),
			...(metadata?.cancelRequested !== undefined && { cancelRequested: metadata.cancelRequested }),
			...(metadata?.contextModified !== undefined && { contextModified: metadata.contextModified }),
			...(metadata?.contextSize !== undefined && { contextSize: metadata.contextSize }),
		}

		// Single event for all statuses
		this.capture({
			event: "hooks.execution",
			properties,
		})

		// Record metrics based on status
		const hookAttributes = {
			ulid,
			hookName,
			status,
			...(metadata?.source && { source: metadata.source }),
			...(metadata?.toolName && { toolName: metadata.toolName }),
		}

		if (status === "started") {
			this.recordCounter(TelemetryService.METRICS.HOOKS.EXECUTIONS_TOTAL, 1, hookAttributes)
		} else if (status === "completed") {
			if (metadata?.durationMs !== undefined) {
				this.recordHistogram(TelemetryService.METRICS.HOOKS.DURATION_SECONDS, metadata.durationMs / 1000, hookAttributes)
			}
			if (metadata?.cancelRequested) {
				this.recordCounter(TelemetryService.METRICS.HOOKS.CANCELLATIONS_TOTAL, 1, hookAttributes)
			}
			if (metadata?.contextModified) {
				this.recordCounter(TelemetryService.METRICS.HOOKS.CONTEXT_MODIFICATIONS_TOTAL, 1, hookAttributes)
			}
		} else if (status === "failed") {
			this.recordCounter(TelemetryService.METRICS.HOOKS.FAILURES_TOTAL, 1, {
				...hookAttributes,
				errorType: metadata?.errorType || "unknown",
			})
		} else if (status === "cancelled") {
			this.recordCounter(TelemetryService.METRICS.HOOKS.CANCELLATIONS_TOTAL, 1, hookAttributes)
		}
	}

	/**
	 * Records hook discovery results (simplified version).
	 *
	 * @param hookName The type of hook being discovered
	 * @param globalCount Number of global hooks found
	 * @param workspaceCount Number of workspace-specific hooks found
	 */
	public captureHookDiscovery(hookName: string, globalCount: number, workspaceCount: number) {
		if (!this.isCategoryEnabled("hooks")) {
			return
		}

		this.capture({
			event: TelemetryService.EVENTS.HOOKS.DISCOVERY_COMPLETED,
			properties: {
				hookName,
				globalCount,
				workspaceCount,
				totalCount: globalCount + workspaceCount,
				timestamp: new Date().toISOString(),
			},
		})
	}

	/**
	 * Records when a file edit (write_to_file, replace_in_file, apply_patch) is accepted by the user
	 * Tracks lines added, deleted, and changed for the accepted edit.
	 *
	 * @param args Properties for the accepted AI output event
	 */
	public captureAiOutputAccepted(args: {
		ulid: string
		tool: string
		provider?: string
		model?: string
		source: "agent" | "human"
		linesAdded: number
		linesDeleted: number
		linesChanged: number
		filesCreated?: number
		filesDeleted?: number
		filesMoved?: number
	}): void {
		this.capture({
			event: "task.ai_output.accepted",
			properties: {
				ulid: args.ulid,
				tool: args.tool,
				provider: args.provider,
				model: args.model,
				source: args.source,
				linesAdded: args.linesAdded,
				linesDeleted: args.linesDeleted,
				linesChanged: args.linesChanged,
				filesCreated: args.filesCreated ?? 0,
				filesDeleted: args.filesDeleted ?? 0,
				filesMoved: args.filesMoved ?? 0,
			},
		})

		const attrs = { ulid: args.ulid, tool: args.tool, provider: args.provider, model: args.model, source: args.source }
		this.recordCounter(TelemetryService.METRICS.AI_OUTPUT.ACCEPTED_LINES_ADDED, args.linesAdded, attrs)
		this.recordCounter(TelemetryService.METRICS.AI_OUTPUT.ACCEPTED_LINES_DELETED, args.linesDeleted, attrs)
		this.recordCounter(TelemetryService.METRICS.AI_OUTPUT.ACCEPTED_LINES_CHANGED, args.linesChanged, attrs)
		if (args.filesCreated) {
			this.recordCounter(TelemetryService.METRICS.AI_OUTPUT.ACCEPTED_FILES_CREATED, args.filesCreated, attrs)
		}
		if (args.filesDeleted) {
			this.recordCounter(TelemetryService.METRICS.AI_OUTPUT.ACCEPTED_FILES_DELETED, args.filesDeleted, attrs)
		}
		if (args.filesMoved) {
			this.recordCounter(TelemetryService.METRICS.AI_OUTPUT.ACCEPTED_FILES_MOVED, args.filesMoved, attrs)
		}
	}

	/**
	 * Records when a file edit (write_to_file, replace_in_file, apply_patch) is rejected by the user
	 * Tracks lines that would have been added, deleted, and changed.
	 *
	 * @param args Properties for the rejected AI output event
	 */
	public captureAiOutputRejected(args: {
		ulid: string
		tool: string
		provider?: string
		model?: string
		source: "agent" | "human"
		linesAdded: number
		linesDeleted: number
		linesChanged: number
		filesCreated?: number
		filesDeleted?: number
		filesMoved?: number
	}): void {
		this.capture({
			event: "task.ai_output.rejected",
			properties: {
				ulid: args.ulid,
				tool: args.tool,
				provider: args.provider,
				model: args.model,
				source: args.source,
				linesAdded: args.linesAdded,
				linesDeleted: args.linesDeleted,
				linesChanged: args.linesChanged,
				filesCreated: args.filesCreated ?? 0,
				filesDeleted: args.filesDeleted ?? 0,
				filesMoved: args.filesMoved ?? 0,
			},
		})

		const attrs = { ulid: args.ulid, tool: args.tool, provider: args.provider, model: args.model, source: args.source }
		this.recordCounter(TelemetryService.METRICS.AI_OUTPUT.REJECTED_LINES_ADDED, args.linesAdded, attrs)
		this.recordCounter(TelemetryService.METRICS.AI_OUTPUT.REJECTED_LINES_DELETED, args.linesDeleted, attrs)
		this.recordCounter(TelemetryService.METRICS.AI_OUTPUT.REJECTED_LINES_CHANGED, args.linesChanged, attrs)
		if (args.filesCreated) {
			this.recordCounter(TelemetryService.METRICS.AI_OUTPUT.REJECTED_FILES_CREATED, args.filesCreated, attrs)
		}
		if (args.filesDeleted) {
			this.recordCounter(TelemetryService.METRICS.AI_OUTPUT.REJECTED_FILES_DELETED, args.filesDeleted, attrs)
		}
		if (args.filesMoved) {
			this.recordCounter(TelemetryService.METRICS.AI_OUTPUT.REJECTED_FILES_MOVED, args.filesMoved, attrs)
		}
	}

	/**
	 * Records the size of a gRPC response message for observability.
	 *
	 * @param sizeUtf8Bytes Size in UTF-8 bytes (use `Buffer.byteLength`, not `string.length`)
	 * @param service The gRPC service name
	 * @param method The gRPC method name
	 * @param requestId Optional request ID for correlation
	 */
	public captureLegacyTaskMigration(args: {
		taskId: string
		outcome: "success" | "skipped" | "error"
		reason: string
		durationMs: number
		legacyApiHistoryLength?: number
		convertedMessageCount?: number
		sdkLookupFailed?: boolean
		hasFavorite?: boolean
		hasCost?: boolean
		hasTokenUsage?: boolean
		hasCwd?: boolean
	}): void {
		const migrationType = "legacy_task_to_sdk_session"
		const metricAttributes = {
			migration_type: migrationType,
			outcome: args.outcome,
			reason: args.reason,
		}

		this.capture({
			event: TelemetryService.EVENTS.TASK.LEGACY_TASK_MIGRATION,
			properties: {
				ulid: args.taskId,
				migration_type: migrationType,
				outcome: args.outcome,
				reason: args.reason,
				durationMs: args.durationMs,
				legacyApiHistoryLength: args.legacyApiHistoryLength,
				convertedMessageCount: args.convertedMessageCount,
				sdkLookupFailed: args.sdkLookupFailed,
				hasFavorite: args.hasFavorite,
				hasCost: args.hasCost,
				hasTokenUsage: args.hasTokenUsage,
				hasCwd: args.hasCwd,
			},
		})

		this.recordCounter(
			TelemetryService.METRICS.MIGRATION.LEGACY_TASK_ATTEMPTS_TOTAL,
			1,
			metricAttributes,
			"Legacy VS Code task migration decisions",
		)
		if (args.outcome === "success") {
			this.recordCounter(
				TelemetryService.METRICS.MIGRATION.LEGACY_TASK_SUCCESS_TOTAL,
				1,
				metricAttributes,
				"Legacy VS Code tasks successfully copied into SDK session storage",
			)
		} else if (args.outcome === "error") {
			this.recordCounter(
				TelemetryService.METRICS.MIGRATION.LEGACY_TASK_FAILURES_TOTAL,
				1,
				metricAttributes,
				"Legacy VS Code task migrations that failed while building or writing the SDK session",
			)
		} else {
			this.recordCounter(
				TelemetryService.METRICS.MIGRATION.LEGACY_TASK_SKIPPED_TOTAL,
				1,
				metricAttributes,
				"Legacy VS Code task migration checks that did not need or could not perform a migration",
			)
		}

		this.recordHistogram(
			TelemetryService.METRICS.MIGRATION.LEGACY_TASK_DURATION_SECONDS,
			args.durationMs / 1000,
			metricAttributes,
			"Time spent checking or migrating a legacy VS Code task into SDK session storage",
		)
		if (args.legacyApiHistoryLength !== undefined) {
			this.recordHistogram(
				TelemetryService.METRICS.MIGRATION.LEGACY_TASK_LEGACY_MESSAGES_COUNT,
				args.legacyApiHistoryLength,
				metricAttributes,
				"Number of raw legacy API history messages found while migrating a legacy VS Code task",
			)
		}
		if (args.convertedMessageCount !== undefined) {
			this.recordHistogram(
				TelemetryService.METRICS.MIGRATION.LEGACY_TASK_CONVERTED_MESSAGES_COUNT,
				args.convertedMessageCount,
				metricAttributes,
				"Number of SDK-compatible messages produced from a legacy VS Code task migration",
			)
		}
	}

	public captureLegacyTaskMigrationBacklog(args: {
		pendingLegacyTaskCount: number
		migratedSdkTaskCount: number
		visibleSdkTaskCount: number
		visibleTaskCount: number
	}): void {
		const attributes = { migration_type: "legacy_task_to_sdk_session" }
		this.recordGauge(
			TelemetryService.METRICS.MIGRATION.LEGACY_TASK_PENDING_COUNT,
			args.pendingLegacyTaskCount,
			attributes,
			"Legacy VS Code tasks visible in history but not yet migrated to SDK sessions",
		)
		this.recordGauge(
			TelemetryService.METRICS.MIGRATION.LEGACY_TASK_MIGRATED_COUNT,
			args.migratedSdkTaskCount,
			attributes,
			"SDK sessions marked as migrated from legacy VS Code task history",
		)
		// The caller runs on every task-history enumeration (every webview state
		// post), so capturing unconditionally re-reported the same backlog ~29
		// times per machine per 12h fleet-wide. Gauges above stay per-call; the
		// event fires only when the migration state transitions, and never for
		// machines with no legacy history at all.
		const backlogEventKey = `${args.pendingLegacyTaskCount}:${args.migratedSdkTaskCount}`
		if (this.lastLegacyBacklogEventKey === backlogEventKey) {
			return
		}
		this.lastLegacyBacklogEventKey = backlogEventKey
		if (args.pendingLegacyTaskCount === 0 && args.migratedSdkTaskCount === 0) {
			return
		}
		this.capture({
			event: TelemetryService.EVENTS.TASK.LEGACY_TASK_MIGRATION,
			properties: {
				migration_type: "legacy_task_to_sdk_session",
				outcome: "backlog",
				pendingLegacyTaskCount: args.pendingLegacyTaskCount,
				migratedSdkTaskCount: args.migratedSdkTaskCount,
				visibleSdkTaskCount: args.visibleSdkTaskCount,
				visibleTaskCount: args.visibleTaskCount,
			},
		})
	}

	public captureGrpcResponseSize(sizeUtf8Bytes: number, service: string, method: string, requestId?: string): void {
		this.recordHistogram(
			TelemetryService.METRICS.GRPC.RESPONSE_SIZE_BYTES,
			sizeUtf8Bytes,
			{
				service,
				method,
				...(requestId && { request_id: requestId }),
			},
			"Size of gRPC response messages in bytes",
		)

		if (sizeUtf8Bytes > 4 * 1024 * 1024) {
			Logger.warn(
				`[TelemetryService] Large gRPC response: ${service}.${method} ` +
					`size=${(sizeUtf8Bytes / (1024 * 1024)).toFixed(1)}MB` +
					(requestId ? ` request_id=${requestId}` : ""),
			)
		}
	}

	/**
	 * Safely executes a telemetry call with error protection.
	 *
	 * Use for critical execution paths where telemetry errors could break functionality:
	 * - Hook execution (during tool execution)
	 * - Browser automation (during active sessions)
	 * - Auth flows, task initialization
	 * - MCP server operations
	 *
	 * Not needed for non-critical, fire-and-forget events:
	 * - UI events (clicks, navigation)
	 * - Post-completion events
	 * - Background operations
	 *
	 * This wrapper protects against both pre-provider errors (parameter construction,
	 * property access, calculations) and provider-level errors (network, API failures).
	 *
	 * @param telemetryFn The telemetry function to execute
	 * @param context Optional context string for debugging (e.g., "HookFactory.exec")
	 *
	 * @example
	 * telemetryService.safeCapture(
	 *   () => telemetryService.captureHookExecution(taskId, hookName, "started", {...}),
	 *   'HookFactory.exec.started'
	 * )
	 */
	public safeCapture(telemetryFn: () => void, context?: string): void {
		try {
			telemetryFn()
		} catch (error) {
			const contextStr = context ? ` [Context: ${context}]` : ""
			Logger.error(`[Telemetry] Failed to capture telemetry${contextStr}:`, error)
		}
	}

	/**
	 * Clean up resources when the service is disposed
	 */
	public async dispose(): Promise<void> {
		const disposePromises = this.providers.map((provider) => provider.dispose())
		await Promise.allSettled(disposePromises)
	}
}
