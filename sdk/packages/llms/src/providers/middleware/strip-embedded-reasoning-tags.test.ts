import { describe, expect, it } from "vitest";
import {
	EmbeddedReasoningTagParser,
	shouldStripEmbeddedReasoningTags,
	__testing__suffixPartialTagLength,
} from "./strip-embedded-reasoning-tags";

function collect(parser: EmbeddedReasoningTagParser, chunks: string[]) {
	const out = [];
	for (const chunk of chunks) {
		out.push(...parser.push(chunk));
	}
	out.push(...parser.flush());
	return out;
}

const REDACTED_OPEN = "<" + "redacted_thinking" + ">";
const REDACTED_CLOSE = "<" + "/redacted_thinking" + ">";
const THINK_OPEN = "\u003cthink\u003e";
const THINK_CLOSE = "\u003c/think\u003e";

describe("shouldStripEmbeddedReasoningTags", () => {
	it("enables stripping for MiniMax models on openai-compatible", () => {
		expect(
			shouldStripEmbeddedReasoningTags(
				"openai-compatible",
				"MiniMax-M2.7-highspeed",
			),
		).toBe(true);
	});

	it("skips non-openai-compatible providers", () => {
		expect(shouldStripEmbeddedReasoningTags("minimax", "MiniMax-M2.7")).toBe(
			false,
		);
	});

	it("skips unrelated openai-compatible models", () => {
		expect(
			shouldStripEmbeddedReasoningTags("openai-compatible", "deepseek-v4-pro"),
		).toBe(false);
	});
});

describe("EmbeddedReasoningTagParser", () => {
	it("passes through plain text unchanged", () => {
		const parser = new EmbeddedReasoningTagParser();
		expect(collect(parser, ["Hello", " world"])).toEqual([
			{ kind: "text", text: "Hello" },
			{ kind: "text", text: " world" },
		]);
	});

	it("splits a redacted thinking block from surrounding text", () => {
		const parser = new EmbeddedReasoningTagParser();
		const input = `Before${REDACTED_OPEN}secret${REDACTED_CLOSE}After`;
		expect(collect(parser, [input])).toEqual([
			{ kind: "text", text: "Before" },
			{ kind: "reasoning", text: "secret", redacted: true },
			{ kind: "text", text: "After" },
		]);
	});

	it("handles redacted thinking split across chunks", () => {
		const parser = new EmbeddedReasoningTagParser();
		expect(
			collect(parser, [
				"Hi " + REDACTED_OPEN.slice(0, 14),
				REDACTED_OPEN.slice(14) + "rea",
				"son" + REDACTED_CLOSE + " there",
			]),
		).toEqual([
			{ kind: "text", text: "Hi " },
			{ kind: "reasoning", text: "rea", redacted: true },
			{ kind: "reasoning", text: "son", redacted: true },
			{ kind: "text", text: " there" },
		]);
	});

	it("splits think blocks without marking them redacted", () => {
		const parser = new EmbeddedReasoningTagParser();
		expect(
			collect(parser, ["A" + THINK_OPEN + "thought" + THINK_CLOSE + "B"]),
		).toEqual([
			{ kind: "text", text: "A" },
			{ kind: "reasoning", text: "thought", redacted: false },
			{ kind: "text", text: "B" },
		]);
	});

	it("does not emit partial tag prefixes as visible text", () => {
		expect(
			__testing__suffixPartialTagLength(
				REDACTED_OPEN.slice(0, -1),
				[REDACTED_OPEN],
			),
		).toBeGreaterThan(0);
		const parser = new EmbeddedReasoningTagParser();
		expect(parser.push(REDACTED_OPEN.slice(0, -1))).toEqual([]);
		expect(parser.flush()).toEqual([
			{ kind: "text", text: REDACTED_OPEN.slice(0, -1) },
		]);
	});

	it("flushes trailing reasoning when close tag never arrives", () => {
		const parser = new EmbeddedReasoningTagParser();
		expect(collect(parser, [REDACTED_OPEN + "trail"])).toEqual([
			{ kind: "reasoning", text: "trail", redacted: true },
		]);
	});
});
