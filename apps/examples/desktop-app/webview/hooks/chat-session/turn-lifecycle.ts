import type { ChatSessionStatus } from "@/lib/chat-schema";

/**
 * Opaque handle identifying a moment in the turn lifecycle. Async work
 * (RPC responses, reconciliation fetches) captures a token when it starts
 * and hands it back when it finishes; the lifecycle decides whether the
 * world has moved on in between.
 */
export type TurnToken = number;

/**
 * The single writer for a chat session's status.
 *
 * The webview learns about turn state from several channels with no total
 * order: local submit flow, send-RPC responses, the chat event stream
 * (`chat_queued_prompt_start` / `chat_done`), hub status projections
 * (`chat_session_status`), and async queue reconciliation. Any of them can
 * deliver a stale signal. Rather than letting each handler write status
 * directly and guard against the others, all writes go through this
 * lifecycle, which enforces two rules:
 *
 * 1. A settled turn cannot be reopened. Once a turn reaches a terminal
 *    status, a stale "running" (a hub projection trailing `chat_done`, or
 *    a queued-send acknowledgement that lost the race with the drain) is
 *    dropped. Only evidence of a NEW turn — a local dispatch or the
 *    runtime consuming a prompt — lifts the absorption.
 * 2. Async work is only trusted while it is current. Anything that changes
 *    what a queue snapshot or busy-check means (a new dispatch, a queued
 *    submission, the runtime starting a turn, a session switch) advances
 *    the lifecycle, and results captured before that are ignored via
 *    `isCurrent`.
 */
export interface TurnLifecycle {
	/**
	 * A locally dispatched prompt is starting a new turn. Marks the session
	 * "starting" and returns a token identifying the dispatch.
	 */
	begin(): TurnToken;
	/**
	 * A prompt was submitted to the queue while a turn is in flight. Does
	 * not change status, but async checks captured before this point are
	 * now stale (their snapshots predate the new queue entry).
	 */
	noteQueuedSubmission(): void;
	/**
	 * The runtime started consuming a prompt (`chat_queued_prompt_start`) —
	 * the authoritative start of a turn. Marks the session "running".
	 */
	turnStarted(): void;
	/** The current turn reached a terminal status. Absorbs stale reopens. */
	settle(status: ChatSessionStatus): void;
	/**
	 * Settle only if the turn is still marked running. Used by async
	 * reconciliation that must not clobber a status decided elsewhere
	 * (e.g. a failure) while its request was in flight.
	 */
	settleIfRunning(status: ChatSessionStatus): void;
	/**
	 * A hub-projected session status. Projections are asynchronous and can
	 * trail the chat stream, so a "running" that would reopen a settled
	 * turn is dropped; everything else applies.
	 */
	projectStatus(status: ChatSessionStatus): void;
	/**
	 * Plain status write for the local UI flow ("starting" before a
	 * dispatch, "stopping" during abort, error states). No lifecycle
	 * semantics: does not start, settle, or invalidate anything.
	 */
	apply(status: ChatSessionStatus): void;
	/**
	 * The session context changed (new/reset/hydrated/restored session).
	 * Starts a fresh lifecycle era: outstanding tokens become stale and a
	 * previous turn's settled state no longer absorbs anything.
	 */
	reset(status: ChatSessionStatus): void;
	/** Capture a token for async work started now. */
	token(): TurnToken;
	/** Whether the lifecycle is unchanged since the token was captured. */
	isCurrent(token: TurnToken): boolean;
}

export function createTurnLifecycle(
	onStatusChange: (status: ChatSessionStatus) => void,
): TurnLifecycle {
	// Advances whenever the meaning of in-flight async work changes.
	let version: TurnToken = 0;
	// The version at which the current turn settled, or null while the
	// turn is live (or after a new turn started). While non-null and equal
	// to `version`, busy signals are stale by definition.
	let settledAtVersion: TurnToken | null = null;
	let status: ChatSessionStatus = "idle";

	const write = (next: ChatSessionStatus) => {
		status = next;
		onStatusChange(next);
	};

	const isSettled = () => settledAtVersion === version;

	return {
		begin() {
			version += 1;
			settledAtVersion = null;
			write("starting");
			return version;
		},
		noteQueuedSubmission() {
			version += 1;
			settledAtVersion = null;
		},
		turnStarted() {
			version += 1;
			settledAtVersion = null;
			write("running");
		},
		settle(next) {
			settledAtVersion = version;
			write(next);
		},
		settleIfRunning(next) {
			if (status !== "running") {
				return;
			}
			settledAtVersion = version;
			write(next);
		},
		projectStatus(next) {
			if (next === "running" && isSettled()) {
				return;
			}
			write(next);
		},
		apply(next) {
			write(next);
		},
		reset(next) {
			version += 1;
			settledAtVersion = null;
			write(next);
		},
		token() {
			return version;
		},
		isCurrent(token) {
			return token === version;
		},
	};
}
