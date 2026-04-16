import type * as LlmsProviders from "@clinebot/llms";
import type {
	AgentResult,
	ToolApprovalRequest,
	ToolApprovalResult,
} from "@clinebot/shared";
import type { HookEventPayload } from "../hooks";
import type { SessionSource } from "../types/common";
import type { CoreSessionConfig } from "../types/config";
import type { CoreSessionEvent } from "../types/events";
import type { SessionRecord } from "../types/sessions";
import type { SessionManifest } from "./session-manifest";

export interface StartSessionInput {
	config: CoreSessionConfig;
	source?: SessionSource;
	prompt?: string;
	interactive?: boolean;
	sessionMetadata?: Record<string, unknown>;
	initialMessages?: LlmsProviders.Message[];
	userImages?: string[];
	userFiles?: string[];
	userInstructionWatcher?: import("../extensions/config").UserInstructionConfigWatcher;
	onTeamRestored?: () => void;
	defaultToolExecutors?: Partial<import("../tools").ToolExecutors>;
	toolPolicies?: import("@clinebot/shared").AgentConfig["toolPolicies"];
	requestToolApproval?: (
		request: ToolApprovalRequest,
	) => Promise<ToolApprovalResult>;
	teamToolsFactory?: import("../runtime/session-runtime").TeamToolsFactory;
}

export interface StartSessionResult {
	sessionId: string;
	manifest: SessionManifest;
	manifestPath: string;
	transcriptPath: string;
	messagesPath: string;
	result?: AgentResult;
}

export interface SendSessionInput {
	sessionId: string;
	prompt: string;
	userImages?: string[];
	userFiles?: string[];
	delivery?: "queue" | "steer";
}

export interface SessionAccumulatedUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalCost: number;
}

export interface SessionManager {
	readonly runtimeAddress?: string;
	start(input: StartSessionInput): Promise<StartSessionResult>;
	send(input: SendSessionInput): Promise<AgentResult | undefined>;
	getAccumulatedUsage(
		sessionId: string,
	): Promise<SessionAccumulatedUsage | undefined>;
	abort(sessionId: string, reason?: unknown): Promise<void>;
	stop(sessionId: string): Promise<void>;
	dispose(reason?: string): Promise<void>;
	get(sessionId: string): Promise<SessionRecord | undefined>;
	list(limit?: number): Promise<SessionRecord[]>;
	delete(sessionId: string): Promise<boolean>;
	update(
		sessionId: string,
		updates: {
			prompt?: string | null;
			metadata?: Record<string, unknown> | null;
			title?: string | null;
		},
	): Promise<{ updated: boolean }>;
	readMessages(sessionId: string): Promise<LlmsProviders.Message[]>;
	readTranscript(sessionId: string, maxChars?: number): Promise<string>;
	handleHookEvent(payload: HookEventPayload): Promise<void>;
	subscribe(listener: (event: CoreSessionEvent) => void): () => void;
	updateSessionModel?(sessionId: string, modelId: string): Promise<void>;
}
