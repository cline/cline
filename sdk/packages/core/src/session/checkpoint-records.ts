import type { SessionRecord } from "../types/sessions";

/**
 * Checkpoint bookkeeping stored in a session's `metadata.checkpoint`. Each
 * root run (user turn) ends with at most one recorded outcome: a checkpoint
 * entry, or a failure explaining why no checkpoint was taken. Everything here
 * is pure data handling, so hooks, restore planning and hosts share one
 * reading of the records.
 */

export interface CheckpointEntry {
	ref: string;
	createdAt: number;
	runCount: number;
	kind?: "stash" | "commit";
}

/**
 * Why a run has no checkpoint. `errorMessage` is written for the user and
 * shown as-is by hosts, so new causes and rewording need no host changes.
 */
export interface CheckpointFailure {
	runCount: number;
	createdAt: number;
	errorMessage: string;
}

export interface CheckpointMetadata {
	/** The most recent checkpoint; absent when every recorded run failed. */
	latest?: CheckpointEntry;
	history: CheckpointEntry[];
	failures?: CheckpointFailure[];
}

/**
 * The outcome recorded for one run. `unrecorded` covers runs from before
 * failures were recorded and runs started while checkpoints were disabled.
 */
export type RunCheckpoint =
	| { status: "available"; checkpoint: CheckpointEntry }
	| { status: "failed"; errorMessage: string }
	| { status: "unrecorded" };

/** Long sessions in unsupported workspaces fail every turn; keep the newest. */
const MAX_CHECKPOINT_FAILURES = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function readRunCount(value: unknown): number | undefined {
	const runCount = Number(value ?? 0);
	return Number.isInteger(runCount) && runCount >= 1 ? runCount : undefined;
}

function readEntry(value: unknown): CheckpointEntry | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const ref = String(value.ref ?? "").trim();
	const createdAt = Number(value.createdAt ?? 0);
	const runCount = readRunCount(value.runCount);
	if (!ref || !Number.isFinite(createdAt) || runCount === undefined) {
		return undefined;
	}
	const kind =
		value.kind === "stash" || value.kind === "commit" ? value.kind : undefined;
	return { ref, createdAt, runCount, ...(kind ? { kind } : {}) };
}

function readFailure(value: unknown): CheckpointFailure | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const createdAt = Number(value.createdAt ?? 0);
	const runCount = readRunCount(value.runCount);
	const errorMessage =
		typeof value.errorMessage === "string" ? value.errorMessage.trim() : "";
	if (!errorMessage || !Number.isFinite(createdAt) || runCount === undefined) {
		return undefined;
	}
	return { runCount, createdAt, errorMessage };
}

function withOptionalFields(
	history: CheckpointEntry[],
	failures: CheckpointFailure[],
	latest: CheckpointEntry | undefined = history.at(-1),
): CheckpointMetadata {
	return {
		...(latest ? { latest } : {}),
		history,
		...(failures.length > 0 ? { failures } : {}),
	};
}

/**
 * Reads checkpoint bookkeeping from session metadata. Tolerant of malformed
 * or older records: invalid entries are dropped and missing lists are empty.
 */
export function readCheckpointMetadata(
	metadata: Record<string, unknown> | undefined,
): CheckpointMetadata {
	const checkpoint = isRecord(metadata?.checkpoint)
		? metadata.checkpoint
		: undefined;
	const history = (
		Array.isArray(checkpoint?.history) ? checkpoint.history : []
	).flatMap((entry) => readEntry(entry) ?? []);
	const failures = (
		Array.isArray(checkpoint?.failures) ? checkpoint.failures : []
	).flatMap((failure) => readFailure(failure) ?? []);
	return withOptionalFields(history, failures, readEntry(checkpoint?.latest));
}

export function readSessionCheckpointHistory(
	session: Pick<SessionRecord, "metadata"> | undefined,
): CheckpointEntry[] {
	return readCheckpointMetadata(session?.metadata).history;
}

export function findCheckpointForRun(
	history: readonly CheckpointEntry[],
	runCount: number,
): CheckpointEntry | undefined {
	return history.reduce<CheckpointEntry | undefined>((best, entry) => {
		if (entry.runCount > runCount) {
			return best;
		}
		if (!best || entry.runCount > best.runCount) {
			return entry;
		}
		return best;
	}, undefined);
}

/** Whether any outcome, checkpoint or failure, is recorded for the run. */
export function hasRecordedCheckpointOutcome(
	metadata: CheckpointMetadata,
	runCount: number,
): boolean {
	return (
		metadata.history.some((entry) => entry.runCount === runCount) ||
		(metadata.failures ?? []).some((failure) => failure.runCount === runCount)
	);
}

/**
 * What restoring the workspace to the start of `runCount` would use. A
 * failure recorded for that run means the workspace was never snapshotted
 * there, so an older checkpoint must not stand in for it. Runs without a
 * record fall back to the nearest earlier checkpoint, as they always have.
 */
export function resolveRunCheckpoint(
	session: Pick<SessionRecord, "metadata"> | undefined,
	runCount: number,
): RunCheckpoint {
	const { history, failures } = readCheckpointMetadata(session?.metadata);
	const failure = failures?.find((record) => record.runCount === runCount);
	if (failure) {
		return { status: "failed", errorMessage: failure.errorMessage };
	}
	const checkpoint = findCheckpointForRun(history, runCount);
	return checkpoint
		? { status: "available", checkpoint }
		: { status: "unrecorded" };
}

function byRunCount(a: { runCount: number }, b: { runCount: number }): number {
	return a.runCount - b.runCount;
}

/** Records a checkpoint for its run, replacing any earlier outcome for it. */
export function recordCheckpointEntry(
	metadata: CheckpointMetadata,
	entry: CheckpointEntry,
): CheckpointMetadata {
	const history = [
		...metadata.history.filter((other) => other.runCount !== entry.runCount),
		entry,
	].sort(byRunCount);
	const failures = (metadata.failures ?? []).filter(
		(failure) => failure.runCount !== entry.runCount,
	);
	return withOptionalFields(history, failures, entry);
}

/** Records a failure for its run, replacing any earlier outcome for it. */
export function recordCheckpointFailure(
	metadata: CheckpointMetadata,
	failure: CheckpointFailure,
): CheckpointMetadata {
	const history = metadata.history.filter(
		(entry) => entry.runCount !== failure.runCount,
	);
	const failures = [
		...(metadata.failures ?? []).filter(
			(other) => other.runCount !== failure.runCount,
		),
		failure,
	]
		.sort(byRunCount)
		.slice(-MAX_CHECKPOINT_FAILURES);
	return withOptionalFields(history, failures);
}

/**
 * The bookkeeping a session restored to `runCount` inherits: every outcome up
 * to and including that run, so earlier messages keep both their checkpoints
 * and their explanations.
 */
export function createRestoredCheckpointMetadata(
	session: Pick<SessionRecord, "metadata"> | undefined,
	runCount: number,
): CheckpointMetadata | undefined {
	const current = readCheckpointMetadata(session?.metadata);
	const history = current.history.filter((entry) => entry.runCount <= runCount);
	const failures = (current.failures ?? []).filter(
		(failure) => failure.runCount <= runCount,
	);
	return history.length === 0 && failures.length === 0
		? undefined
		: withOptionalFields(history, failures);
}
