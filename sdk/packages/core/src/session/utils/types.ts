import type { Agent } from "@clinebot/agents";
import type { LlmsProviders } from "@clinebot/llms";
import type { BuiltRuntime } from "../../runtime/session-runtime";
import type { SessionSource } from "../../types/common";
import type { CoreSessionConfig } from "../../types/config";
import type { SessionAccumulatedUsage } from "../session-manager";
import type { RootSessionArtifacts } from "../session-service";

export type ActiveSession = {
	sessionId: string;
	config: CoreSessionConfig;
	artifacts?: RootSessionArtifacts;
	source: SessionSource;
	startedAt: string;
	pendingPrompt?: string;
	runtime: BuiltRuntime;
	agent: Agent;
	started: boolean;
	aborting: boolean;
	interactive: boolean;
	persistedMessages?: LlmsProviders.MessageWithMetadata[];
	activeTeamRunIds: Set<string>;
	pendingTeamRunUpdates: TeamRunUpdate[];
	teamRunWaiters: Array<() => void>;
	pendingPrompts: PendingPrompt[];
	drainingPendingPrompts: boolean;
	pluginSandboxShutdown?: () => Promise<void>;
	turnUsageBaseline?: SessionAccumulatedUsage;
};

export type PendingPrompt = {
	prompt: string;
	delivery: "queue" | "steer";
};

export type TeamRunUpdate = {
	runId: string;
	agentId: string;
	taskId?: string;
	status: "completed" | "failed" | "cancelled" | "interrupted";
	error?: string;
	iterations?: number;
};

export type StoredMessageWithMetadata = LlmsProviders.MessageWithMetadata & {
	providerId?: string;
	modelId?: string;
};

export type PreparedTurnInput = {
	prompt: string;
	userImages?: string[];
	userFiles?: string[];
};
