import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSqliteDb } from "@cline/shared/db";
import { afterEach, describe, expect, it } from "vitest";
import { AgyImportAdapter } from "./agy-desktop";

const tempDirs: string[] = [];
afterEach(() => {
	for (const dir of tempDirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

// ── minimal protobuf wire encoder (mirrors the adapter's decoder) ──────────
function varint(value: number): number[] {
	const out: number[] = [];
	let v = value;
	for (;;) {
		const byte = v & 0x7f;
		v >>>= 7;
		if (v) out.push(byte | 0x80);
		else {
			out.push(byte);
			break;
		}
	}
	return out;
}

function tag(field: number, wireType: number): number[] {
	return varint((field << 3) | wireType);
}

function lenDelimited(field: number, bytes: number[]): number[] {
	return [...tag(field, 2), ...varint(bytes.length), ...bytes];
}

function utf8(text: string): number[] {
	return Array.from(Buffer.from(text, "utf8"));
}

/** Wrap an assistant text leaf at payload field 20 -> subfield 3 -> subfield 5. */
function assistantPayload(text: string): Buffer {
	const inner = [...lenDelimited(5, utf8(text))];
	const field3 = lenDelimited(3, inner);
	return Buffer.from([...lenDelimited(20, field3)]);
}

/** Wrap a user prompt leaf at payload field 19 -> subfield 2. */
function userPayload(text: string): Buffer {
	const field2 = lenDelimited(2, utf8(text));
	return Buffer.from([...lenDelimited(19, field2)]);
}

/** A tool step: name + JSON args string as printable leaves. */
function toolPayload(name: string, args: Record<string, unknown>): Buffer {
	const leaves = [
		...lenDelimited(1, utf8(name)),
		...lenDelimited(3, utf8(JSON.stringify(args))),
	];
	return Buffer.from(leaves);
}

function writeConversationDb(
	conversationsDir: string,
	cascadeId: string,
	steps: Array<{ stepType: number; payload: Buffer }>,
): void {
	const dbPath = join(conversationsDir, `${cascadeId}.db`);
	const db = loadSqliteDb(dbPath);
	db.exec(
		`CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, step_payload BLOB, task_details BLOB, metadata BLOB)`,
	);
	const insert = db.prepare(
		`INSERT INTO steps (idx, step_type, step_payload) VALUES (?, ?, ?)`,
	);
	steps.forEach((step, idx) => {
		insert.run(idx, step.stepType, step.payload);
	});
	db.close?.();
}

function fixture(steps: Array<{ stepType: number; payload: Buffer }>): {
	conversationsDir: string;
	adapter: AgyImportAdapter;
	cascadeId: string;
} {
	const conversationsDir = mkdtempSync(join(tmpdir(), "agy-import-"));
	tempDirs.push(conversationsDir);
	const cascadeId = "cascade-1234-5678";
	writeConversationDb(conversationsDir, cascadeId, steps);
	return {
		conversationsDir,
		adapter: new AgyImportAdapter({ conversationsDirs: [conversationsDir] }),
		cascadeId,
	};
}

describe("AgyImportAdapter", () => {
	it("reports not installed when no conversations exist", () => {
		const conversationsDir = mkdtempSync(join(tmpdir(), "agy-empty-"));
		tempDirs.push(conversationsDir);
		const adapter = new AgyImportAdapter({ conversationsDirs: [conversationsDir] });
		expect(adapter.isInstalled()).toBe(false);
		expect(adapter.discover()).toEqual([]);
	});

	it("discovers and converts a user/assistant/tool conversation", () => {
		const { adapter, cascadeId } = fixture([
			{ stepType: 14, payload: userPayload("refactor the parser") },
			{
				stepType: 15,
				payload: assistantPayload("Let me look at the parser."),
			},
			{
				stepType: 132,
				payload: toolPayload("view_file", { AbsolutePath: "src/parser.ts" }),
			},
			{ stepType: 15, payload: assistantPayload("Done refactoring.") },
		]);

		const discovered = adapter.discover();
		expect(discovered).toHaveLength(1);
		expect(discovered[0].tool).toBe("agy-desktop");
		expect(discovered[0].sourceId).toBe(cascadeId);
		expect(discovered[0].messageCount).toBeGreaterThanOrEqual(2);
		expect(discovered[0].title).toContain("refactor the parser");

		const converted = adapter.convert(cascadeId);
		expect(converted.provider).toBe("gemini");
		const roles = converted.messages.map((m) => m.role);
		expect(roles[0]).toBe("user");
		expect(roles).toContain("assistant");

		const allText = JSON.stringify(converted.messages);
		expect(allText).toContain("refactor the parser");
		expect(allText).toContain("Done refactoring.");
		expect(allText).toContain("view_file");
	});

	it("throws when converting an unknown cascade", () => {
		const { adapter } = fixture([
			{ stepType: 14, payload: userPayload("hello") },
		]);
		expect(() => adapter.convert("nope")).toThrow(/agy-desktop session nope/);
	});
});
