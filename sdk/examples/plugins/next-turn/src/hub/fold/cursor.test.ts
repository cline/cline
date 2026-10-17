import { describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CURSOR_SAVE_EVERY_EVENTS } from "../../config";
import { useTempDirs } from "../../test-support/temp-dirs";
import { CursorWriter, readCursor } from "./cursor";

describe("cursor", () => {
	const tempDir = useTempDirs("next-turn-cursor-");
	const path = () => join(tempDir(), "cursor.json");

	test("writes every N advances and on flush, never moving backwards", () => {
		const file = path();
		const writer = new CursorWriter(file, 0, () => 123);
		for (let i = 1; i < CURSOR_SAVE_EVERY_EVENTS; i += 1) writer.advance(i);
		expect(readCursor(file)).toBeUndefined();
		writer.advance(CURSOR_SAVE_EVERY_EVENTS);
		expect(readCursor(file)).toEqual({
			sequence: CURSOR_SAVE_EVERY_EVENTS,
			savedAt: 123,
		});
		writer.advance(3);
		writer.advance(CURSOR_SAVE_EVERY_EVENTS + 1);
		writer.flush();
		expect(readCursor(file)?.sequence).toBe(CURSOR_SAVE_EVERY_EVENTS + 1);
	});

	test("a write that keeps failing leaves no temp files and waits another N advances to retry", () => {
		const file = path();
		mkdirSync(file);
		const writer = new CursorWriter(file);
		for (let i = 1; i <= CURSOR_SAVE_EVERY_EVENTS + 1; i += 1)
			writer.advance(i);
		expect(readdirSync(dirname(file))).toEqual(["cursor.json"]);
		expect(writer.current()).toBe(CURSOR_SAVE_EVERY_EVENTS + 1);
	});

	test("a missing or malformed cursor starts from zero", () => {
		const file = path();
		expect(new CursorWriter(file).current()).toBe(0);
		writeFileSync(file, JSON.stringify({ sequence: -4 }));
		expect(readCursor(file)).toBeUndefined();
	});
});
