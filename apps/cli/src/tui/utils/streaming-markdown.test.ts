import { describe, expect, it } from "vitest";
import { splitStreamingMarkdown } from "./streaming-markdown";

function roundTrips(text: string): void {
	const { stable, tail } = splitStreamingMarkdown(text);
	expect(stable + tail).toBe(text);
}

describe("splitStreamingMarkdown", () => {
	it("returns everything as tail when there is no block boundary", () => {
		const text = "streaming a single paragraph without any blank line";
		expect(splitStreamingMarkdown(text)).toEqual({ stable: "", tail: text });
	});

	it("splits after the last blank line", () => {
		const text = "first paragraph\n\nsecond paragraph\n\nthird still streaming";
		expect(splitStreamingMarkdown(text)).toEqual({
			stable: "first paragraph\n\nsecond paragraph\n\n",
			tail: "third still streaming",
		});
	});

	it("reconstructs the original text from stable + tail", () => {
		roundTrips("a\n\nb\n\nc");
		roundTrips("");
		roundTrips("\n\n");
		roundTrips("no boundary at all");
		roundTrips("ends with blank line\n\n");
	});

	it("does not split inside an open code fence", () => {
		const text = "intro\n\n```python\ndef f(x):\n\n    return x\n";
		expect(splitStreamingMarkdown(text)).toEqual({
			stable: "intro\n\n",
			tail: "```python\ndef f(x):\n\n    return x\n",
		});
	});

	it("splits after a closed code fence block", () => {
		const text = "intro\n\n```python\ncode\n```\n\nnext paragraph";
		expect(splitStreamingMarkdown(text)).toEqual({
			stable: "intro\n\n```python\ncode\n```\n\n",
			tail: "next paragraph",
		});
	});

	it("does not treat tilde fences as closing backtick fences", () => {
		const text = "```text\n~~~\n\nstill inside the backtick fence\n";
		expect(splitStreamingMarkdown(text)).toEqual({
			stable: "",
			tail: text,
		});
	});

	it("handles indented fences up to three spaces", () => {
		const text = "   ```js\ncode\n\nmore code\n";
		expect(splitStreamingMarkdown(text)).toEqual({ stable: "", tail: text });
	});

	it("treats whitespace-only lines as block boundaries", () => {
		const text = "paragraph\n \t \nnext";
		expect(splitStreamingMarkdown(text)).toEqual({
			stable: "paragraph\n \t \n",
			tail: "next",
		});
	});

	it("keeps a trailing blank line in stable with an empty tail", () => {
		const text = "done paragraph\n\n";
		expect(splitStreamingMarkdown(text)).toEqual({
			stable: "done paragraph\n\n",
			tail: "",
		});
	});
});
