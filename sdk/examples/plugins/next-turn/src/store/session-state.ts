import { createHash } from "node:crypto";
import {
	existsSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import { join } from "node:path";
import { SESSION_STATE_TTL_MS, SESSION_STATE_VERSION } from "../config";
import type { Suggestion } from "../planner/candidates";
import type { OfferedSet, TrayPush } from "../planner/next";
import type { Turn } from "../planner/turn";
import { writeFileAtomic } from "./data-dir";

/**
 * Per-session state persisted to `<data>/plugins/next-turn/sessions/<hash>.json`
 * so a 30-minute sandbox idle reclaim and respawn preserves the active offerId,
 * the rules/model offers, the pool, the exclusions and the viewer mark.
 */

export type PersistedSessionState = {
	v: typeof SESSION_STATE_VERSION;
	sessionId: string;
	updatedAt: number;
	viewerClient?: string;
	hiddenForChat?: boolean;
	seq: number;
	lastPush?: TrayPush;
	lastTurn?: Turn;
	lastChat?: Turn["chat"];
	shown?: OfferedSet;
	turnState?: {
		turn: Turn;
		rules: Suggestion[];
		pool?: readonly Suggestion[];
		excluded: string[];
		excludedIds: Array<readonly [string, string]>;
		rerollsUsed: number;
		offers: OfferedSet[];
		exposedOffers: string[];
		endedAt: number;
	};
};

export interface SessionStateStore {
	read(): PersistedSessionState | undefined;
	write(
		state: Omit<PersistedSessionState, "v" | "sessionId" | "updatedAt">,
	): void;
	clear(): void;
}

function sessionFileName(sessionId: string): string {
	return `${createHash("sha256").update(sessionId).digest("hex")}.json`;
}

export class FileSessionStateStore implements SessionStateStore {
	private readonly filePath: string;

	constructor(
		dir: string,
		private readonly sessionId: string,
		private readonly now: () => number = Date.now,
	) {
		this.filePath = join(dir, sessionFileName(sessionId));
	}

	read(): PersistedSessionState | undefined {
		if (!existsSync(this.filePath)) return undefined;
		try {
			const parsed = JSON.parse(
				readFileSync(this.filePath, "utf8"),
			) as Partial<PersistedSessionState>;
			if (
				parsed?.v !== SESSION_STATE_VERSION ||
				parsed.sessionId !== this.sessionId
			)
				return undefined;
			if (
				typeof parsed.updatedAt === "number" &&
				this.now() - parsed.updatedAt > SESSION_STATE_TTL_MS
			) {
				this.clear();
				return undefined;
			}
			return parsed as PersistedSessionState;
		} catch {
			return undefined;
		}
	}

	write(
		state: Omit<PersistedSessionState, "v" | "sessionId" | "updatedAt">,
	): void {
		try {
			const record: PersistedSessionState = {
				v: SESSION_STATE_VERSION,
				sessionId: this.sessionId,
				updatedAt: this.now(),
				...state,
			};
			writeFileAtomic(this.filePath, `${JSON.stringify(record)}\n`);
		} catch {}
	}

	clear(): void {
		try {
			rmSync(this.filePath, { force: true });
		} catch {}
	}
}

/** Prunes session state files older than `ttlMs` (14 days by default). */
export function pruneSessionStates(
	dir: string,
	now: number = Date.now(),
	ttlMs: number = SESSION_STATE_TTL_MS,
): void {
	if (!existsSync(dir)) return;
	try {
		for (const name of readdirSync(dir)) {
			if (!name.endsWith(".json")) continue;
			const path = join(dir, name);
			try {
				if (now - statSync(path).mtimeMs > ttlMs) rmSync(path, { force: true });
			} catch {}
		}
	} catch {}
}
