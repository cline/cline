import { describe, expect, it, vi } from "vitest";
import {
	createContextBar,
	formatStatusBarAgentLabel,
	formatStatusBarAgentName,
	formatStatusBarUsageText,
	resolveContextBarFilledForeground,
} from "./status-bar";

vi.mock("@opentui/react", () => ({
	useTerminalDimensions: () => ({ width: 80, height: 24 }),
}));

describe("createContextBar", () => {
	it("keeps a stable width while changing segment lengths", () => {
		expect(createContextBar(0, 100)).toEqual({
			filled: "",
			empty: "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
		});
		expect(createContextBar(50, 100)).toEqual({
			filled: "\u2588\u2588\u2588\u2588",
			empty: "\u2588\u2588\u2588\u2588",
		});
		expect(createContextBar(100, 100)).toEqual({
			filled: "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
			empty: "",
		});
	});

	it("shows a non-empty fill when usage is above zero", () => {
		expect(createContextBar(7_000, 1_000_000)).toEqual({
			filled: "\u2588",
			empty: "\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
		});
	});

	it("reserves the final segment for usage at or above the limit", () => {
		expect(createContextBar(999_999, 1_000_000)).toEqual({
			filled: "\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
			empty: "\u2588",
		});
		expect(createContextBar(1_000_000, 1_000_000)).toEqual({
			filled: "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
			empty: "",
		});
	});

	it("uses explicit white when terminal foreground would inherit gray", () => {
		expect(resolveContextBarFilledForeground(undefined)).toBe("#ffffff");
		expect(resolveContextBarFilledForeground("#1a1a1a")).toBe("#1a1a1a");
	});
});

describe("formatStatusBarAgentName", () => {
	it("keeps short names intact", () => {
		expect(formatStatusBarAgentName("reviewer")).toBe("reviewer");
		expect(formatStatusBarAgentName("  reviewer  ")).toBe("reviewer");
	});

	it("truncates long names with an ellipsis", () => {
		expect(formatStatusBarAgentName("documentation-specialist")).toBe(
			"documentation...",
		);
		expect(formatStatusBarAgentName("documentation-specialist").length).toBe(
			16,
		);
	});

	it("handles very narrow limits without negative slicing", () => {
		expect(formatStatusBarAgentName("reviewer", 3)).toBe("...");
		expect(formatStatusBarAgentName("reviewer", 0)).toBe("");
	});
});

describe("formatStatusBarAgentLabel", () => {
	it("wraps the active agent name in brackets", () => {
		expect(formatStatusBarAgentLabel("reviewer")).toBe("[reviewer]");
	});

	it("truncates inside the brackets to fit the label width", () => {
		expect(formatStatusBarAgentLabel("documentation-specialist", 18)).toBe(
			"[documentation...]",
		);
		expect(
			formatStatusBarAgentLabel("documentation-specialist", 18)?.length,
		).toBe(18);
	});

	it("hides blank or too-narrow labels", () => {
		expect(formatStatusBarAgentLabel("   ")).toBeUndefined();
		expect(formatStatusBarAgentLabel("reviewer", 4)).toBeUndefined();
	});
});

describe("formatStatusBarUsageText", () => {
	it("includes cost when usage cost is visible", () => {
		expect(
			formatStatusBarUsageText({
				totalTokens: 12_345,
				totalCost: 0.123,
				showCost: true,
			}),
		).toBe("(12,345) $0.12");
	});

	it("omits cost when usage cost is hidden", () => {
		expect(
			formatStatusBarUsageText({
				totalTokens: 12_345,
				totalCost: 0.123,
				showCost: false,
			}),
		).toBe("(12,345)");
	});
});
