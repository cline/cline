import {
	appendFileSync,
	closeSync,
	fstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	readSync,
} from "node:fs";
import { dirname } from "node:path";
import {
	PLANNER_ALLOWANCE_WINDOW_MS,
	PLANNER_LEDGER_TAIL_BYTES,
	PRIVATE_FILE_MODE,
} from "../config";

/**
 * The planner's own spend and the per-chat allowance.
 *
 * A planner call is a separate model call, so its cost is not in the
 * session's usage. Each call is appended to a JSONL ledger. Every chat's
 * sandbox appends to the same file; lines are short and appends do not
 * rewrite, so no sandbox can lose another's line.
 *
 * When a chat has used its allowance the tray shows 06's Unavailable state
 * ("Suggestions paused for this chat — it has used its allowance"). The
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
	if (typeof value !== "object" || value === null) return false;
	const call = value as Record<string, unknown>;
	return (
		typeof call.sessionId === "string" &&
		typeof call.at === "number" &&
		Number.isFinite(call.at) &&
		(call.costUsd === undefined ||
			(typeof call.costUsd === "number" && Number.isFinite(call.costUsd))) &&
		(call.providerId === undefined || typeof call.providerId === "string") &&
		(call.modelId === undefined || typeof call.modelId === "string")
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

export class PlannerLedger {
	private readonly sessionCalls = new Map<string, PlannerCall[]>();

	constructor(
		private readonly path: string,
		private readonly now: () => number = Date.now,
		private readonly tailBytes: number = PLANNER_LEDGER_TAIL_BYTES,
	) {}

	record(
		sessionId: string,
		costUsd?: number,
		model?: { providerId?: string; modelId?: string },
	): PlannerCall {
		const call: PlannerCall = {
			sessionId,
			at: this.now(),
			...(costUsd === undefined ? {} : { costUsd }),
			...(model?.providerId ? { providerId: model.providerId } : {}),
			...(model?.modelId ? { modelId: model.modelId } : {}),
		};
		mkdirSync(dirname(this.path), { recursive: true });
		appendFileSync(this.path, `${JSON.stringify(call)}\n`, {
			mode: PRIVATE_FILE_MODE,
		});
		const cached = this.sessionCalls.get(sessionId);
		if (cached) cached.push(call);
		return call;
	}

	/** Calls for one session, seeded once from the tail of the ledger file and maintained in memory. */
	callsForSession(sessionId: string): readonly PlannerCall[] {
		const cached = this.sessionCalls.get(sessionId);
		if (cached) return cached;
		const loaded = readLedgerTail(this.path, this.tailBytes).filter(
			(call) => call.sessionId === sessionId,
		);
		this.sessionCalls.set(sessionId, loaded);
		return loaded;
	}

	calls(): PlannerCall[] {
		try {
			return parseLedger(readFileSync(this.path, "utf8"));
		} catch {
			return [];
		}
	}
}

export type AllowanceState =
	| { kind: "available"; remaining: number }
	| { kind: "used"; resetsAt: number };

/** A chat may make `callsPerHour` planner calls in any rolling window; the oldest call in it sets when the next is allowed. */
export function allowance(
	calls: readonly PlannerCall[],
	sessionId: string,
	callsPerHour: number,
	now: number,
	windowMs: number = PLANNER_ALLOWANCE_WINDOW_MS,
): AllowanceState {
	const recent = calls
		.filter(
			(call) =>
				call.sessionId === sessionId &&
				call.at > now - windowMs &&
				call.at <= now,
		)
		.map((call) => call.at)
		.sort((a, b) => a - b);
	if (recent.length < callsPerHour)
		return { kind: "available", remaining: callsPerHour - recent.length };
	const oldestCounted = recent[recent.length - callsPerHour] ?? now;
	return { kind: "used", resetsAt: oldestCounted + windowMs };
}

export type Spend = { calls: number; costUsd: number };

/** Planner spend per UTC day (`YYYY-MM-DD`), optionally for one chat. */
export function spendByDay(
	calls: readonly PlannerCall[],
	sessionId?: string,
): Record<string, Spend> {
	const days: Record<string, Spend> = {};
	for (const call of calls) {
		if (sessionId && call.sessionId !== sessionId) continue;
		const day = new Date(call.at).toISOString().slice(0, "YYYY-MM-DD".length);
		const spend = days[day] ?? { calls: 0, costUsd: 0 };
		days[day] = {
			calls: spend.calls + 1,
			costUsd: spend.costUsd + (call.costUsd ?? 0),
		};
	}
	return days;
}
