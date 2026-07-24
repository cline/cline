import { describe, expect, test } from "vitest";
import {
	markdownCodeHighlighter,
	SUPPORTED_MARKDOWN_LANGUAGES,
} from "./markdown-highlighter";

function highlight(code: string, language: "typescript") {
	return new Promise<
		NonNullable<ReturnType<typeof markdownCodeHighlighter.highlight>>
	>((resolve) => {
		const immediate = markdownCodeHighlighter.highlight(
			{ code, language, themes: ["github-light", "github-dark"] },
			resolve,
		);
		if (immediate) resolve(immediate);
	});
}

describe("markdownCodeHighlighter", () => {
	test("keeps the syntax bundle to the shared supported language set", () => {
		expect(SUPPORTED_MARKDOWN_LANGUAGES).toEqual([
			"bash",
			"css",
			"diff",
			"html",
			"javascript",
			"json",
			"jsonc",
			"jsx",
			"markdown",
			"python",
			"shellscript",
			"tsx",
			"typescript",
			"yaml",
		]);
		expect(markdownCodeHighlighter.supportsLanguage("ts")).toBe(true);
		expect(markdownCodeHighlighter.supportsLanguage("rust")).toBe(false);
	});

	test("loads a supported grammar and returns themed tokens", async () => {
		const result = await highlight("const answer: number = 42;", "typescript");

		expect(
			result.tokens
				.flat()
				.map((token) => token.content)
				.join(""),
		).toBe("const answer: number = 42;");
		expect(result.tokens.flat().some((token) => token.htmlStyle?.color)).toBe(
			true,
		);
	});
});
