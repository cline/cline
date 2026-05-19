import { describe, expect, it } from "vitest";
import {
	buildSearchableListRows,
	getSearchableListRowsWindow,
	type SearchableItem,
} from "./searchable-list";

function rowLabels(items: SearchableItem[]): string[] {
	return buildSearchableListRows(items).map((row) =>
		row.kind === "header" ? `header:${row.label}` : `item:${row.item.key}`,
	);
}

describe("searchable list sections", () => {
	it("adds section headers as separate rows", () => {
		expect(
			rowLabels([
				{ key: "cline", label: "Cline", section: "Popular" },
				{ key: "anthropic", label: "Anthropic", section: "Popular" },
				{ key: "deepseek", label: "DeepSeek", section: "Other" },
			]),
		).toEqual([
			"header:Popular",
			"item:cline",
			"item:anthropic",
			"header:Other",
			"item:deepseek",
		]);
	});

	it("keeps window counts based on selectable items", () => {
		const items: SearchableItem[] = [
			{ key: "cline", label: "Cline", section: "Popular" },
			{ key: "anthropic", label: "Anthropic", section: "Popular" },
			{ key: "openrouter", label: "OpenRouter", section: "Popular" },
			{ key: "deepseek", label: "DeepSeek", section: "Other" },
			{ key: "zai", label: "Zai", section: "Other" },
		];

		const listWindow = getSearchableListRowsWindow(items, 4, 4);

		expect(listWindow.showAbove).toBe(true);
		expect(listWindow.aboveCount).toBeGreaterThan(0);
		expect(
			listWindow.visibleRows.some(
				(row) => row.kind === "item" && row.item.key === "zai",
			),
		).toBe(true);
		expect(listWindow.visibleRows.every((row) => row.kind !== "header")).toBe(
			false,
		);
	});

	it("does not hide only a section header before showing the above indicator", () => {
		const items: SearchableItem[] = [
			{ key: "cline", label: "Cline", section: "Popular" },
			{ key: "openai-codex", label: "ChatGPT", section: "Popular" },
			{ key: "deepseek", label: "DeepSeek", section: "Popular" },
			{ key: "anthropic", label: "Anthropic", section: "Popular" },
			{ key: "openrouter", label: "OpenRouter", section: "Popular" },
			{ key: "ollama", label: "Ollama", section: "Popular" },
			{ key: "bedrock", label: "Bedrock", section: "Popular" },
			{ key: "litellm", label: "LiteLLM", section: "Popular" },
			{ key: "gemini", label: "Gemini", section: "Popular" },
			{ key: "zai", label: "Zai", section: "Other" },
		];

		const listWindow = getSearchableListRowsWindow(items, 4, 10);

		expect(listWindow.showAbove).toBe(false);
		expect(listWindow.visibleRows[0]).toMatchObject({
			kind: "header",
			label: "Popular",
		});
	});
});
