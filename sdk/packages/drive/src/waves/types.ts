/** Domain model for the Drive wave parallel orchestration layer. */

export type DriveWorkStatus =
	| "pending"
	| "running"
	| "succeeded"
	| "failed"
	| "cancelled"
	| "skipped";

export type DriveWaveStatus =
	| "success"
	| "failure"
	| "partial"
	| "paused"
	| "aborted"
	| "skipped";

export type DriveReviewKind = "pre" | "post" | "emergency";

export type DriveReviewAction =
	| "continue"
	| "pause"
	| "abort"
	| "redirect"
	| "inject";

export type DriveWorkItem = {
	id: string;
	kind: string;
	payload: Record<string, unknown>;
	/** Task ids that must succeed before this task may run. */
	dependsOn: string[];
	priority: number;
	status: DriveWorkStatus;
	attempts: number;
	error?: string;
	result?: Record<string, unknown>;
	/** Tasks spawned by this task during execution. */
	spawnedIds: string[];
	createdAt: string;
	updatedAt: string;
};

export type DriveWorkInput = {
	id?: string;
	kind: string;
	payload?: Record<string, unknown>;
	dependsOn?: string[];
	priority?: number;
};

export type DriveReviewDecision = {
	action: DriveReviewAction;
	reason?: string;
	/** When action is inject, tasks to enqueue for the next wave. */
	inject?: DriveWorkInput[];
	/** When action is redirect, replace remaining pending work with these. */
	redirect?: DriveWorkInput[];
};

export type DriveReviewContext = {
	kind: DriveReviewKind;
	wave: number;
	tasks: readonly DriveWorkItem[];
	scratch: ReadonlyMap<string, unknown>;
	workMailbox: readonly DriveWorkMessage[];
};

export type DriveReviewGate = {
	name: string;
	kinds: readonly DriveReviewKind[];
	evaluate: (ctx: DriveReviewContext) => DriveReviewDecision | Promise<DriveReviewDecision>;
};

export type DriveWorkMessage = {
	id: string;
	from: string;
	to: string | "*";
	topic: string;
	body: Record<string, unknown>;
	createdAt: string;
};

export type DriveWaveCheckpoint = {
	id: string;
	waveRunId: string;
	wave: number;
	tasks: DriveWorkItem[];
	scratch: Record<string, unknown>;
	workMailbox: DriveWorkMessage[];
	createdAt: string;
};

export type DriveWaveLogEntry = {
	at: string;
	level: "info" | "warn" | "error";
	message: string;
	data?: Record<string, unknown>;
};

export type DriveWaveResult = {
	status: DriveWaveStatus;
	waveRunId: string;
	wave: number;
	tasks: DriveWorkItem[];
	logs: DriveWaveLogEntry[];
	errors: string[];
	metadata: Record<string, unknown>;
	message: string;
	readonly success: boolean;
	readonly failed: boolean;
};

export type AdaptiveConcurrencyConfig = {
	/** Starting concurrency window. */
	initial: number;
	/** Floor for concurrency. */
	min: number;
	/** Ceiling for concurrency. */
	max: number;
	/** Additive increase per successful window. */
	increase: number;
	/** Multiplicative decrease factor on failure / rate limit. */
	decrease: number;
};

export type TokenQueueConfig = {
	/** Max starts per interval. */
	maxPerInterval: number;
	/** Interval length in ms. */
	intervalMs: number;
};

export type DriveWorkInvocation = {
	task: DriveWorkItem;
	scratch: ReadonlyMap<string, unknown>;
	workMailbox: readonly DriveWorkMessage[];
	signal?: AbortSignal;
};

export type DriveWorkOutcome = {
	ok: boolean;
	result?: Record<string, unknown>;
	error?: string;
	/** Dynamic work discovered during the task. */
	spawn?: DriveWorkInput[];
	/** Scratch writes (last-write-wins per key). */
	scratchWrites?: Record<string, unknown>;
	/** Outbound worker messages. */
	messages?: Array<Omit<DriveWorkMessage, "id" | "createdAt" | "from"> & { from?: string }>;
};

/** Host port: run one wave task. Core stays free of agent/session deps. */
export type DriveWorkExecutor = {
	runTask: (invocation: DriveWorkInvocation) => Promise<DriveWorkOutcome>;
};

export type DriveWaveRunnerOptions = {
	waveRunId?: string;
	host: DriveWorkExecutor;
	gates?: DriveReviewGate[];
	concurrency?: Partial<AdaptiveConcurrencyConfig>;
	tokenQueue?: Partial<TokenQueueConfig>;
	/** Hard stop after this many waves. */
	maxWaves?: number;
	/** Persist checkpoints through this port when provided. */
	checkpointStore?: DriveWaveCheckpointStore;
	signal?: AbortSignal;
};

export type DriveWaveCheckpointStore = {
	save: (checkpoint: DriveWaveCheckpoint) => Promise<void> | void;
	load: (waveRunId: string) => Promise<DriveWaveCheckpoint | null> | DriveWaveCheckpoint | null;
};

export function nowIso(): string {
	return new Date().toISOString();
}

export function newId(prefix: string): string {
	return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function createDriveWaveResult(input: {
	status: DriveWaveStatus;
	waveRunId: string;
	wave: number;
	tasks: DriveWorkItem[];
	logs?: DriveWaveLogEntry[];
	errors?: string[];
	metadata?: Record<string, unknown>;
	message: string;
}): DriveWaveResult {
	const status = input.status;
	return {
		status,
		waveRunId: input.waveRunId,
		wave: input.wave,
		tasks: input.tasks,
		logs: input.logs ?? [],
		errors: input.errors ?? [],
		metadata: input.metadata ?? {},
		message: input.message,
		get success() {
			return status === "success";
		},
		get failed() {
			return status === "failure" || status === "aborted";
		},
	};
}

export function createWorkItem(input: DriveWorkInput): DriveWorkItem {
	const at = nowIso();
	return {
		id: input.id ?? newId("work"),
		kind: input.kind,
		payload: input.payload ?? {},
		dependsOn: input.dependsOn ?? [],
		priority: input.priority ?? 0,
		status: "pending",
		attempts: 0,
		spawnedIds: [],
		createdAt: at,
		updatedAt: at,
	};
}
