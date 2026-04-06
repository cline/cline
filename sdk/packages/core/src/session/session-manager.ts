import type { AgentResult } from "@clinebot/agents";
import type * as LlmsProviders from "@clinebot/llms";
import type { ToolApprovalRequest, ToolApprovalResult } from "@clinebot/shared";
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
	initialMessages?: LlmsProviders.Message[];
	userImages?: string[];
	userFiles?: string[];
	userInstructionWatcher?: import("../extensions").UserInstructionConfigWatcher;
	onTeamRestored?: () => void;
	defaultToolExecutors?: Partial<import("../tools").ToolExecutors>;
	toolPolicies?: import("@clinebot/agents").AgentConfig["toolPolicies"];
	requestToolApproval?: (
		request: ToolApprovalRequest,
	) => Promise<ToolApprovalResult>;
}

export interface StartSessionResult {
	sessionId: string;
	manifest: SessionManifest;
	manifestPath: string;
	transcriptPath: string;
	hookPath: string;
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
	readMessages(sessionId: string): Promise<LlmsProviders.Message[]>;
	readTranscript(sessionId: string, maxChars?: number): Promise<string>;
	readHooks(sessionId: string, limit?: number): Promise<unknown[]>;
	subscribe(listener: (event: CoreSessionEvent) => void): () => void;
	updateSessionModel?(sessionId: string, modelId: string): Promise<void>;
}
