import type {
	AgentEvent,
	AgentMode,
	CheckpointEntry,
	ClineSubscriptionPlan,
	TeamEvent,
} from "@cline/core";
import type {
	MessageWithMetadata,
	ToolApprovalRequest,
	ToolApprovalResult,
} from "@cline/shared";
import type { CliMigrationNotice } from "../kanban-migration/notice";
import type {
	PendingPromptSnapshot,
	PendingPromptSubmittedEvent,
} from "../runtime/session-events";
import type { HistoryExportFormat } from "../session/history-export";
import type { RepoStatus } from "../utils/repo-status";
import type { CliCompactionMode, Config } from "../utils/types";
import type { ClineAccountSnapshot } from "./cline-account";
import type {
	InteractiveConfigData,
	InteractiveConfigItem,
	LoadInteractiveConfigDataOptions,
} from "./interactive-config";
import type { InteractiveSlashCommand } from "./interactive-welcome";

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
	 * (live sessions) and hydrateSessionMessages (resumed sessions) so the
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

export interface ResumedSessionResult {
	messages: MessageWithMetadata[];
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

export interface TuiProps {
	config: Config;
	startupTarget?: TuiStartupTarget;
	initialPrompt?: string;
	initialNotice?: CliMigrationNotice;
	onInitialNoticeShown?: (notice: CliMigrationNotice) => void | Promise<void>;
	initialMessages?: MessageWithMetadata[];
	loadDeferredInitialMessages?: () => Promise<ResumedSessionResult>;
	initialRepoStatus?: RepoStatus;
	workflowSlashCommands?: InteractiveSlashCommand[];
	loadAdditionalSlashCommands?: () => Promise<InteractiveSlashCommand[]>;
	loadWelcomeLine?: () => Promise<string | undefined>;
	loadClineAccount: () => Promise<ClineAccountSnapshot>;
	loadIndividualSubscriptionPlans?: () => Promise<ClineSubscriptionPlan[]>;
	switchClineAccount: (organizationId?: string | null) => Promise<void>;
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
	subscribeToEvents: (handlers: {
		onAgentEvent: (event: AgentEvent) => void;
		onTeamEvent: (event: TeamEvent) => void;
		onPendingPrompts: (event: PendingPromptSnapshot) => void;
		onPendingPromptSubmitted: (event: PendingPromptSubmittedEvent) => void;
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
	 * Exit the TUI and run the CLI self-update afterwards. Invoked when the
	 * user accepts the "Hub was updated by another Cline installation" dialog.
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
	onAccountChange: () => Promise<void>;
	onResumeSession: (sessionId: string) => Promise<ResumedSessionResult>;
	onExportHistorySession: (
		sessionId: string,
		format: HistoryExportFormat,
	) => Promise<string>;
	onDeleteHistorySession: (sessionId: string) => Promise<boolean>;
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
	getCheckpointData: () => Promise<
		| {
				messages: MessageWithMetadata[];
				checkpointHistory: CheckpointEntry[];
		  }
		| undefined
	>;
	onRestoreCheckpoint: (
		runCount: number,
		restoreWorkspace: boolean,
	) => Promise<
		{ newSessionId: string; messages: MessageWithMetadata[] } | undefined
	>;
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
