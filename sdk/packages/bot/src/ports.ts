/**
 * Injected ports (Gateway RFC, Phase 2).
 *
 * `@cline/bot` owns domain semantics only. Repositories, resource
 * bindings, clocks, IDs, memory sources, and execution arrive as ports;
 * the real implementations live in the Gateway (Phase 3+). This package
 * never opens SQLite, watches files, exposes sockets, or spawns an
 * unsupervised child — see `boundaries.test.ts`.
 */

import type {
	BotId,
	RunExecutionSnapshot,
	RunId,
	RunState,
	SessionId,
	SessionState,
} from "@cline/shared/gateway";
import type { BotConfig, BotRecord } from "./identity";
import type { TurnOverrides } from "./overrides";

export interface BotClock {
	now(): number;
}

export interface BotIdSource {
	botId(): BotId;
	sessionId(): SessionId;
	runId(): RunId;
}

// -----------------------------------------------------------------------------
// Repositories
// -----------------------------------------------------------------------------

export interface BotRepository {
	get(botId: BotId): BotRecord | undefined;
	list(): readonly BotRecord[];
	/**
	 * Persist a record. Implementations MUST reject a save that changes an
	 * existing bot's role or parent (`RoleImmutableError`); config, name,
	 * and status changes are allowed.
	 */
	save(record: BotRecord): void;
}

/** A session's workspace binding. Immutable after session creation. */
export interface WorkspaceRef {
	readonly rootPath: string;
}

/**
 * Session kind (Gateway RFC, Phase 6). `canonical` is the bot's own
 * desktop/CLI conversation; `dedicated` isolates one external
 * (connector) conversation. Absent means `canonical` (pre-Phase 6 rows).
 */
export type SessionKind = "canonical" | "dedicated";

export interface SessionRecord {
	readonly sessionId: SessionId;
	readonly botId: BotId;
	readonly workspace: WorkspaceRef;
	readonly state: SessionState;
	readonly kind?: SessionKind;
	readonly createdAt: number;
	readonly revision: number;
}

export interface SessionRepository {
	get(sessionId: SessionId): SessionRecord | undefined;
	listByBot(botId: BotId): readonly SessionRecord[];
	/**
	 * Persist a record. Implementations MUST reject a save that changes an
	 * existing session's workspace (`WorkspaceImmutableError`).
	 */
	save(record: SessionRecord): void;
}

export interface RunRecord {
	readonly runId: RunId;
	readonly sessionId: SessionId;
	readonly botId: BotId;
	readonly state: RunState;
	readonly input: string;
	readonly acceptedAt: number;
	readonly startedAt?: number;
	readonly endedAt?: number;
	readonly outputText?: string;
	readonly error?: { name: string; message: string };
}

export interface RunRepository {
	get(runId: RunId): RunRecord | undefined;
	listBySession(sessionId: SessionId): readonly RunRecord[];
	save(record: RunRecord): void;
}

// -----------------------------------------------------------------------------
// Memories
// -----------------------------------------------------------------------------

/**
 * Source of memory files. The Gateway's implementation reads the bot's
 * `memories/` directory; tests use an in-memory listing. The domain only
 * sees relative paths and contents.
 */
export interface MemorySource {
	list(): readonly { path: string; content: string }[];
}

// -----------------------------------------------------------------------------
// Engine execution port
// -----------------------------------------------------------------------------

export interface EngineInvocation {
	readonly runId: RunId;
	readonly sessionId: SessionId;
	readonly botId: BotId;
	readonly input: string;
	readonly workspaceRoot: string;
	/** Durable admission source, attached by the Gateway before execution. */
	readonly source?: "interactive" | "connector" | "automation";
	/** Bot config with per-turn overrides already applied. */
	readonly effectiveConfig: BotConfig;
	readonly overrides?: TurnOverrides;
	/** Gateway-resolved immutable resources for this concrete attempt. */
	readonly executionSnapshot?: RunExecutionSnapshot;
}

export interface EngineOutcome {
	readonly status: "completed" | "failed" | "aborted" | "interrupted";
	readonly outputText: string;
	readonly error?: { name: string; message: string };
}

export interface EngineRunHandle {
	/** Merge steering text into the active run. */
	steer(text: string): boolean;
	interrupt(reason?: string): void;
	abort(reason?: string): void;
	/** Settles when the execution reaches a terminal state. Never rejects. */
	readonly result: Promise<EngineOutcome>;
	/** Optional ordered event feed (engine events, opaque to the domain). */
	subscribe?(listener: (event: unknown) => void): () => void;
}

export interface EnginePort {
	start(invocation: EngineInvocation): EngineRunHandle;
}

// -----------------------------------------------------------------------------
// Port bundle
// -----------------------------------------------------------------------------

export interface BotPorts {
	clock: BotClock;
	ids: BotIdSource;
	bots: BotRepository;
	sessions: SessionRepository;
	runs: RunRepository;
	engine: EnginePort;
	memories?: MemorySource;
}
