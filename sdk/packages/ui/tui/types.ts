import type {
	AgentEvent,
	AgentMode,
	ClineSubscriptionPlan,
	TeamUiEvent,
	ToolApprovalRequest,
	ToolApprovalResult,
	ToolPolicy,
	UiPendingPromptSubmitted,
	UiPendingPromptsState,
} from "@cline/shared";
import type { ChoiceContext } from "@opentui-ui/dialog";
import type { DialogActions } from "@opentui-ui/dialog/react";
import type { ReactNode } from "react";
import type { CheckpointPickerItem } from "./components/dialogs/checkpoint-picker";
import type {
	InteractiveConfigData,
	InteractiveConfigItem,
	LoadInteractiveConfigDataOptions,
} from "./config-model";
import type { CliCompactionMode } from "./formatting/compaction-mode";

export type ChatEntry = (
	| { kind: "user"; text: string }
	| { kind: "assistant_text"; text: string; streaming: boolean }
	| {
			kind: "assistant_media";
			modality: "image" | "audio" | "video" | "file";
			mediaType: string;
			byteLength: number;
			location?: string;
	  }
	| { kind: "reasoning"; text: string; streaming: boolean }
	| {
			kind: "tool_call";
			toolCallId?: string;
			toolName: string;
			inputSummary: string;
			rawInput?: unknown;
			streaming: boolean;
			result?: {
				outputSummary: string;
				rawOutput?: unknown;
				error?: string;
			};
	  }
	| { kind: "error"; text: string }
	| { kind: "status"; text: string }
	| {
			kind: "compaction";
			compactionMode: "auto" | "manual" | "inherited";
			status: "started" | "completed" | "skipped" | "failed" | "cancelled";
			tokensBefore?: number;
			tokensAfter?: number;
			messagesBefore?: number;
			messagesAfter?: number;
	  }
	| { kind: "team"; text: string }
	| { kind: "user_submitted"; text: string; delivery?: "queue" | "steer" }
	| {
			kind: "done";
			tokens: number;
			cost: number;
			elapsed: string;
			iterations: number;
	  }
) & {
	/**
	 * Agent mode active when the entry was produced. Stamped by appendEntry
	 * (live sessions) and host hydration (resumed sessions) so the
	 * transcript renders each entry with the accent of its own mode instead
	 * of retinting everything to the current mode. Absent on entries from
	 * transcripts that predate mode stamping.
	 */
	mode?: AgentMode;
};

export interface InteractiveTurnResult {
	usage: {
		inputTokens: number;
		outputTokens: number;
		totalCost?: number;
	};
	/**
	 * Tokens occupying the model's context window after this turn: the
	 * normalized input tokens of the latest assistant LLM call.
	 */
	currentContextSize?: number;
	iterations: number;
	finishReason?: string;
	commandOutput?: string;
	queued?: boolean;
}

/** Transcript entries plus session totals produced by host-side hydration. */
export interface ResumedSessionEntries {
	entries: ChatEntry[];
	totalCost?: number;
	currentContextSize?: number;
}

export interface InteractiveCompactionResult {
	messagesBefore: number;
	messagesAfter: number;
	workingContextMessagesAfter?: number;
	compacted: boolean;
}

export interface UserInputAttachments {
	userImages?: string[];
}

export interface QueuedPromptItem {
	id: string;
	prompt: string;
	steer: boolean;
	attachmentCount: number;
}

export interface PendingPromptMutationResult {
	sessionId: string;
	prompts: QueuedPromptItem[];
	prompt?: QueuedPromptItem;
	updated?: boolean;
	removed?: boolean;
}

export type AppView = "onboarding" | "home" | "chat";
export type TuiStartupTarget = "chat" | "config" | "history";

export type RuntimeToolInteraction =
	| {
			id: number;
			kind: "tool_approval";
			request: ToolApprovalRequest;
	  }
	| {
			id: number;
			kind: "ask_question";
			question: string;
			options: string[];
	  };

/** Session usage totals shown in the status bar. */
export interface InteractiveUsageTotals {
	totalTokens: number;
	totalCost: number;
}

export interface GitDiffStats {
	files: number;
	additions: number;
	deletions: number;
}

export interface RepoStatus {
	branch: string | null;
	diffStats: GitDiffStats | null;
}

export interface SlashCommand {
	name: string;
	instructions: string;
	description?: string;
	kind?: "skill" | "workflow";
}

