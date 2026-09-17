import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createHeadReadStats,
	createYieldIfBusy,
	HeadCache,
	readHead,
} from "./head";

const tempDirs: string[] = [];

function tempFile(name: string, content: string): string {
	const dir = mkdtempSync(join(tmpdir(), "usage-head-"));
	tempDirs.push(dir);
	const file = join(dir, name);
	writeFileSync(file, content);
	return file;
}

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

const KB = 1024;

describe("readHead", () => {
	it("stops at the requested line without touching the body behind it", () => {
		const body = "x".repeat(10 * KB * KB);
		const file = tempFile(
			"rollout.jsonl",
			`${JSON.stringify({ type: "session_meta", payload: { id: "a" } })}\n${JSON.stringify({ type: "response_item", text: body })}\n`,
		);
		const stats = createHeadReadStats();
		const lines = readHead(file, {
			maxBytes: 256 * KB,
			maxLineBytes: 256 * KB,
			until: (line) => line.type === "session_meta",
			stats,
		});
		expect(lines).toEqual([{ type: "session_meta", payload: { id: "a" } }]);
		expect(stats.bytesRead).toBeLessThanOrEqual(16 * KB);
	});

	it("never reads past the byte budget when the metadata is not there", () => {
		const file = tempFile(
			"transcript.jsonl",
			`${JSON.stringify({ type: "user", text: "y".repeat(8 * KB * KB) })}\n`,
		);
		const stats = createHeadReadStats();
		const lines = readHead(file, {
			maxBytes: 256 * KB,
			maxLineBytes: 64 * KB,
			until: () => false,
			stats,
		});
		expect(lines).toEqual([]);
		expect(stats.bytesRead).toBe(256 * KB);
		// The line the budget cut off is reported, so callers can tell a large
		// first message apart from a file with no parseable lines at all.
		expect(stats.budgetExhausted).toBe(true);
		expect(stats.linesSkipped).toBe(1);
	});

	it("skips over-long lines unparsed and keeps going", () => {
		const file = tempFile(
			"transcript.jsonl",
			`${JSON.stringify({ type: "user", text: "z".repeat(100 * KB) })}\n${JSON.stringify({ type: "assistant", timestamp: "2026-03-02T09:00:00.000Z" })}\n`,
		);
		const stats = createHeadReadStats();
		const lines = readHead(file, {
			maxBytes: 256 * KB,
			maxLineBytes: 64 * KB,
			until: (line) => typeof line.timestamp === "string",
			stats,
		});
		expect(lines).toEqual([
			{ type: "assistant", timestamp: "2026-03-02T09:00:00.000Z" },
		]);
		expect(stats.linesSkipped).toBe(1);
	});

	it("parses a final line without a trailing newline", () => {
		const file = tempFile("tail.jsonl", `{"a":1}\n{"b":2}`);
		expect(readHead(file, { maxBytes: KB, maxLineBytes: KB })).toEqual([
			{ a: 1 },
			{ b: 2 },
		]);
	});

	it("keeps multi-byte characters intact across buffer growth", () => {
		// Pushes the emoji across the initial 16 KB read boundary.
		const padding = "p".repeat(16 * KB - 12);
		const file = tempFile(
			"utf8.jsonl",
			`${JSON.stringify({ padding, mark: "🚀ü" })}\n`,
		);
		const [line] = readHead(file, { maxBytes: 64 * KB, maxLineBytes: 64 * KB });
		expect(line?.mark).toBe("🚀ü");
	});

	it("returns nothing for a missing file", () => {
		expect(
			readHead(join(tmpdir(), "does-not-exist.jsonl"), {
				maxBytes: KB,
				maxLineBytes: KB,
			}),
		).toEqual([]);
	});
});

describe("HeadCache", () => {
	it("reuses a result until the file's size or mtime changes", () => {
		const cache = new HeadCache();
		cache.beginScan();
		let computed = 0;
		const compute = () => ++computed;
		expect(cache.get("a", { size: 1, mtimeMs: 10 }, compute)).toBe(1);
		expect(cache.get("a", { size: 1, mtimeMs: 10 }, compute)).toBe(1);
		expect(cache.get("a", { size: 2, mtimeMs: 10 }, compute)).toBe(2);
		expect(cache.get("a", { size: 2, mtimeMs: 11 }, compute)).toBe(3);
	});

	it("forgets files that stopped showing up in scans", () => {
		const cache = new HeadCache();
		cache.beginScan();
		cache.get("gone", { size: 1, mtimeMs: 1 }, () => "value");
		for (let scan = 0; scan < 3; scan += 1) cache.beginScan();
		expect(cache.size).toBe(1);
		cache.beginScan();
		expect(cache.size).toBe(0);
	});
});

describe("createYieldIfBusy", () => {
	it("lets queued work run once the budget is spent", async () => {
		let clock = 0;
		const yieldIfBusy = createYieldIfBusy(8, () => clock);
		let ran = false;
		setImmediate(() => {
			ran = true;
		});
		await yieldIfBusy();
		expect(ran).toBe(false);
		clock = 9;
		await yieldIfBusy();
		expect(ran).toBe(true);
	});
});
