import { describe, expect, it } from "vitest";
import {
	getComposerHighlights,
	normalizeMentionPath,
	stripMentionTrailingPunctuation,
} from "./composer-tokens";

describe("getComposerHighlights", () => {
	it("highlights only a leading, known slash command", () => {
		const highlight = (input: string) =>
			getComposerHighlights(
				input,
				new Set(["compact", "release"]),
				() => false,
			);
		expect(highlight("  /Release v2")).toEqual([{ start: 2, end: 10 }]);
		expect(highlight("/compact")).toEqual([{ start: 0, end: 8 }]);
		expect(highlight("/comp")).toEqual([]);
		expect(highlight("/compactly")).toEqual([]);
		expect(highlight("please /compact")).toEqual([]);
	});

	it("highlights mentions of known workspace files", () => {
		const known = new Set(["src/app.ts", "README.md"]);
		const highlight = (input: string) =>
			getComposerHighlights(input, new Set(["compact"]), (path) =>
				known.has(path),
			);
		expect(highlight("/compact @src/app.ts, then @README.md")).toEqual([
			{ start: 0, end: 8 },
			{ start: 9, end: 20 },
			{ start: 27, end: 37 },
		]);
		expect(highlight("@src/app")).toEqual([]);
		expect(highlight("mail me@src/app.ts")).toEqual([]);
	});

	it("matches normalized mention paths exactly, never by suffix", () => {
		const attached = new Set(["docs/README.md"]);
		const highlight = (input: string) =>
			getComposerHighlights(input, new Set(), (path) => attached.has(path));
		expect(highlight("Review @README.md and @docs/README.md")).toEqual([
			{ start: 22, end: 37 },
		]);
		expect(highlight("see @./docs/README.md!")).toEqual([
			{ start: 4, end: 21 },
		]);
	});

	it("strips trailing punctuation without backtracking on long runs", () => {
		expect(stripMentionTrailingPunctuation("src/app.ts),.")).toBe("src/app.ts");
		const adversarial = `${"!".repeat(50_000)}file.ts`;
		const started = performance.now();
		expect(stripMentionTrailingPunctuation(adversarial)).toBe(adversarial);
		expect(performance.now() - started).toBeLessThan(50);
	});
});

describe("normalizeMentionPath", () => {
	it("collapses dot segments and backslashes", () => {
		expect(normalizeMentionPath("./docs/../src\\app.ts")).toBe("src/app.ts");
		expect(normalizeMentionPath("/abs//path/./a.ts")).toBe("/abs/path/a.ts");
	});
});
