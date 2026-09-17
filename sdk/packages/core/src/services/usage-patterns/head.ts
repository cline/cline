import { closeSync, openSync, readSync } from "node:fs";

const INITIAL_READ_BYTES = 16 * 1024;
const NEWLINE = 0x0a;

export interface HeadReadOptions {
	/** Hard cap on bytes read from the start of the file. */
	maxBytes: number;
	/**
	 * Lines longer than this are skipped without being decoded or parsed: in a
	 * session store they are message bodies, never the metadata lines.
	 */
	maxLineBytes: number;
	/** Called for each parsed line; returning true stops the read after it. */
	until?: (line: Record<string, unknown>) => boolean;
	stats?: HeadReadStats;
}

export interface HeadReadStats {
	bytesRead: number;
	linesParsed: number;
	/** Lines too long to parse, including one cut off by the byte budget. */
	linesSkipped: number;
	/** The read stopped at the budget rather than at a line or end of file. */
	budgetExhausted: boolean;
}

export function createHeadReadStats(): HeadReadStats {
	return {
		bytesRead: 0,
		linesParsed: 0,
		linesSkipped: 0,
		budgetExhausted: false,
	};
}

/**
 * Parse the leading JSONL lines of a session file on a fixed byte budget.
 *
 * Session files grow to gigabytes and their early lines hold prompts and tool
 * output, so the budget is total bytes read — not a chunk size — and the read
 * stops at the first line the caller was looking for. Returns the parsed lines
 * up to and including that one.
 */
export function readHead(
	file: string,
	options: HeadReadOptions,
): Record<string, unknown>[] {
	const stats = options.stats;
	const lines: Record<string, unknown>[] = [];
	let descriptor: number;
	try {
		descriptor = openSync(file, "r");
	} catch {
		return lines;
	}
	try {
		let buffer = Buffer.allocUnsafe(
			Math.min(INITIAL_READ_BYTES, options.maxBytes),
		);
		let filled = 0;
		let lineStart = 0;
		let scanFrom = 0;

		// Returns true when the caller asked to stop.
		const consume = (start: number, end: number): boolean => {
			if (end - start > options.maxLineBytes) {
				if (stats) stats.linesSkipped += 1;
				return false;
			}
			const text = buffer.toString("utf8", start, end).trim();
			if (!text) return false;
			let parsed: unknown;
			try {
				parsed = JSON.parse(text);
			} catch {
				return false;
			}
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				return false;
			}
			if (stats) stats.linesParsed += 1;
			const line = parsed as Record<string, unknown>;
			lines.push(line);
			return options.until?.(line) ?? false;
		};

		for (;;) {
			if (filled === buffer.length) {
				if (buffer.length >= options.maxBytes) {
					if (stats) {
						stats.budgetExhausted = true;
						// A line still open at the budget is longer than anything parsed.
						if (lineStart < filled) stats.linesSkipped += 1;
					}
					return lines;
				}
				const grown = Buffer.allocUnsafe(
					Math.min(options.maxBytes, buffer.length * 2),
				);
				buffer.copy(grown, 0, 0, filled);
				buffer = grown;
			}
			const read = readSync(
				descriptor,
				buffer,
				filled,
				buffer.length - filled,
				filled,
			);
			if (read <= 0) {
				// End of file: whatever is left is a complete last line.
				if (lineStart < filled) consume(lineStart, filled);
				return lines;
			}
			if (stats) stats.bytesRead += read;
			filled += read;
			for (;;) {
				const newline = buffer.indexOf(NEWLINE, scanFrom);
				if (newline < 0 || newline >= filled) {
					scanFrom = filled;
					break;
				}
				if (consume(lineStart, newline)) return lines;
				lineStart = newline + 1;
				scanFrom = lineStart;
			}
		}
	} finally {
		closeSync(descriptor);
	}
}

interface HeadCacheEntry {
	size: number;
	mtimeMs: number;
	generation: number;
	value: unknown;
}

/** Scans a file must go unseen for before its entry is dropped. */
const RETAINED_GENERATIONS = 3;

/**
 * Per-file head results keyed by size and mtime, so a refresh only re-reads
 * files that changed since the previous scan.
 */
export class HeadCache {
	private readonly entries = new Map<string, HeadCacheEntry>();
	private generation = 0;

	/** Starts a scan; entries left unseen for several scans are dropped. */
	beginScan(): void {
		this.generation += 1;
		for (const [file, entry] of this.entries) {
			if (this.generation - entry.generation > RETAINED_GENERATIONS) {
				this.entries.delete(file);
			}
		}
	}

	get<T>(
		file: string,
		stat: { size: number; mtimeMs: number },
		compute: () => T,
	): T {
		const entry = this.entries.get(file);
		if (entry && entry.size === stat.size && entry.mtimeMs === stat.mtimeMs) {
			entry.generation = this.generation;
			return entry.value as T;
		}
		const value = compute();
		this.entries.set(file, {
			size: stat.size,
			mtimeMs: stat.mtimeMs,
			generation: this.generation,
			value,
		});
		return value;
	}

	get size(): number {
		return this.entries.size;
	}
}

/**
 * Cooperative yield point for long scans: the sidecar serves chat streams and
 * approvals from the same event loop, so a scan hands control back whenever it
 * has held it for longer than `budgetMs`.
 */
export function createYieldIfBusy(
	budgetMs: number,
	now: () => number = () => performance.now(),
): () => Promise<void> {
	let lastYield = now();
	return async () => {
		if (now() - lastYield < budgetMs) return;
		await new Promise<void>((resolve) => setImmediate(resolve));
		lastYield = now();
	};
}
