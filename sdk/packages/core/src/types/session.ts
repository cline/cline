import type * as LlmsProviders from "@clinebot/llms";
import type { SessionAccumulatedUsage } from "../runtime/host/runtime-host";
import type { BuiltRuntime } from "../runtime/orchestration/session-runtime";
import type { SessionRuntime } from "../runtime/orchestration/session-runtime-orchestrator";
import type { SessionRow } from "../session/models/session-row";
import type { RootSessionArtifacts } from "../session/services/session-service";
import type { SessionSource, SessionStatus } from "./common";
import type { CoreSessionConfig } from "./config";

export type ActiveSession = {
	sessionId: string;
	config: CoreSessionConfig;
	sessionMetadata?: Record<string, unknown>;
	artifacts?: RootSessionArtifacts;
	source: SessionSource;
	startedAt: string;
	updatedAt: string;
	status: SessionStatus;
	endedAt?: string | null;
	exitCode?: number | null;
	pendingPrompt?: string;
	runtime: BuiltRuntime;
	agent: SessionRuntime;
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
	/**
	 * Set to `true` once the assistant successfully invoked the canonical
	 * completion tool (`submit_and_exit`) for this session. Used to:
	 *
	 * 1. Emit `task.completed` exactly once at the moment the assistant
	 *    declares completion (parity with original Cline's
	 *    `attempt_completion`).
	 * 2. Suppress the fallback `task.completed` emission from
	 *    `shutdownSession(...)` so the same logical completion is not
	 *    reported twice.
	 *
	 * Non-interactive sessions that finish without ever calling the
	 * completion tool still receive a `task.completed` from the shutdown
	 * fallback.
	 */
	submitAndExitObserved: boolean;
};

export type PendingPrompt = {
	id: string;
	prompt: string;
	delivery: "queue" | "steer";
	userImages?: string[];
	userFiles?: string[];
};

export type TeamRunUpdate = {
	runId: string;
	agentId: string;
	taskId?: string;
	status: "completed" | "failed" | "cancelled" | "interrupted";
	error?: string;
	iterations?: number;
};

export type StoredMessageWithMetadata = LlmsProviders.MessageWithMetadata;

export type PreparedTurnInput = {
	prompt: string;
	userImages?: string[];
	userFiles?: string[];
};

// ── Persistence interfaces ────────────────────────────────────────────

export interface PersistedSessionUpdateInput {
	sessionId: string;
	expectedStatusLock?: number;
	status?: SessionStatus;
	endedAt?: string | null;
	exitCode?: number | null;
	prompt?: string | null;
	metadata?: Record<string, unknown> | null;
	title?: string | null;
	parentSessionId?: string | null;
	parentAgentId?: string | null;
	agentId?: string | null;
	conversationId?: string | null;
	setRunning?: boolean;
}

export interface SessionPersistenceAdapter {
	ensureSessionsDir(): string;
	upsertSession(row: SessionRow): Promise<void>;
	getSession(sessionId: string): Promise<SessionRow | undefined>;
	listSessions(options: {
		limit: number;
		parentSessionId?: string;
		status?: string;
	}): Promise<SessionRow[]>;
	updateSession(
		input: PersistedSessionUpdateInput,
	): Promise<{ updated: boolean; statusLock: number }>;
	deleteSession(sessionId: string, cascade: boolean): Promise<boolean>;
	enqueueSpawnRequest(input: {
		rootSessionId: string;
		parentAgentId: string;
		task?: string;
		systemPrompt?: string;
	}): Promise<void>;
	claimSpawnRequest(
		rootSessionId: string,
		parentAgentId: string,
	): Promise<string | undefined>;
}

export interface SessionMessagesArtifactUploader {
	uploadMessagesFile(input: {
		sessionId: string;
		path: string;
		contents: string;
		row?: SessionRow;
	}): Promise<void>;
}
