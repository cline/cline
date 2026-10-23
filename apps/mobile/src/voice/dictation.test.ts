import { describe, expect, it } from "vitest";
import {
	applyDictationResult,
	beginDictation,
	voiceErrorMessage,
} from "./dictation";

describe("voice dictation draft ownership", () => {
	it("explains a native recognizer startup failure without framework jargon", () => {
		expect(
			voiceErrorMessage("audio-capture", "Failed to initialize recognizer"),
		).toBe(
			"Speech recognition could not start on this device. Try again, or type your message.",
		);
	});
	it("inserts at the selected range with readable spacing", () => {
		const session = beginDictation("fix please", { start: 4, end: 4 });
		const applied = applyDictationResult(session, "fix please", "this bug");
		expect(applied?.value).toBe("fix this bug please");
		expect(applied?.selection).toEqual({ start: 13, end: 13 });
	});

	it("replaces a partial result instead of duplicating it", () => {
		const first = applyDictationResult(
			beginDictation("before after", { start: 7, end: 7 }),
			"before after",
			"hello",
		);
		expect(first?.value).toBe("before hello after");
		const second = first
			? applyDictationResult(first.session, first.value, "hello world")
			: undefined;
		expect(second?.value).toBe("before hello world after");
	});

	it("refuses a stale result after another writer changes the draft", () => {
		const session = beginDictation("original", { start: 8, end: 8 });
		expect(
			applyDictationResult(session, "user changed this", "stale speech"),
		).toBeUndefined();
	});

	it("clamps an invalid native selection to the current draft", () => {
		expect(beginDictation("abc", { start: -2, end: 99 })).toEqual({
			start: 0,
			end: 3,
			expectedValue: "abc",
		});
	});
});
