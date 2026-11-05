import { describe, expect, it } from "vitest";
import {
	formatScreenshotFeedback,
	type ScreenshotNote,
} from "./screenshot-feedback";

const note = (overrides: Partial<ScreenshotNote>): ScreenshotNote => ({
	id: "note",
	sessionId: "ses-one",
	artifactId: "frame",
	screenshotTitle: "Home opens",
	x: 0.1,
	y: 0.14,
	text: "Make the search bar more prominent",
	...overrides,
});

describe("formatScreenshotFeedback", () => {
	it("returns the prompt unchanged without notes", () => {
		expect(formatScreenshotFeedback("Hello", [], true)).toBe("Hello");
	});

	it("numbers markers and boxes after the prompt", () => {
		expect(
			formatScreenshotFeedback(
				"Keep the purple theme.",
				[
					note({}),
					note({
						id: "box",
						x: 0.24,
						y: 0.84,
						width: 0.11,
						height: 0.07,
						text: "Show the model name",
					}),
				],
				true,
			),
		).toBe(
			[
				"Keep the purple theme.",
				"",
				"Feedback on UX verification screenshots (numbered markers are drawn on the attached images; positions are x, y from the top-left):",
				'1. "Home opens", marker at (10%, 14%): Make the search bar more prominent',
				'2. "Home opens", box from (24%, 84%) to (35%, 91%): Show the model name',
			].join("\n"),
		);
	});

	it("omits the attachment hint and empty prompt when sending notes alone", () => {
		expect(formatScreenshotFeedback("", [note({})], false)).toBe(
			[
				"Feedback on UX verification screenshots (positions are x, y from the top-left):",
				'1. "Home opens", marker at (10%, 14%): Make the search bar more prominent',
			].join("\n"),
		);
	});
});
