import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { HOUR_MS, PLANNER_LEDGER_TAIL_BYTES } from "../config";
import { appendJsonLine } from "../store/data-dir";
import { isRecord, num } from "../values";

/**
 * The planner's own spend and the per-chat allowance.
 *
 * A planner call is a separate model call, so its cost is not in the
 * session's usage. Each call is appended to a JSONL ledger. Every chat's
 * sandbox appends to the same file; lines are short and appends do not
 * rewrite, so no sandbox can lose another's line.
 *
 * When a chat has used its allowance its sets are served paused; the
 * rule-based set keeps working, because it costs nothing.
 */

export type PlannerCall = {
	sessionId: string;
	at: number;
	costUsd?: number;
	providerId?: string;
	modelId?: string;
};

function isCall(value: unknown): value is PlannerCall {
	return (
		isRecord(value) &&
		typeof value.sessionId === "string" &&
		num(value.at) !== undefined &&
		(value.costUsd === undefined || num(value.costUsd) !== undefined) &&
		(value.providerId === undefined || typeof value.providerId === "string") &&
		(value.modelId === undefined || typeof value.modelId === "string")
	);
}

/** Parse a ledger; blank, torn or foreign lines are skipped. */
export function parseLedger(text: string): PlannerCall[] {
	const calls: PlannerCall[] = [];
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		try {
			const parsed: unknown = JSON.parse(line);
			if (isCall(parsed)) calls.push(parsed);
		} catch {}
	}
	return calls;
}

/** Read at most the last `maxBytes` of `path`, skipping a partial leading line when the file is larger. */
export function readLedgerTail(
	path: string,
	maxBytes: number = PLANNER_LEDGER_TAIL_BYTES,
): PlannerCall[] {
	let fd: number | undefined;
	try {
		fd = openSync(path, "r");
		const size = fstatSync(fd).size;
		if (size <= 0) return [];
		const length = Math.min(size, maxBytes);
		const offset = size - length;
		const buffer = Buffer.allocUnsafe(length);
		const bytesRead = readSync(fd, buffer, 0, length, offset);
		let text = buffer.subarray(0, bytesRead).toString("utf8");
		if (offset > 0) {
			const newline = text.indexOf("\n");
			text = newline === -1 ? "" : text.slice(newline + 1);
		}
		return parseLedger(text);
	} catch {
		return [];
	} finally {
		if (fd !== undefined) {
			try {
				closeSync(fd);
			} catch {}
		}
	}
}

type PlannerSpend = Omit<PlannerCall, "sessionId" | "at">;

/** A call on its way out. It counts against the allowance until it is recorded, or released when it never reached a provider. */
export type PlannerCallSlot = {
	record(spend?: PlannerSpend): void;
	release(): void;
};

export class PlannerLedger {
	private readonly sessionCalls = new Map<string, PlannerCall[]>();

	constructor(
		private readonly path: string,
		private readonly now: () => number = Date.now,
		private readonly tailBytes: number = PLANNER_LEDGER_TAIL_BYTES,
	) {}

	record(sessionId: string, spend: PlannerSpend = {}): void {
		const call: PlannerCall = { sessionId, at: this.now(), ...spend };
		appendJsonLine(this.path, call);
		this.sessionCalls.get(sessionId)?.push(call);
	}

	/** Holds one of the session's calls before it is sent, so a call still in flight already counts. */
	reserve(sessionId: string): PlannerCallSlot {
		const calls = this.calls(sessionId);
		const held: PlannerCall = { sessionId, at: this.now() };
		calls.push(held);
		const release = () => {
			const index = calls.indexOf(held);
			if (index !== -1) calls.splice(index, 1);
		};
		return {
			record: (spend) => {
				release();
				this.record(sessionId, spend);
			},
			release,
		};
	}

	/** Calls for one session, seeded once from the tail of the ledger file and maintained in memory. */
	callsForSession(sessionId: string): readonly PlannerCall[] {
		return this.calls(sessionId);
	}

	private calls(sessionId: string): PlannerCall[] {
		const cached = this.sessionCalls.get(sessionId);
		if (cached) return cached;
		const loaded = readLedgerTail(this.path, this.tailBytes).filter(
			(call) => call.sessionId === sessionId,
		);
		this.sessionCalls.set(sessionId, loaded);
		return loaded;
	}
}

/** A chat may make `callsPerHour` planner calls in any rolling hour; once it has, the oldest call in that hour sets when the next is allowed. */
export function pausedUntil(
	calls: readonly PlannerCall[],
	callsPerHour: number,
	now: number,
): number | undefined {
	const recent = calls
		.map((call) => call.at)
		.filter((at) => at > now - HOUR_MS && at <= now)
		.sort((a, b) => a - b);
	if (recent.length < callsPerHour) return undefined;
	return (recent[recent.length - callsPerHour] ?? now) + HOUR_MS;
}
