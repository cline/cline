import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createJsonlStreamStats, jsonlLines } from "./jsonl-reader";

const tempDirs: string[] = [];

function writeTemp(contents: string): string {
	const dir = mkdtempSync(join(tmpdir(), "jsonl-reader-"));
	tempDirs.push(dir);
	const file = join(dir, "session.jsonl");
	writeFileSync(file, contents);
	return file;
}

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

describe("jsonlLines", () => {
	it("yields every line regardless of chunk boundaries", () => {
		const lines = ["alpha", "beta", "gamma delta", "epsilon"];
		const file = writeTemp(`${lines.join("\n")}\n`);
		// A 3-byte chunk forces most lines to span several reads.
		expect([...jsonlLines(file, { chunkBytes: 3 })]).toEqual(lines);
	});

	it("keeps multi-byte characters intact when a chunk splits them", () => {
		const lines = ["中文一行", "emoji 🚀 tail", "ünïcödé"];
		const file = writeTemp(`${lines.join("\n")}\n`);
		expect([...jsonlLines(file, { chunkBytes: 5 })]).toEqual(lines);
	});

	it('preserves CRLF the way split("\\n") did', () => {
		// Callers trim before parsing, so the reader only splits on \n and
		// leaves the \r attached — matching the arrays it replaces.
		const file = writeTemp("one\r\ntwo\r\n");
		expect([...jsonlLines(file)]).toEqual(["one\r", "two\r"]);
	});

	it("yields a final line that has no trailing newline", () => {
		const file = writeTemp("only\nlast");
		expect([...jsonlLines(file, { chunkBytes: 4 })]).toEqual(["only", "last"]);
	});

	it("yields nothing for an empty file", () => {
		expect([...jsonlLines(writeTemp(""))]).toEqual([]);
	});

	it("keeps an empty line between two newlines", () => {
		expect([...jsonlLines(writeTemp("a\n\nb\n"))]).toEqual(["a", "", "b"]);
	});

	it("keeps very large lines when no limit is configured", () => {
		// The import path stores transcript text verbatim; the default must not
		// silently drop a large tool output.
		const huge = "z".repeat(3_000_000);
		const file = writeTemp(`{"output":"${huge}"}\n`);
		const [line] = [...jsonlLines(file, { chunkBytes: 4096 })];
		expect(line.length).toBeGreaterThan(huge.length);
	});

	it("stops reading once the caller breaks out of the loop", () => {
		const body = `${Array.from(
			{ length: 4000 },
			(_, index) => `line-${index}-${"x".repeat(200)}`,
		).join("\n")}\n`;
		const file = writeTemp(body);
		const stats = createJsonlStreamStats();
		let seen = 0;
		// Smaller than the file so the stream cannot buffer all of it at once.
		for (const _line of jsonlLines(file, { chunkBytes: 4096, stats })) {
			seen++;
			if (seen === 3) break;
		}
		expect(seen).toBe(3);
		// Proof the scan streamed: it never read the rest of the file.
		expect(stats.bytesRead).toBeLessThan(statSync(file).size);
	});

	it("skips oversized lines when a limit is configured", () => {
		const file = writeTemp(
			`${["small", "y".repeat(5000), "after"].join("\n")}\n`,
		);
		const stats = createJsonlStreamStats();
		expect([
			...jsonlLines(file, { maxLineChars: 100, chunkBytes: 64, stats }),
		]).toEqual(["small", "after"]);
		expect(stats.skippedOversizedLines).toBe(1);
	});
});
