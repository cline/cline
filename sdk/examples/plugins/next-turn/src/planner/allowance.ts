import {
	appendFileSync,
	closeSync,
	fstatSync,
	mkdirSync,
	openSync,
	readSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { resolveClineDataDir } from "@cline/shared/storage";

export const PLANNER_CALLS_PER_HOUR = 20;
const HOUR_MS = 3_600_000;
const LEDGER_TAIL_BYTES = 262_144;
const PRIVATE_FILE_MODE = 0o600;

export type PlannerOutcome =
	| "ok"
	| "timeout"
	| "aborted"
	| "unparseable"
	| "error";

/** One planner call: when it started, how it ended and what the provider reported. No prose, ever. */
export type LedgerLine = {
	sessionId: string;
	at: number;
	outcome?: PlannerOutcome;
	totalMs?: number;
	providerId?: string;
	modelId?: string;
	inputTokens?: number;
	outputTokens?: number;
	costUsd?: number;
};

export interface LedgerStore {
	read(): LedgerLine[];
	append(line: LedgerLine): void;
}

function isLedgerLine(value: unknown): value is LedgerLine {
	return (
		typeof value === "object" &&
		value !== null &&
		"sessionId" in value &&
		typeof value.sessionId === "string" &&
		"at" in value &&
		typeof value.at === "number"
	);
}

/** Read at most the last `maxBytes` of `path`, skipping a partial leading line; blank, torn and foreign lines are ignored. */
function readTail(path: string, maxBytes: number): LedgerLine[] {
	let fd: number | undefined;
	try {
		fd = openSync(path, "r");
		const size = fstatSync(fd).size;
		const length = Math.min(size, maxBytes);
		const buffer = Buffer.alloc(length);
		readSync(fd, buffer, 0, length, size - length);
		let text = buffer.toString("utf8");
		if (size > length) text = text.slice(text.indexOf("\n") + 1);
		return text.split("\n").flatMap((line) => {
			try {
				const parsed: unknown = JSON.parse(line);
				return isLedgerLine(parsed) ? [parsed] : [];
			} catch {
				return [];
			}
		});
	} catch {
		return [];
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

/**
 * The ledger `planner.jsonl` of #15095, as one append-only file every chat's
 * sandbox shares: a line is short and appended whole, so no sandbox loses
 * another's line. It is never rewritten, and its tail bounds what a read costs.
 */
export function fileLedgerStore(path: string): LedgerStore {
	return {
		read: () => readTail(path, LEDGER_TAIL_BYTES),
		append: (line) => {
			try {
				mkdirSync(dirname(path), { recursive: true });
				appendFileSync(path, `${JSON.stringify(line)}\n`, {
					mode: PRIVATE_FILE_MODE,
				});
			} catch {}
		},
	};
}

export function defaultLedgerPath(): string {
	return join(resolveClineDataDir(), "plugins", "next-turn", "planner.jsonl");
}

/** A call on its way out. It counts against the allowance until it is recorded, or released when it never reached a provider. */
export type AllowanceSlot = {
	record(spend: Omit<LedgerLine, "sessionId" | "at">): void;
	release(): void;
};

/** A chat may make `callsPerHour` planner calls in any rolling hour. */
export class Allowance {
	private readonly sessions = new Map<string, LedgerLine[]>();

	constructor(
		private readonly store: LedgerStore,
		private readonly callsPerHour: number = PLANNER_CALLS_PER_HOUR,
		private readonly now: () => number = Date.now,
	) {}

	/** Holds one of the session's calls, or undefined when the hour's allowance is used. A call still in flight already counts. */
	reserve(sessionId: string): AllowanceSlot | undefined {
		const calls = this.callsOf(sessionId);
		const since = this.now() - HOUR_MS;
		if (calls.filter((call) => call.at > since).length >= this.callsPerHour)
			return undefined;
		const held: LedgerLine = { sessionId, at: this.now() };
		calls.push(held);
		return {
			record: (spend) => {
				this.store.append({ ...held, ...spend });
			},
			release: () => {
				const index = calls.indexOf(held);
				if (index !== -1) calls.splice(index, 1);
			},
		};
	}

	/** Seeded once from the tail of the ledger, then kept in memory. */
	private callsOf(sessionId: string): LedgerLine[] {
		const cached = this.sessions.get(sessionId);
		if (cached) return cached;
		const loaded = this.store
			.read()
			.filter((call) => call.sessionId === sessionId);
		this.sessions.set(sessionId, loaded);
		return loaded;
	}
}
