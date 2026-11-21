import { closeSync, openSync, readSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

/** Bytes pulled from disk per read. */
const DEFAULT_CHUNK_BYTES = 1024 * 1024;

export interface JsonlStreamStats {
	/** Bytes actually consumed; stays below the file size when the caller stops early. */
	bytesRead: number;
	linesRead: number;
	skippedOversizedLines: number;
}

export interface JsonlReadOptions {
	/** Bytes per read; peak memory is proportional to this, not to file size. */
	chunkBytes?: number;
	/**
	 * Skip any single line longer than this instead of materialising it.
	 * Defaults to unlimited: callers that need the line's *content* (the
	 * import path stores transcript text verbatim) must not lose data, while
	 * callers that only read metadata can opt into a guard.
	 */
	maxLineChars?: number;
	/** Optional out-parameter for observability and tests. */
	stats?: JsonlStreamStats;
}

/**
 * Stream a JSONL file line by line without ever holding the whole file in
 * memory.
 *
 * `readFileSync(path, "utf8")` is not an option for agent session stores:
 * Codex rollouts grow past 2 GB, which exceeds V8's maximum string length on
 * Node (`Cannot create a string longer than 0x1fffffe8 characters`) and makes
 * Bun abort the process outright. Chunked reads keep peak memory proportional
 * to the chunk size plus the longest single line — on a 2.17 GB rollout that
 * is 1 MB + 16 MB instead of the entire file.
 *
 * The generator form keeps the `continue` / `break` semantics of the
 * `raw.split("\n")` loops it replaces, and breaking out of the loop closes the
 * descriptor immediately (the iterator's `finally` block runs on `.return()`).
 */
export function* jsonlLines(
	filePath: string,
	options: JsonlReadOptions = {},
): Generator<string, void, undefined> {
	const chunkBytes = Math.max(1, options.chunkBytes ?? DEFAULT_CHUNK_BYTES);
	const maxLineChars = options.maxLineChars ?? Number.POSITIVE_INFINITY;
	const stats = options.stats;
	let carry = "";
	let droppingOversizedLine = false;

	const descriptor = openSync(filePath, "r");
	try {
		const buffer = Buffer.allocUnsafe(chunkBytes);
		const decoder = new StringDecoder("utf8");
		for (;;) {
			const read = readSync(descriptor, buffer, 0, chunkBytes, null);
			if (read <= 0) break;
			if (stats) stats.bytesRead += read;
			// A chunk can split a multi-byte character; StringDecoder holds the
			// partial sequence until the next chunk completes it.
			const text = carry + decoder.write(buffer.subarray(0, read));
			carry = "";
			let start = 0;
			for (;;) {
				const newline = text.indexOf("\n", start);
				if (newline < 0) break;
				const segment = text.slice(start, newline);
				start = newline + 1;
				if (droppingOversizedLine) {
					// Discard the tail of the line we already gave up on.
					droppingOversizedLine = false;
				} else if (segment.length > maxLineChars) {
					if (stats) stats.skippedOversizedLines++;
				} else {
					if (stats) stats.linesRead++;
					yield segment;
				}
			}
			carry = text.slice(start);
			if (carry.length > maxLineChars) {
				// No newline in sight: stop accumulating rather than grow forever.
				// Count the dropped line once, not once per chunk it spans.
				carry = "";
				if (!droppingOversizedLine) {
					droppingOversizedLine = true;
					if (stats) stats.skippedOversizedLines++;
				}
			}
		}
		const tail = carry + decoder.end();
		if (tail.length > 0 && !droppingOversizedLine) {
			if (tail.length > maxLineChars) {
				if (stats) stats.skippedOversizedLines++;
			} else {
				if (stats) stats.linesRead++;
				yield tail;
			}
		}
	} finally {
		closeSync(descriptor);
	}
}

/** Fresh stats object for `jsonlLines(..., { stats })`. */
export function createJsonlStreamStats(): JsonlStreamStats {
	return { bytesRead: 0, linesRead: 0, skippedOversizedLines: 0 };
}
