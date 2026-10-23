import { describe, expect, it } from "vitest";
import { parseUserInputEnvelope, userInputModeLabel } from "./user-text";

describe("parseUserInputEnvelope", () => {
	it("unwraps the exact envelope the runtime writes", () => {
		// Shape mirrors `formatUserInputBlock` in
		// sdk/packages/shared/src/prompt/format.ts:5-10.
		const raw =
			'<user_input mode="act">Run a command that sleeps for 30 seconds, then report completion.</user_input>';
		expect(parseUserInputEnvelope(raw)).toEqual({
			text: "Run a command that sleeps for 30 seconds, then report completion.",
			mode: "act",
			unwrapped: true,
		});
	});

	it("surfaces each mode the runtime can stamp", () => {
		for (const mode of ["act", "plan", "yolo"] as const) {
			expect(
				parseUserInputEnvelope(`<user_input mode="${mode}">hi</user_input>`)
					.mode,
			).toBe(mode);
		}
	});

	it("unwraps an envelope with no attributes and reports no mode", () => {
		const parsed = parseUserInputEnvelope("<user_input>plain</user_input>");
		expect(parsed.text).toBe("plain");
		expect(parsed.unwrapped).toBe(true);
		expect(parsed.mode).toBeUndefined();
	});

	it("ignores an unrecognised mode value but still unwraps", () => {
		const parsed = parseUserInputEnvelope(
			'<user_input mode="warp">hi</user_input>',
		);
		expect(parsed.text).toBe("hi");
		expect(parsed.mode).toBeUndefined();
	});

	it("tolerates extra attributes and surrounding whitespace", () => {
		const parsed = parseUserInputEnvelope(
			'\n  <user_input source="mobile" mode="plan">  think  </user_input>  ',
		);
		expect(parsed).toEqual({ text: "think", mode: "plan", unwrapped: true });
	});

	it("keeps multi-line bodies intact", () => {
		const parsed = parseUserInputEnvelope(
			'<user_input mode="act">line one\n\nline two</user_input>',
		);
		expect(parsed.text).toBe("line one\n\nline two");
	});

	// --- the conservative half: anything that is not an exact envelope survives ---

	it("leaves plain text completely alone", () => {
		expect(parseUserInputEnvelope("just a message")).toEqual({
			text: "just a message",
			unwrapped: false,
		});
	});

	it("leaves prose that merely mentions the tag untouched", () => {
		const raw = "why does the phone print <user_input> at me?";
		expect(parseUserInputEnvelope(raw)).toEqual({
			text: raw,
			unwrapped: false,
		});
	});

	it("does not strip a partial wrapper", () => {
		for (const raw of [
			'<user_input mode="act">no close tag',
			"unopened</user_input>",
			'<user_input mode="act">body</user_input> and a tail',
			'prefix <user_input mode="act">body</user_input>',
		]) {
			expect(parseUserInputEnvelope(raw)).toEqual({
				text: raw,
				unwrapped: false,
			});
		}
	});

	it("does not strip a different tag, including a same-prefix one", () => {
		for (const raw of [
			'<user_command slash="/plan">go</user_command>',
			"<user_inputs>go</user_inputs>",
			"<input>go</input>",
		]) {
			expect(parseUserInputEnvelope(raw).unwrapped).toBe(false);
			expect(parseUserInputEnvelope(raw).text).toBe(raw);
		}
	});

	it("does not touch angle brackets or markdown in the body", () => {
		const parsed = parseUserInputEnvelope(
			'<user_input mode="act">compare `a < b` and <div> in **bold**</user_input>',
		);
		expect(parsed.text).toBe("compare `a < b` and <div> in **bold**");
	});

	it("strips one level only when the envelope is nested", () => {
		const parsed = parseUserInputEnvelope(
			'<user_input mode="plan"><user_input mode="act">inner</user_input></user_input>',
		);
		expect(parsed.mode).toBe("plan");
		expect(parsed.text).toBe('<user_input mode="act">inner</user_input>');
	});

	it("survives odd and empty input without throwing", () => {
		expect(parseUserInputEnvelope("")).toEqual({ text: "", unwrapped: false });
		expect(parseUserInputEnvelope("<user_input").unwrapped).toBe(false);
		expect(parseUserInputEnvelope("</user_input>").unwrapped).toBe(false);
		expect(
			parseUserInputEnvelope('<user_input mode="act"></user_input>'),
		).toEqual({ text: "", mode: "act", unwrapped: true });
		// A long run of opening tags is the compaction test's adversarial case; it
		// must return, not hang.
		expect(parseUserInputEnvelope("<user_input>".repeat(500)).unwrapped).toBe(
			false,
		);
	});
});

describe("userInputModeLabel", () => {
	it("sentence-cases the mode for chip copy", () => {
		expect(userInputModeLabel("act")).toBe("Act");
		expect(userInputModeLabel("plan")).toBe("Plan");
		expect(userInputModeLabel("yolo")).toBe("Yolo");
	});
});

describe("mode_notice", () => {
	it("strips a mode_notice prepended inside the envelope", () => {
		const raw =
			'<user_input mode="act"><mode_notice>The user switched from plan mode to act mode before sending this message.</mode_notice>ship it</user_input>';
		const parsed = parseUserInputEnvelope(raw);
		expect(parsed.text).toBe("ship it");
		expect(parsed.mode).toBe("act");
		expect(parsed.unwrapped).toBe(true);
	});

	it("leaves a mode_notice mentioned in prose outside an envelope alone", () => {
		const raw = "what does <mode_notice> mean?";
		expect(parseUserInputEnvelope(raw).text).toBe(raw);
	});
});
