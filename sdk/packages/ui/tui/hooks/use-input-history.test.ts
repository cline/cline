import { describe, expect, it } from "vitest";
import { getHistoryNavigationAction } from "./use-input-history";

const basePosition = {
	cursorOffset: 4,
	textLength: 10,
	visualRow: 1,
	height: 3,
	virtualLineCount: 3,
};

describe("history navigation boundaries", () => {
	it("navigates previous history when the cursor is at the start", () => {
		expect(
			getHistoryNavigationAction({
				...basePosition,
				direction: "up",
				cursorOffset: 0,
				visualRow: 0,
			}),
		).toBe("navigate");
	});

	it("moves to the start before previous history on the first visual row", () => {
		expect(
			getHistoryNavigationAction({
				...basePosition,
				direction: "up",
				cursorOffset: 5,
				visualRow: 0,
			}),
		).toBe("move-to-boundary");
	});

	it("lets up move through text when the cursor is below the first visual row", () => {
		expect(
			getHistoryNavigationAction({
				...basePosition,
				direction: "up",
				cursorOffset: 5,
				visualRow: 1,
			}),
		).toBe("ignore");
	});

	it("navigates next history when the cursor is at the end", () => {
		expect(
			getHistoryNavigationAction({
				...basePosition,
				direction: "down",
				cursorOffset: 10,
				visualRow: 2,
			}),
		).toBe("navigate");
	});

	it("moves to the end before next history on the last visual row", () => {
		expect(
			getHistoryNavigationAction({
				...basePosition,
				direction: "down",
				cursorOffset: 5,
				visualRow: 2,
			}),
		).toBe("move-to-boundary");
	});

	it("uses content height for the bottom row when the textarea is taller", () => {
		expect(
			getHistoryNavigationAction({
				...basePosition,
				direction: "down",
				cursorOffset: 5,
				visualRow: 0,
				height: 5,
				virtualLineCount: 1,
			}),
		).toBe("move-to-boundary");
	});

	it("lets down move through text when the cursor is above the last visual row", () => {
		expect(
			getHistoryNavigationAction({
				...basePosition,
				direction: "down",
				cursorOffset: 5,
				visualRow: 1,
			}),
		).toBe("ignore");
	});
});
