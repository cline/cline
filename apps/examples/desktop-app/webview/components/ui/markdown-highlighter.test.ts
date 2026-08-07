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
			"sql",
			"tsx",
			"typescript",
			"yaml",
		]);
		expect(markdownCodeHighlighter.supportsLanguage("ts")).toBe(true);
		expect(markdownCodeHighlighter.supportsLanguage("rust")).toBe(false);
	});

	test("supports SQL and aliases", () => {
		expect(markdownCodeHighlighter.supportsLanguage("sql")).toBe(true);
		expect(markdownCodeHighlighter.supportsLanguage("pgsql")).toBe(true);
		expect(markdownCodeHighlighter.supportsLanguage("postgres")).toBe(true);
		expect(markdownCodeHighlighter.supportsLanguage("postgresql")).toBe(true);
	});

	test("raw highlight preserves blank lines for unsupported languages", () => {
		const result = markdownCodeHighlighter.highlight(
			{
				code: "line1\n\nline3",
				language: "rust",
				themes: ["github-light", "github-dark"],
			},
			undefined,
		);

		// rawHighlight returns synchronously (not null) for unsupported languages
		expect(result).not.toBe(null);

		// 3 lines: "line1", "", "line3" — the empty line must still have a token
		const tokens = result?.tokens ?? [];
		expect(tokens).toHaveLength(3);
		expect(tokens[1]).toHaveLength(1);
		expect(tokens[1][0].content).toBe("");
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
