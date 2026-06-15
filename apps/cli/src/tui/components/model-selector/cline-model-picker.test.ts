import type { ClineRecommendedModelsData } from "@cline/core";
import { describe, expect, it } from "vitest";
import {
	buildClineModelEntries,
	buildClineModelPickerDisplayRows,
	getClineModelPickerDisplayRowsWindow,
	getVisibleClineModelPickerEntries,
} from "./cline-model-picker-utils";

const data: ClineRecommendedModelsData = {
	clinePass: [],
	recommended: [
		{
			id: "anthropic/claude-sonnet-4.6",
			name: "Claude Sonnet 4.6",
			description: "Recommended Claude model",
			tags: ["BEST"],
		},
		{
			id: "openai/gpt-5.3-codex",
			name: "GPT-5.3 Codex",
			description: "Recommended Codex model",
			tags: [],
		},
	],
	free: [
		{
			id: "deepseek/deepseek-chat",
			name: "DeepSeek Chat",
			description: "Free DeepSeek model",
			tags: ["FREE"],
		},
		{
			id: "qwen/qwen3-coder",
			name: "Qwen3 Coder",
			description: "Free Qwen model",
			tags: ["FREE"],
		},
	],
};

describe("cline model picker helpers", () => {
	it("builds tiered entries with browse action at the end", () => {
		expect(buildClineModelEntries(data)).toMatchObject([
			{
				kind: "model",
				tier: "recommended",
				model: { id: "anthropic/claude-sonnet-4.6" },
			},
			{
				kind: "model",
				tier: "recommended",
				model: { id: "openai/gpt-5.3-codex" },
			},
			{ kind: "model", tier: "free", model: { id: "deepseek/deepseek-chat" } },
			{ kind: "model", tier: "free", model: { id: "qwen/qwen3-coder" } },
			{ kind: "browse" },
		]);
	});

	it("filters collapsed tiers while keeping browse selectable", () => {
		const visible = getVisibleClineModelPickerEntries(
			buildClineModelEntries(data),
			{
				recommended: true,
				free: false,
			},
		);

		expect(
			visible.map((entry) =>
				entry.kind === "model" ? entry.model.id : "browse",
			),
		).toEqual([
			"anthropic/claude-sonnet-4.6",
			"openai/gpt-5.3-codex",
			"browse",
		]);
	});

	it("windows display rows around focus indexes, including expandable headers", () => {
		const entries = buildClineModelEntries(data);
		const rows = buildClineModelPickerDisplayRows(
			entries,
			undefined,
			undefined,
			{
				recommended: false,
				free: true,
			},
		);

		const headers = rows.filter((row) => row.kind === "header");
		expect(headers).toMatchObject([
			{ tier: "recommended", focusIndex: 0, isExpanded: false },
			{ tier: "free", focusIndex: 1, isExpanded: true },
		]);

		const freeRows = rows.filter((row) => row.kind === "model");
		expect(freeRows).toMatchObject([
			{ entryIndex: 2, selectableIndex: 0, focusIndex: 2 },
			{ entryIndex: 3, selectableIndex: 1, focusIndex: 3 },
		]);

		const window = getClineModelPickerDisplayRowsWindow(rows, 3, 3);
		expect(
			window.visibleRows.some(
				(row) => row.kind === "model" && row.entryIndex === 3,
			),
		).toBe(true);
	});
});
