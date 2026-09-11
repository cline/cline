import { describe, expect, it } from "vitest";
import {
	buildHistoryFooterText,
	HISTORY_EXPORT_OPTIONS,
	resolveHistoryExportPickerAction,
} from "./history-export-picker";

describe("history export picker", () => {
	it("offers HTML and JSON exports", () => {
		expect(HISTORY_EXPORT_OPTIONS.map((option) => option.format)).toEqual([
			"html",
			"json",
		]);
	});

	it("selects JSON with the down arrow and Enter", () => {
		const initialState = { sessionId: "sess_1", selectedIndex: 0 };
		const navigation = resolveHistoryExportPickerAction(initialState, {
			name: "down",
		});
		expect(navigation).toEqual({
			kind: "update",
			state: { sessionId: "sess_1", selectedIndex: 1 },
		});
		if (navigation.kind !== "update") {
			throw new Error("Expected export picker navigation");
		}

		expect(
			resolveHistoryExportPickerAction(navigation.state, { name: "enter" }),
		).toEqual({
			kind: "export",
			sessionId: "sess_1",
			format: "json",
		});
	});

	it("wraps selection and supports cancelling", () => {
		const initialState = { sessionId: "sess_1", selectedIndex: 0 };

		expect(
			resolveHistoryExportPickerAction(initialState, { name: "up" }),
		).toEqual({
			kind: "update",
			state: { sessionId: "sess_1", selectedIndex: 1 },
		});
		expect(
			resolveHistoryExportPickerAction(initialState, { name: "escape" }),
		).toEqual({ kind: "cancel" });
	});

	it("includes available history actions in the footer", () => {
		expect(
			buildHistoryFooterText({ canDelete: true, canExport: true }),
		).toContain("\u2190 delete, \u2192 export");
	});
});
