import { existsSync } from "node:fs";
import { CURSOR_SAVE_EVERY_EVENTS } from "../config";
import { readJsonFile, writeFileAtomic } from "../store/data-dir";
import { isRecord } from "../values";

export type Cursor = { sequence: number; savedAt: number };

export function readCursor(path: string): Cursor | undefined {
	const raw = readJsonFile(path);
	if (!isRecord(raw)) return undefined;
	const { sequence, savedAt } = raw;
	if (
		typeof sequence !== "number" ||
		!Number.isInteger(sequence) ||
		sequence < 0
	)
		return undefined;
	return { sequence, savedAt: typeof savedAt === "number" ? savedAt : 0 };
}

/**
 * Persists the fold's last durable-log sequence: every
 * `CURSOR_SAVE_EVERY_EVENTS` advances and on `flush`. A new `NodeHubClient`
 * cannot subscribe from a past sequence, so nothing resumes from it yet: it
 * records how far the fold got, and a cold start rebuilds from commands.
 */
export class CursorWriter {
	private pending = 0;
	private sequence: number;

	constructor(
		private readonly path: string,
		initial: number = readCursor(path)?.sequence ?? 0,
		private readonly now: () => number = Date.now,
	) {
		this.sequence = initial;
	}

	current(): number {
		return this.sequence;
	}

	advance(sequence: number): void {
		if (sequence <= this.sequence) return;
		this.sequence = sequence;
		this.pending += 1;
		if (this.pending >= CURSOR_SAVE_EVERY_EVENTS) this.flush();
	}

	flush(): void {
		if (this.pending === 0 && existsSync(this.path)) return;
		try {
			writeFileAtomic(
				this.path,
				`${JSON.stringify({ sequence: this.sequence, savedAt: this.now() } satisfies Cursor)}\n`,
			);
		} catch {}
		this.pending = 0;
	}
}
