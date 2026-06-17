import type { ClineRecommendedModelsData } from "@cline/core";
import { describe, expect, it } from "vitest";
import {
	buildClineModelEntries,
	buildClineModelPickerDisplayRows,
	getClineModelPickerDisplayRowsWindow,
	resolveClineModelProviderId,
} from "./cline-model-picker-utils";

const data: ClineRecommendedModelsData = {
	clinePass: [
		{
			id: "cline-pass/glm-5.1",
			name: "GLM 5.1",
			description: "Cline Pass model",
			tags: ["PASS"],
		},
	],
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
	it("builds tiered entries with browse action at the end while hiding Cline Pass by default", () => {
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
			{
				kind: "model",
				tier: "free",
				model: { id: "deepseek/deepseek-chat" },
			},
			{
				kind: "model",
				tier: "free",
				model: { id: "qwen/qwen3-coder" },
			},
			{ kind: "browse" },
		]);
	});

	it("includes Cline Pass models when enabled", () => {
		expect(
			buildClineModelEntries(data, { includeClinePass: true }).slice(0, 2),
		).toMatchObject([
			{
				kind: "model",
				tier: "clinePass",
				model: { id: "cline-pass/glm-5.1" },
			},
			{
				kind: "model",
				tier: "recommended",
				model: { id: "anthropic/claude-sonnet-4.6" },
			},
		]);
	});

	it("maps Cline Pass models to the cline-pass provider", () => {
		expect(resolveClineModelProviderId("clinePass")).toBe("cline-pass");
		expect(resolveClineModelProviderId("recommended")).toBe("cline");
		expect(resolveClineModelProviderId("free")).toBe("cline");
	});

	it("builds flat display rows for every picker entry", () => {
		const entries = buildClineModelEntries(data, { includeClinePass: true });
		const rows = buildClineModelPickerDisplayRows(entries);

		expect(
			rows.map((row) =>
				row.kind === "model"
					? { kind: row.kind, entryIndex: row.entryIndex }
					: row,
			),
		).toEqual([
			{ kind: "model", entryIndex: 0 },
			{ kind: "model", entryIndex: 1 },
			{ kind: "model", entryIndex: 2 },
			{ kind: "model", entryIndex: 3 },
			{ kind: "model", entryIndex: 4 },
			{
				kind: "browse",
				key: "browse-all",
				label: "Browse all models...",
				entryIndex: 5,
			},
		]);
	});

	it("windows flat display rows around selected indexes", () => {
		const entries = buildClineModelEntries(data);
		const rows = buildClineModelPickerDisplayRows(entries);

		const window = getClineModelPickerDisplayRowsWindow(rows, 3, 3);
		expect(
			window.visibleRows.some(
				(row) => row.kind === "model" && row.entryIndex === 3,
			),
		).toBe(true);
	});
});
