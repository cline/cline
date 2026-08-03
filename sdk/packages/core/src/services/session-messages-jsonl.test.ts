import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	appendMessagesToJsonl,
	compactMessagesJsonl,
	countMessageRows,
	diffNewMessages,
	ensureJsonlHeader,
	isJsonlFile,
	MAX_JSONL_LINE_LENGTH,
	readJsonlHeaderSync,
	readJsonlMessagesSync,
	readJsonlTailFirst,
	readSessionMessagesFile,
	toJsonlMessagesPath,
} from "./session-messages-jsonl";

describe("session-messages-jsonl", () => {
	const tempDirs: string[] = [];
	const context = { agent: "lead" as const, sessionId: "sess-1" };

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	function makePath(name: string): string {
		const dir = mkdtempSync(join(tmpdir(), `jsonl-${name}-`));
		tempDirs.push(dir);
		return join(dir, `${name}.messages.json`);
	}

	function makeMessages(n: number): Array<Record<string, unknown>> {
		const out: Array<Record<string, unknown>> = [];
		for (let i = 0; i < n; i++) {
			out.push({ id: `m${i}`, role: "user", content: `msg ${i}` });
		}
		return out;
	}

	describe("write+append roundtrip (O(1) append)", () => {
		it("writes a header row then message rows", () => {
			const p = makePath("roundtrip");
			ensureJsonlHeader(p, { updatedAt: "2026-01-01T00:00:00.000Z", context });
			appendMessagesToJsonl(p, makeMessages(2));

			expect(isJsonlFile(p)).toBe(true);
			const header = readJsonlHeaderSync(p);
			expect(header?.agent).toBe("lead");
			expect(header?.sessionId).toBe("sess-1");
			expect(readJsonlMessagesSync(p)).toHaveLength(2);
		});

		it("only appends the delta rows on a second persist", async () => {
			const p = makePath("delta");
			ensureJsonlHeader(p, { updatedAt: "2026-01-01T00:00:00.000Z", context });
			appendMessagesToJsonl(p, makeMessages(3));

			// Simulate a second persist with 5 messages: only rows 3..4 are new.
			const persistedCount = await countMessageRows(p);
			expect(persistedCount).toBe(3);
			const newRows = diffNewMessages(makeMessages(5), persistedCount);
			expect(newRows).toHaveLength(2);
			expect((newRows[0] as { id: string }).id).toBe("m3");

			appendMessagesToJsonl(p, newRows);
			expect(readJsonlMessagesSync(p)).toHaveLength(5);
		});
	});

	describe("ensureJsonlHeader", () => {
		it("overwrites a pre-existing legacy JSON file with a JSONL header", () => {
			const p = makePath("legacy-migrate");
			// Simulate initializeMessagesFile → writeEmptyMessagesFile legacy format.
			writeFileSync(
				p,
				`{\n  "version": 1,\n  "messages": []\n}\n`,
				"utf8",
			);
			expect(isJsonlFile(p)).toBe(false);

			ensureJsonlHeader(p, { updatedAt: "2026-01-01T00:00:00.000Z", context });
			expect(isJsonlFile(p)).toBe(true);
			expect(readJsonlHeaderSync(p)?.sessionId).toBe("sess-1");
		});

		it("is a no-op when the file is already JSONL", () => {
			const p = makePath("noop");
			ensureJsonlHeader(p, { updatedAt: "2026-01-01T00:00:00.000Z", context });
			appendMessagesToJsonl(p, makeMessages(1));
			const before = readFileSync(p, "utf8");

			ensureJsonlHeader(p, { updatedAt: "2026-01-01T00:00:00.000Z", context });
			expect(readFileSync(p, "utf8")).toBe(before);
			expect(readJsonlMessagesSync(p)).toHaveLength(1);
		});
	});

	describe("compact", () => {
		it("atomically rewrites header + all rows and updates message_count", () => {
			const p = makePath("compact");
			ensureJsonlHeader(p, { updatedAt: "2026-01-01T00:00:00.000Z", context });
			const messages = makeMessages(4);
			appendMessagesToJsonl(p, messages);

			compactMessagesJsonl(p, messages, {
				updatedAt: "2026-01-01T00:00:05.000Z",
				context,
			});

			expect(readJsonlMessagesSync(p)).toHaveLength(4);
			const header = readJsonlHeaderSync(p);
			expect(header?.message_count).toBe(4);
			expect(header?.updated_at).toBe("2026-01-01T00:00:05.000Z");
		});
	});

	describe("readSessionMessagesFile (async, streamed)", () => {
		it("auto-detects JSONL and reads all message rows", async () => {
			const p = makePath("read");
			ensureJsonlHeader(p, { updatedAt: "2026-01-01T00:00:00.000Z", context });
			appendMessagesToJsonl(p, makeMessages(3));

			const messages = await readSessionMessagesFile(p);
			expect(messages).toHaveLength(3);
			expect((messages[0] as { content: string }).content).toBe("msg 0");
		});

		it("falls back to legacy pretty-printed JSON", async () => {
			const p = makePath("legacy-read");
			writeFileSync(
				p,
				JSON.stringify(
					{ version: 1, messages: makeMessages(2) },
					null,
					2,
				) + "\n",
				"utf8",
			);

			const messages = await readSessionMessagesFile(p);
			expect(messages).toHaveLength(2);
		});

		it("skips torn/corrupt rows but keeps healthy ones", async () => {
			const p = makePath("torn");
			ensureJsonlHeader(p, { updatedAt: "2026-01-01T00:00:00.000Z", context });
			appendMessagesToJsonl(p, makeMessages(2));
			// Append a torn (truncated) row.
			appendFileSync(p, '{"message":{"id":"torn",\n', "utf8");
			appendMessagesToJsonl(p, makeMessages(1));

			expect(readJsonlMessagesSync(p)).toHaveLength(3);
		});
	});

	describe("readJsonlTailFirst (V19 hardening)", () => {
		it("returns tail messages in chronological order and honors limit", async () => {
			const p = makePath("tail-limit");
			ensureJsonlHeader(p, { updatedAt: "2026-01-01T00:00:00.000Z", context });
			appendMessagesToJsonl(p, makeMessages(10));

			const messages = await readJsonlTailFirst(p, 64, 3);
			expect(messages).toHaveLength(3);
			// Chronological order: the LAST 3 rows (m7, m8, m9), oldest first.
			expect((messages[0] as { id: string }).id).toBe("m7");
			expect((messages[2] as { id: string }).id).toBe("m9");
		});

		it("reassembles message rows that straddle chunk boundaries (no NUL padding)", async () => {
			const p = makePath("straddle");
			ensureJsonlHeader(p, { updatedAt: "2026-01-01T00:00:00.000Z", context });
			// Rows ~130 bytes each with a 200-byte chunk: every row is longer
			// than a chunk's body can fully contain, so rows necessarily straddle
			// chunk boundaries — while a realistic number of complete rows still
			// sit inside each chunk (mirrors 64KB chunks vs ~few-hundred-byte
			// rows in production).
			const messages = makeMessages(4).map((m) => ({
				...m,
				content: "X".repeat(100) + (m as { id: string }).id,
			}));
			appendMessagesToJsonl(p, messages);

			const read = await readJsonlTailFirst(p, 200, 4);
			expect(read).toHaveLength(4);
			expect((read[3] as { content: string }).content.endsWith("m3")).toBe(true);
			expect(read.map((m) => (m as { id: string }).id)).toEqual([
				"m0",
				"m1",
				"m2",
				"m3",
			]);
		});

		it("skips an oversized corrupt row but keeps surrounding healthy rows", async () => {
			const p = makePath("oversized");
			ensureJsonlHeader(p, { updatedAt: "2026-01-01T00:00:00.000Z", context });
			appendMessagesToJsonl(p, makeMessages(3));
			// Inject a single row longer than MAX_JSONL_LINE_LENGTH (a corrupt
			// newline-free blob would be exactly this). Append via raw fs to keep
			// the byte count accurate.
			const blob = "X".repeat(MAX_JSONL_LINE_LENGTH + 1);
			appendFileSync(p, `{"message":{"id":"huge","content":"${blob}"}}\n`, "utf8");
			appendMessagesToJsonl(p, [{ id: "after", content: "tail" }]);

			const messages = await readJsonlTailFirst(p, 64 * 1024, 10);
			// The oversized row must not appear and must not break the scan —
			// healthy rows before and after survive.
			const ids = messages.map((m) => (m as { id: string }).id);
			expect(ids).not.toContain("huge");
			expect(ids).toContain("after");
			expect(ids).toContain("m0");
			expect(ids).toContain("m2");
		});
	});

	describe("toJsonlMessagesPath", () => {
		it("maps <id>.messages.json → <id>.messages.jsonl", () => {
			expect(toJsonlMessagesPath("s/sess-1.messages.json")).toBe(
				"s/sess-1.messages.jsonl",
			);
			expect(toJsonlMessagesPath("other.txt")).toBe("other.txt.jsonl");
		});
	});
});