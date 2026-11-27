import { describe, expect, it } from "vitest";
import { ThinkingTagStreamParser } from "./thinking-tags";

describe("ThinkingTagStreamParser", () => {
	it("passes plain text through without modification", () => {
		const parser = new ThinkingTagStreamParser();
		const events = [
			...parser.push("Hello, "),
			...parser.push("how can I help you today?"),
			...parser.flush(),
		];

		expect(events).toEqual([
			{ type: "text-delta", text: "Hello, " },
			{ type: "text-delta", text: "how can I help you today?" },
		]);
	});

	it("preserves comparison operators and other HTML/XML tags in text", () => {
		const parser = new ThinkingTagStreamParser();
		const events = [
			...parser.push("if (x < y && a <= b) {\n"),
			...parser.push("  return <div>hello</div>;\n"),
			...parser.push("}"),
			...parser.flush(),
		];

		const fullText = events.map((e) => e.text).join("");
		expect(fullText).toBe(
			"if (x < y && a <= b) {\n  return <div>hello</div>;\n}",
		);
		expect(events.every((e) => e.type === "text-delta")).toBe(true);
	});

	it("extracts <think>...</think> into reasoning-delta and following text into text-delta", () => {
		const parser = new ThinkingTagStreamParser();
		const events = [
			...parser.push("<think>\nCalculating 2 + 2\n</think>\nThe answer is 4."),
			...parser.flush(),
		];

		expect(events).toEqual([
			{ type: "reasoning-delta", text: "\nCalculating 2 + 2\n" },
			{ type: "text-delta", text: "\nThe answer is 4." },
		]);
	});

	it("handles <think> tags split across stream chunks", () => {
		const parser = new ThinkingTagStreamParser();
		const chunks = [
			"<th",
			"ink>",
			"Let me think about this step by step.\n",
			"Step 1: Check inputs.\n",
			"</th",
			"ink>",
			"Here is the final answer.",
		];

		const events = chunks.flatMap((c) => parser.push(c));
		events.push(...parser.flush());

		expect(events).toEqual([
			{
				type: "reasoning-delta",
				text: "Let me think about this step by step.\n",
			},
			{
				type: "reasoning-delta",
				text: "Step 1: Check inputs.\n",
			},
			{
				type: "text-delta",
				text: "Here is the final answer.",
			},
		]);
	});

	it("handles whitespace and case variations in tags", () => {
		const parser = new ThinkingTagStreamParser();
		const events = [
			...parser.push("<THINK >Thinking...</think >Output"),
			...parser.flush(),
		];

		expect(events).toEqual([
			{ type: "reasoning-delta", text: "Thinking..." },
			{ type: "text-delta", text: "Output" },
		]);
	});

	it("flushes remaining buffer as reasoning-delta if stream ends inside <think>", () => {
		const parser = new ThinkingTagStreamParser();
		const events = [
			...parser.push("<think>Incomplete reasoning without closing tag"),
			...parser.flush(),
		];

		expect(events).toEqual([
			{
				type: "reasoning-delta",
				text: "Incomplete reasoning without closing tag",
			},
		]);
	});

	it("handles multiple interleaved <think> blocks", () => {
		const parser = new ThinkingTagStreamParser();
		const events = [
			...parser.push("<think>Thought 1</think>Result 1"),
			...parser.push("<think>Thought 2</think>Result 2"),
			...parser.flush(),
		];

		expect(events).toEqual([
			{ type: "reasoning-delta", text: "Thought 1" },
			{ type: "text-delta", text: "Result 1" },
			{ type: "reasoning-delta", text: "Thought 2" },
			{ type: "text-delta", text: "Result 2" },
		]);
	});

	it("handles empty think tags without producing empty reasoning", () => {
		const parser = new ThinkingTagStreamParser();
		const events = [
			...parser.push("<think></think>Direct answer"),
			...parser.flush(),
		];

		expect(events).toEqual([{ type: "text-delta", text: "Direct answer" }]);
	});
});
