import { existsSync, readFileSync } from "node:fs";
import { CURSOR_SAVE_EVERY_EVENTS } from "../config";
import { writeFileAtomic } from "../store/data-dir";

export type Cursor = { sequence: number; savedAt: number };

export function readCursor(path: string): Cursor | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (typeof raw !== "object" || raw === null) return undefined;
		const { sequence, savedAt } = raw as Record<string, unknown>;
		if (
			typeof sequence !== "number" ||
			!Number.isInteger(sequence) ||
			sequence < 0
		)
			return undefined;
		return { sequence, savedAt: typeof savedAt === "number" ? savedAt : 0 };
	} catch {
		return undefined;
	}
}

/**
 * Persists the fold's last durable-log sequence: every
 * `CURSOR_SAVE_EVERY_EVENTS` advances and on `flush`. Resuming from it needs
 * upstream ask U1 (`sinceSequence` on `NodeHubClient.subscribe`); until then
 * it records how far the fold got, and a cold start rebuilds from commands.
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
		writeFileAtomic(
			this.path,
			`${JSON.stringify({ sequence: this.sequence, savedAt: this.now() } satisfies Cursor)}\n`,
		);
		this.pending = 0;
	}
}
