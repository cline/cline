import { describe, expect, it } from "vitest";
import { matchTranscriptKeybind } from "./transcript-keybinds";

function key(input: {
	name: string;
	ctrl?: boolean;
	meta?: boolean;
	shift?: boolean;
}) {
	return {
		name: input.name,
		ctrl: input.ctrl ?? false,
		meta: input.meta ?? false,
		shift: input.shift ?? false,
	};
}

describe("matchTranscriptKeybind", () => {
	it("matches OpenCode-style page scroll keybinds", () => {
		expect(matchTranscriptKeybind(key({ name: "pageup" }))).toBe(
			"messages_page_up",
		);
		expect(matchTranscriptKeybind(key({ name: "pagedown" }))).toBe(
			"messages_page_down",
		);
		expect(
			matchTranscriptKeybind(key({ name: "b", ctrl: true, meta: true })),
		).toBe("messages_page_up");
		expect(
			matchTranscriptKeybind(key({ name: "f", ctrl: true, meta: true })),
		).toBe("messages_page_down");
	});

	it("matches OpenCode-style half-page keybinds", () => {
		expect(
			matchTranscriptKeybind(key({ name: "u", ctrl: true, meta: true })),
		).toBe("messages_half_page_up");
		expect(
			matchTranscriptKeybind(key({ name: "d", ctrl: true, meta: true })),
		).toBe("messages_half_page_down");
	});

	it("matches transcript bound keybinds that do not conflict with input editing", () => {
		expect(matchTranscriptKeybind(key({ name: "g", ctrl: true }))).toBe(
			"messages_first",
		);
		expect(
			matchTranscriptKeybind(key({ name: "g", ctrl: true, meta: true })),
		).toBe("messages_last");
	});

	it("does not match modified variants outside the configured defaults", () => {
		expect(matchTranscriptKeybind(key({ name: "home" }))).toBe(null);
		expect(matchTranscriptKeybind(key({ name: "end" }))).toBe(null);
		expect(matchTranscriptKeybind(key({ name: "home", ctrl: true }))).toBe(
			null,
		);
		expect(matchTranscriptKeybind(key({ name: "pageup", shift: true }))).toBe(
			null,
		);
	});
});
