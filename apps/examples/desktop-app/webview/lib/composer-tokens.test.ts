import { describe, expect, it } from "vitest";
import { getComposerHighlights } from "./composer-tokens";

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
});