export interface HubBuildMismatchEvent {
	/** WebSocket URL of the live managed Hub that does not match this build. */
	url: string;
	/**
	 * Why client and Hub disagree — see the host's hub build watcher for the
	 * full semantics. `outdated_hub` means this client is already the newer
	 * build and nothing needs to be installed.
	 */
	reason: "unsupported_protocol" | "build_mismatch" | "outdated_hub";
	hubCoreVersion?: string;
}

/** Result reported by a host-rendered onboarding flow. */
export interface OnboardingCompletion {
	providerId: string;
	modelId: string;
	apiKey?: string;
	thinking?: boolean;
	reasoningEffort?: string;
}

/**
 * Mutable session configuration the terminal UI reads at render time. Hosts
 * pass their richer config objects; only these fields are accessed. The
 * object is intentionally shared and mutable: host surfaces (onboarding,
 * model selector) update it in place and the UI re-reads it.
 */
export interface InteractiveTerminalUiConfig {
	providerId: string;
	modelId: string;
	apiKey?: string;
	cwd: string;
	workspaceRoot?: string;
	verbose?: boolean;
	thinking?: boolean;
	reasoningEffort?: string;
	mode?: AgentMode;
	sandbox?: boolean;
	compaction?: {
		enabled?: boolean;
		strategy?: "agentic" | "basic";
	};
	toolPolicies?: Record<string, ToolPolicy | undefined>;
}

/** Persistence for the prompt input history (typically a host-owned file). */
export interface InputHistoryStore {
	load(): string[];
	append(prompt: string): void;
}

/** Persistence for the selected TUI theme (typically host global settings). */
export interface ThemePreferenceStore {
	load(): string | undefined;
	save(themeId: string): void;
}

/**
 * Startup notice dialog injected by the host (e.g. a migration notice). The
 * UI shows it once over the home view; the host renders the dialog content
 * and records that it was shown.
 */
export interface StartupNotice {
	/** Skip the notice entirely for this provider (host policy). */
	shouldShowForProvider(providerId: string): boolean;
	content: (ctx: ChoiceContext<boolean>) => ReactNode;
	onShown?: () => void | Promise<void>;
}

/**
 * Everything host surfaces may need to drive the UI from a dialog opened
 * outside the shared component tree: dialog control, layout metrics, session
 * transcript mutators, and input helpers.
 */
export interface HostSurfaceContext {
	dialog: DialogActions;
	termWidth: number;
	termHeight: number;
	config: InteractiveTerminalUiConfig;
	session: SessionSurfaceController;
	setAppView: (view: AppView) => void;
	refocusTextarea: () => void;
	populateInput: (value: string) => void;
	showToast: (message: string, variant?: "info" | "success" | "error") => void;
}

/** Transcript/session mutators exposed to host surfaces. */
export interface SessionSurfaceController {
	appendEntry: (entry: ChatEntry) => void;
	updateLastEntry: (updater: (prev: ChatEntry) => ChatEntry) => void;
	clearEntries: () => void;
	replaceEntries: (entries: ChatEntry[]) => void;
	setHasSubmitted: (submitted: boolean) => void;
	setLastTotalTokens: (tokens: number) => void;
	setLastTotalCost: (cost: number) => void;
	setIsRunning: (running: boolean) => void;
	isRunning: boolean;
	uiMode: AgentMode;
}

export interface OpenModelSelectorOptions {
	onCancel?: () => Promise<void> | void;
	startWithProviderChange?: boolean;
}

/**
 * Runtime-owned UX surfaces the host renders with its own data access
 * (provider configuration, accounts, MCP management, session history,
 * onboarding). All members are optional; the UI degrades gracefully when a
 * host does not provide one.
 */
export interface HostSurfaces {
	openModelSelector?: (options?: OpenModelSelectorOptions) => Promise<void>;
	openMcpManager?: () => Promise<boolean>;
	openAccountDialog?: () => Promise<void>;
	openHistory?: () => Promise<void>;
	renderOnboarding?: (props: {
		onComplete: (result: OnboardingCompletion) => void;
		onExit: () => void;
	}) => ReactNode;
}

