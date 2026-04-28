import type { AgentEvent, AgentMode, Llms, TeamEvent } from "@clinebot/core";
import type { ToolApprovalRequest, ToolApprovalResult } from "@clinebot/shared";
import type {
	PendingPromptSnapshot,
	PendingPromptSubmittedEvent,
} from "../runtime/session-events";
import type { RepoStatus } from "../utils/repo-status";
import type { Config } from "../utils/types";
import type { ClineAccountSnapshot } from "./cline-account";
import type {
	InteractiveConfigData,
	InteractiveConfigItem,
} from "./interactive-config";
import type { InteractiveSlashCommand } from "./interactive-welcome";

export type ChatEntry =
	| { kind: "user"; text: string }
	| { kind: "assistant_text"; text: string; streaming: boolean }
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
	| { kind: "team"; text: string }
	| { kind: "user_submitted"; text: string; delivery?: "queue" | "steer" }
	| {
			kind: "done";
			tokens: number;
			cost: number;
			elapsed: string;
			iterations: number;
	  };

export interface InteractiveTurnResult {
	usage: {
		inputTokens: number;
		outputTokens: number;
		totalCost?: number;
	};
	iterations: number;
	finishReason?: string;
	commandOutput?: string;
	queued?: boolean;
}

export interface UserInputAttachments {
	userImages?: string[];
}

export interface QueuedPromptItem {
	id: string;
	prompt: string;
	steer: boolean;
}

export type AppView = "onboarding" | "home" | "chat";

export interface TuiProps {
	config: Config;
	initialView?: "chat" | "config";
	initialPrompt?: string;
	initialMessages?: Llms.Message[];
	initialRepoStatus?: RepoStatus;
	workflowSlashCommands?: InteractiveSlashCommand[];
	loadAdditionalSlashCommands?: () => Promise<InteractiveSlashCommand[]>;
	loadWelcomeLine?: () => Promise<string | undefined>;
	loadClineAccount: () => Promise<ClineAccountSnapshot>;
	switchClineAccount: (organizationId?: string | null) => Promise<void>;
	loadConfigData: () => Promise<InteractiveConfigData>;
	onToggleConfigItem?: (
		item: InteractiveConfigItem,
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
	) => Promise<InteractiveTurnResult>;
	onAbort: () => boolean;
	onExit: () => void;
	onRunningChange: (isRunning: boolean) => void;
	onTurnErrorReported: (reported: boolean) => void;
	onAutoApproveChange: (enabled: boolean) => void;
	onModelChange: () => Promise<void>;
	onModeChange: (mode: AgentMode) => Promise<void>;
	onSessionRestart: () => Promise<void>;
	onAccountChange: () => Promise<void>;
	onResumeSession: (sessionId: string) => Promise<Llms.Message[]>;
	onCompact: () => Promise<{ messagesBefore: number; messagesAfter: number }>;
	onFork: () => Promise<
		{ forkedFromSessionId: string; newSessionId: string } | undefined
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
export const DEFAULT_CONTEXT_WINDOW = 200000;
export const COMPLETION_DEBOUNCE_MS = 120;
export const MAX_COMPLETION_RESULTS = 200;
