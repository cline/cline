/**
 * Test doubles and helpers for Phase 3 tests. Exported as
 * `@cline/gateway/test-support` so application test harnesses (e.g. the
 * Gateway Desktop validation app) can run a REAL Gateway against a
 * scripted engine. Never imported by production code.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	EngineInvocation,
	EngineOutcome,
	EnginePort,
	EngineRunHandle,
} from "@cline/bot";

export function tempDataRoot(prefix = "clinegate-test-"): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

export async function waitFor(
	predicate: () => boolean | Promise<boolean>,
	options: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<void> {
	const timeoutMs = options.timeoutMs ?? 5_000;
	const intervalMs = options.intervalMs ?? 10;
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if (await predicate()) {
			return;
		}
		if (Date.now() > deadline) {
			throw new Error(`waitFor timed out: ${options.label ?? "condition"}`);
		}
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
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

/**
 * Scriptable engine handle: tests emit engine events and settle outcomes
 * explicitly; interrupt/abort settle cooperatively by default so graceful
 * paths terminate.
 */
export class ScriptedHandle implements EngineRunHandle {
	readonly invocation: EngineInvocation;
	readonly steers: string[] = [];
	interrupted = false;
	aborted = false;
	settled = false;
	private readonly deferred = createDeferred<EngineOutcome>();
	private readonly listeners = new Set<(event: unknown) => void>();
	settleOnStop = true;

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
		if (this.settleOnStop) {
			this.settle({
				status: "interrupted",
				error: reason ? { name: "Interrupted", message: reason } : undefined,
			});
		}
	}

	abort(reason?: string): void {
		this.aborted = true;
		if (this.settleOnStop) {
			this.settle({
				status: "aborted",
				error: reason ? { name: "Aborted", message: reason } : undefined,
			});
		}
	}

	subscribe(listener: (event: unknown) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	emit(event: unknown): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}

	settle(outcome: Partial<EngineOutcome> = {}): void {
		if (this.settled) {
			return;
		}
		this.settled = true;
		this.deferred.resolve({
			status: outcome.status ?? "completed",
			outputText: outcome.outputText ?? "",
			error: outcome.error,
		});
	}
}

/** Scriptable engine port that records every started run. */
export class ScriptedEnginePort implements EnginePort {
	readonly handles: ScriptedHandle[] = [];
	/** When set, each run settles on a microtask with this outcome. */
	autoOutcome?: (
		invocation: EngineInvocation,
		attemptIndex: number,
	) => Partial<EngineOutcome> | undefined;
	onStart?: (handle: ScriptedHandle) => void;

	start(invocation: EngineInvocation): EngineRunHandle {
		const handle = new ScriptedHandle(invocation);
		const attemptIndex = this.handles.filter(
			(existing) => existing.invocation.runId === invocation.runId,
		).length;
		this.handles.push(handle);
		this.onStart?.(handle);
		const auto = this.autoOutcome;
		if (auto) {
			queueMicrotask(() => {
				const outcome = auto(invocation, attemptIndex);
				if (outcome) {
					handle.settle(outcome);
				}
			});
		}
		return handle;
	}

	get lastHandle(): ScriptedHandle | undefined {
		return this.handles.at(-1);
	}

	handlesFor(runId: string): ScriptedHandle[] {
		return this.handles.filter((handle) => handle.invocation.runId === runId);
	}
}
