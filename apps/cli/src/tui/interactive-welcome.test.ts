import { describe, expect, it } from "vitest";
import { rankMentionPaths } from "./interactive-welcome";

describe("TUI file mention search ranking", () => {
	it("keeps initialism matches for compact and hyphenated input", () => {
		const paths = [
			"src/components/Button.tsx",
			"src/domain/MyAmazingClassDefinition.ts",
			"docs/MACD.md",
			"packages/core/src/runtime/manager.ts",
		];

		expect(rankMentionPaths(paths, "MACD", 10)).toEqual([
			"docs/MACD.md",
			"src/domain/MyAmazingClassDefinition.ts",
		]);
		expect(rankMentionPaths(paths, "M-A-C-D", 10)).toEqual([
			"docs/MACD.md",
			"src/domain/MyAmazingClassDefinition.ts",
		]);
	});

	it("normalizes common mention prefixes before matching workspace paths", () => {
		const paths = [
			"docs/architecture.md",
			"src/tui/interactive-welcome.ts",
			"src/tui/hooks/use-autocomplete.ts",
		];

		expect(rankMentionPaths(paths, "./src/tui", 10)).toEqual([
			"src/tui/hooks/use-autocomplete.ts",
			"src/tui/interactive-welcome.ts",
		]);
		expect(rankMentionPaths(paths, "/docs", 10)).toEqual([
			"docs/architecture.md",
		]);
	});

	it("ranks filename matches ahead of path-only fuzzy matches", () => {
		const paths = [
			"src/migrations/add-column.ts",
			"src/domain/MyAmazingClassDefinition.ts",
			"docs/classes.md",
		];

		expect(rankMentionPaths(paths, "class", 10)[0]).toBe("docs/classes.md");
	});
});