export interface InteractiveTerminalUiProps {
	config: InteractiveTerminalUiConfig;
	startupTarget?: TuiStartupTarget;
	initialPrompt?: string;
	/** Show the host onboarding flow before home/chat. */
	startInOnboarding?: boolean;
	startupNotice?: StartupNotice;
	initialEntries?: ChatEntry[];
	initialUsage?: InteractiveUsageTotals;
	loadDeferredInitialEntries?: () => Promise<ResumedSessionEntries>;
	initialRepoStatus?: RepoStatus;
	refreshRepoStatus?: () => Promise<RepoStatus>;
	workflowSlashCommands?: SlashCommand[];
	loadAdditionalSlashCommands?: () => Promise<SlashCommand[]>;
	loadWelcomeLine?: () => Promise<string | undefined>;
	loadIndividualSubscriptionPlans?: () => Promise<ClineSubscriptionPlan[]>;
	loadConfigData: (
		options?: LoadInteractiveConfigDataOptions,
	) => Promise<InteractiveConfigData>;
	onToggleConfigItem?: (
		item: InteractiveConfigItem,
		options?: LoadInteractiveConfigDataOptions,
	) => Promise<InteractiveConfigData | undefined>;
	onDeleteConfigItem?: (
		item: InteractiveConfigItem,
		options?: LoadInteractiveConfigDataOptions,
	) => Promise<InteractiveConfigData | undefined>;
	/** Auto-update toggle backing store (host global settings). */
	autoUpdateSetting?: {
		load(): boolean;
		save(enabled: boolean): void;
	};
	searchFilesForMention?: (input: {
		workspaceRoot: string;
		query: string;
		limit?: number;
	}) => Promise<string[]>;
	inputHistory?: InputHistoryStore;
	themePreference?: ThemePreferenceStore;
	openExternal?: (url: string) => Promise<void>;
	watchHubBuildMismatch?: (handlers: {
		onMismatch: (event: HubBuildMismatchEvent) => void;
	}) => () => void;
	/**
	 * Host policy for whether local skill slash commands expand into the
	 * prompt (vs. being delivered through the skills tool).
	 */
	shouldExpandSkillCommands?: (mode?: string) => boolean;
	createHostSurfaces?: (ctx: HostSurfaceContext) => HostSurfaces;
	subscribeToEvents: (handlers: {
		onAgentEvent: (event: AgentEvent) => void;
		onTeamEvent: (event: TeamUiEvent) => void;
		onPendingPrompts: (event: UiPendingPromptsState) => void;
		onPendingPromptSubmitted: (event: UiPendingPromptSubmitted) => void;
	}) => () => void;
	onSubmit: (
		input: string,
		mode: AgentMode,
		delivery?: "queue" | "steer",
		attachments?: UserInputAttachments,
		onCommandOutput?: (text: string) => void,
	) => Promise<InteractiveTurnResult>;
	onUpdatePendingPrompt: (input: {
		promptId: string;
		prompt?: string;
		delivery?: "queue" | "steer";
	}) => Promise<PendingPromptMutationResult>;
	onAbort: () => boolean;
	onExit: () => void;
	/**
	 * Exit the TUI and run the host self-update afterwards. Invoked when the
	 * user accepts the "Hub was updated by another installation" dialog.
	 */
	onHubUpdateRestart?: () => void;
	onRunningChange: (isRunning: boolean) => void;
	onTurnErrorReported: (reported: boolean) => void;
	onAutoApproveChange: (enabled: boolean) => void;
	onCompactionModeChange: (mode: CliCompactionMode) => Promise<void>;
	onModelChange: () => Promise<void>;
	onModeChange: (mode: AgentMode) => Promise<void>;
	onNewSession: () => Promise<void>;
	onSessionRestart: () => Promise<void>;
	onCompact: () => Promise<InteractiveCompactionResult>;
	onFork: () => Promise<
		| {
				forkedFromSessionId: string;
				newSessionId: string;
				carriedWorkingContext?: {
					workingContextMessages: number;
					canonicalMessages: number;
				};
		  }
		| undefined
	>;
	loadCheckpointItems?: () => Promise<CheckpointPickerItem[] | undefined>;
	onRestoreCheckpoint?: (
		runCount: number,
		restoreWorkspace: boolean,
	) => Promise<{ entries: ChatEntry[] } | undefined>;
	setToolApprover: (
		approver:
			| ((request: ToolApprovalRequest) => Promise<ToolApprovalResult>)
			| null,
	) => void;
	setAskQuestion: (
		handler: ((question: string, options: string[]) => Promise<string>) | null,
	) => void;
	setModeChangeNotifier: (handler: ((mode: AgentMode) => void) | null) => void;
}

export type InlineStream = "text" | "reasoning" | undefined;

export const HOME_VIEW_MAX_WIDTH = 68;
export const MAX_BUFFERED_LINES = 500;
export const DEFAULT_MAX_INPUT_TOKENS = 200000;
export const COMPLETION_DEBOUNCE_MS = 120;
export const MAX_COMPLETION_RESULTS = 200;
