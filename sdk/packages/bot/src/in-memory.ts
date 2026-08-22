/**
 * In-memory port implementations (Gateway RFC, Phase 2 exit criterion:
 * all domain tests run with in-memory ports).
 *
 * The repositories are also invariant backstops: they reject identity
 * mutations (role/parent) and workspace mutations even if a future caller
 * bypasses the domain checks.
 */

import {
	type BotId,
	createBotId,
	createRunId,
	createSessionId,
	type RunId,
	type SessionId,
} from "@cline/shared/gateway";
import { RoleImmutableError, WorkspaceImmutableError } from "./errors";
import type { BotRecord } from "./identity";
import type {
	BotClock,
	BotIdSource,
	BotPorts,
	BotRepository,
	EngineInvocation,
	EngineOutcome,
	EnginePort,
	EngineRunHandle,
	MemorySource,
	RunRecord,
	RunRepository,
	SessionRecord,
	SessionRepository,
} from "./ports";

export class InMemoryBotRepository implements BotRepository {
	private readonly records = new Map<BotId, BotRecord>();

	get(botId: BotId): BotRecord | undefined {
		return this.records.get(botId);
	}

	list(): readonly BotRecord[] {
		return [...this.records.values()];
	}

	save(record: BotRecord): void {
		const existing = this.records.get(record.identity.botId);
		if (
			existing &&
			(existing.identity.role !== record.identity.role ||
				existing.identity.parentBotId !== record.identity.parentBotId)
		) {
			throw new RoleImmutableError(
				`Bot ${record.identity.botId} cannot change role/parent ` +
					`(${existing.identity.role} -> ${record.identity.role})`,
			);
		}
		this.records.set(record.identity.botId, record);
	}
}

export class InMemorySessionRepository implements SessionRepository {
	private readonly records = new Map<SessionId, SessionRecord>();

	get(sessionId: SessionId): SessionRecord | undefined {
		return this.records.get(sessionId);
	}

	listByBot(botId: BotId): readonly SessionRecord[] {
		return [...this.records.values()].filter(
			(record) => record.botId === botId,
		);
	}

	save(record: SessionRecord): void {
		const existing = this.records.get(record.sessionId);
		if (existing && existing.workspace.rootPath !== record.workspace.rootPath) {
			throw new WorkspaceImmutableError(
				`Session ${record.sessionId} workspace cannot change`,
			);
		}
		this.records.set(record.sessionId, record);
	}

	delete(sessionId: SessionId): boolean {
		return this.records.delete(sessionId);
	}
}

export class InMemoryRunRepository implements RunRepository {
	private readonly records = new Map<RunId, RunRecord>();

	get(runId: RunId): RunRecord | undefined {
		return this.records.get(runId);
	}

	listBySession(sessionId: SessionId): readonly RunRecord[] {
		return [...this.records.values()].filter(
			(record) => record.sessionId === sessionId,
		);
	}

	save(record: RunRecord): void {
		this.records.set(record.runId, record);
	}

	updateQueuedInput(runId: RunId, input: string): RunRecord {
		const record = this.records.get(runId);
		if (!record || record.state !== "queued") {
			throw new Error(`Run ${runId} is not queued`);
		}
		const updated = { ...record, input };
		this.records.set(runId, updated);
		return updated;
	}
}

export class InMemoryMemorySource implements MemorySource {
	private readonly entries: { path: string; content: string }[];

	constructor(entries: { path: string; content: string }[] = []) {
		this.entries = entries;
	}

	list(): readonly { path: string; content: string }[] {
		return this.entries;
	}
}

/** Deterministic clock for tests. */
export function createStepClock(start = 1_000): BotClock {
	let now = start;
	return {
		now: () => {
			now += 1;
			return now;
		},
	};
}

/** Deterministic, ordered ID source for tests. */
export function createSequentialIdSource(): BotIdSource {
	let counter = 0;
	const body = () => `test${String((counter += 1)).padStart(6, "0")}`;
	return {
		botId: () => createBotId(body),
		sessionId: () => createSessionId(body),
		runId: () => createRunId(body),
	};
}

interface Deferred<T> {
	promise: Promise<T>;
	resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

export class ManualEngineHandle implements EngineRunHandle {
	readonly invocation: EngineInvocation;
	readonly steers: string[] = [];
	interruptReason: string | undefined;
	interrupted = false;
	aborted = false;
	abortReason: string | undefined;
	private readonly deferred = createDeferred<EngineOutcome>();

	constructor(invocation: EngineInvocation) {
		this.invocation = invocation;
	}

	get result(): Promise<EngineOutcome> {
		return this.deferred.promise;
	}

	steer(text: string): boolean {
		this.steers.push(text);
		return true;
	}

	interrupt(reason?: string): void {
		this.interrupted = true;
		this.interruptReason = reason;
	}

	abort(reason?: string): void {
		this.aborted = true;
		this.abortReason = reason;
	}

	settle(outcome: Partial<EngineOutcome> = {}): void {
		this.deferred.resolve({
			status: outcome.status ?? "completed",
			outputText: outcome.outputText ?? "",
			error: outcome.error,
		});
	}
}

/**
 * Scriptable engine port. By default runs stay pending until the test
 * settles them; set `autoOutcome` to settle each run on a microtask.
 */
export class ManualEnginePort implements EnginePort {
	readonly handles: ManualEngineHandle[] = [];
	autoOutcome?: (invocation: EngineInvocation) => Partial<EngineOutcome>;

	start(invocation: EngineInvocation): EngineRunHandle {
		const handle = new ManualEngineHandle(invocation);
		this.handles.push(handle);
		const auto = this.autoOutcome;
		if (auto) {
			queueMicrotask(() => handle.settle(auto(invocation)));
		}
		return handle;
	}

	get lastHandle(): ManualEngineHandle | undefined {
		return this.handles.at(-1);
	}

	handleFor(runId: string): ManualEngineHandle | undefined {
		return this.handles.find((handle) => handle.invocation.runId === runId);
	}
}

export interface InMemoryBotPorts extends BotPorts {
	bots: InMemoryBotRepository;
	sessions: InMemorySessionRepository;
	runs: InMemoryRunRepository;
	engine: ManualEnginePort;
}

export function createInMemoryPorts(
	options: { engine?: ManualEnginePort; memories?: MemorySource } = {},
): InMemoryBotPorts {
	return {
		clock: createStepClock(),
		ids: createSequentialIdSource(),
		bots: new InMemoryBotRepository(),
		sessions: new InMemorySessionRepository(),
		runs: new InMemoryRunRepository(),
		engine: options.engine ?? new ManualEnginePort(),
		memories: options.memories,
	};
}
