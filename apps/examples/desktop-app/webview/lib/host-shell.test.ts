import { describe, expect, it } from "vitest";
import {
	appendToPromptDraft,
	formatHostPromptContext,
	parseHostPromptContext,
} from "./host-shell";

describe("parseHostPromptContext", () => {
	it("accepts a well-formed payload", () => {
		expect(
			parseHostPromptContext({
				path: "src/a.ts",
				text: "x",
				startLine: 3,
				endLine: 4,
				language: "ts",
			}),
		).toEqual({
			path: "src/a.ts",
			text: "x",
			startLine: 3,
			endLine: 4,
			language: "ts",
		});
	});

	it("rejects payloads without a path or text", () => {
		expect(parseHostPromptContext(null)).toBeNull();
		expect(parseHostPromptContext({ path: "a.ts" })).toBeNull();
		expect(parseHostPromptContext({ text: "x" })).toBeNull();
	});

	it("drops non-integer line numbers", () => {
		expect(
			parseHostPromptContext({ path: "a.ts", text: "x", startLine: "3" }),
		).toMatchObject({ startLine: undefined });
	});
});

describe("formatHostPromptContext", () => {
	it("keeps the mention a bare path so the SDK can attach the file", () => {
		expect(
			formatHostPromptContext({
				path: "src/app.ts",
				startLine: 10,
				endLine: 12,
				language: "ts",
				text: "const a = 1;",
			}),
		).toBe("@src/app.ts (lines 10-12)\n```ts\nconst a = 1;\n```\n");
	});

	it("writes a single line without a range", () => {
		expect(
			formatHostPromptContext({
				path: "a.ts",
				startLine: 5,
				endLine: 5,
				text: "x\n",
			}),
		).toBe("@a.ts (line 5)\n```\nx\n```\n");
	});

	it("grows the fence past backticks in the selection", () => {
		const block = formatHostPromptContext({
			path: "README.md",
			text: "```js\ncode\n```",
		});
		expect(block.split("\n")[1]).toBe("````");
		expect(block.trimEnd().endsWith("````")).toBe(true);
	});

	it("can't mention a path with spaces, so writes it as code", () => {
		expect(
			formatHostPromptContext({ path: "My Docs/a.ts", text: "x" }),
		).toMatch(/^`My Docs\/a\.ts`\n/);
	});
});

describe("appendToPromptDraft", () => {
	it("replaces an empty draft", () => {
		expect(appendToPromptDraft("  \n", "block")).toBe("block");
	});

	it("separates from existing text with one blank line", () => {
		expect(appendToPromptDraft("fix this:\n\n\n", "block")).toBe(
			"fix this:\n\nblock",
		);
	});
});
