import { describe, expect, it } from "vitest";
import { buildPromptContext } from "./prompt-context";

describe("buildPromptContext", () => {
	it("uses the workspace-relative path and 1-based lines", () => {
		expect(
			buildPromptContext({
				absolutePath: "/repo/src/app.ts",
				relativePath: "src/app.ts",
				languageId: "typescript",
				startLine: 9,
				endLine: 11,
				text: "x",
			}),
		).toEqual({
			path: "src/app.ts",
			startLine: 10,
			endLine: 12,
			language: "typescript",
			text: "x",
		});
	});

	it("falls back to the absolute path outside the workspace", () => {
		expect(
			buildPromptContext({
				absolutePath: "/tmp/scratch.py",
				languageId: "python",
				startLine: 0,
				endLine: 0,
				text: "x",
			}).path,
		).toBe("/tmp/scratch.py");
	});

	it("normalises Windows separators for @mentions", () => {
		expect(
			buildPromptContext({
				absolutePath: "C:\\repo\\src\\a.ts",
				relativePath: "src\\a.ts",
				languageId: "typescript",
				startLine: 0,
				endLine: 0,
				text: "x",
			}).path,
		).toBe("src/a.ts");
	});

	it("maps VS Code language ids to fence tags", () => {
		const base = {
			absolutePath: "/a",
			startLine: 0,
			endLine: 0,
			text: "x",
		};
		expect(
			buildPromptContext({ ...base, languageId: "typescriptreact" }).language,
		).toBe("tsx");
		expect(
			buildPromptContext({ ...base, languageId: "plaintext" }).language,
		).toBeUndefined();
	});
});
