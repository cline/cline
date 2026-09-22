// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
	MODEL_SELECTION_STORAGE_KEY,
	parseModelSelectionStorage,
	readModelSelectionStorageFromWindow,
	rememberReasoningSelectionInWindow,
} from "./model-selection";

afterEach(() => {
	window.localStorage.clear();
});

describe("model selection storage", () => {
	it("parses provider/model picks that carry no reasoning fields", () => {
		expect(
			parseModelSelectionStorage(
				JSON.stringify({
					lastProvider: "cline",
					lastModelByProvider: { cline: "test-model" },
				}),
			),
		).toEqual({
			lastProvider: "cline",
			lastModelByProvider: { cline: "test-model" },
		});
	});

	it("parses a remembered reasoning choice", () => {
		expect(
			parseModelSelectionStorage(
				JSON.stringify({
					lastProvider: "cline",
					lastModelByProvider: {},
					thinking: true,
					reasoningEffort: "high",
				}),
			),
		).toEqual({
			lastProvider: "cline",
			lastModelByProvider: {},
			thinking: true,
			reasoningEffort: "high",
		});
	});

	it("drops unknown levels and non-boolean thinking flags", () => {
		expect(
			parseModelSelectionStorage(
				JSON.stringify({
					lastProvider: "cline",
					lastModelByProvider: {},
					thinking: "yes",
					reasoningEffort: "extreme",
				}),
			),
		).toEqual({
			lastProvider: "cline",
			lastModelByProvider: {},
		});
	});

	it("remembers the choice without dropping provider/model picks", () => {
		window.localStorage.setItem(
			MODEL_SELECTION_STORAGE_KEY,
			JSON.stringify({
				lastProvider: "cline",
				lastModelByProvider: { cline: "test-model" },
			}),
		);

		rememberReasoningSelectionInWindow({
			thinking: true,
			reasoningEffort: "high",
		});

		expect(readModelSelectionStorageFromWindow()).toEqual({
			lastProvider: "cline",
			lastModelByProvider: { cline: "test-model" },
			thinking: true,
			reasoningEffort: "high",
		});
	});

	it("clears a stale level when the composer switches to None", () => {
		rememberReasoningSelectionInWindow({
			thinking: true,
			reasoningEffort: "high",
		});
		rememberReasoningSelectionInWindow({
			thinking: false,
			reasoningEffort: undefined,
		});

		const stored = readModelSelectionStorageFromWindow();
		expect(stored.thinking).toBe(false);
		expect(stored.reasoningEffort).toBeUndefined();
	});
});
