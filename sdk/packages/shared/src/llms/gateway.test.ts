import { describe, expect, it } from "vitest";
import { modelSupportsImages } from "./gateway";

describe("modelSupportsImages", () => {
	// The three catalog states a model definition can be in — the resolved
	// boolean is what gets passed into the message formatter, so a text-only
	// model must never resolve to `true` and be sent image content.

	it("returns true when capabilities explicitly include 'images'", () => {
		expect(
			modelSupportsImages({
				capabilities: ["images", "tools", "reasoning"],
			}),
		).toBe(true);
	});

	it("returns false when capabilities are present but omit 'images'", () => {
		expect(
			modelSupportsImages({
				capabilities: ["tools", "reasoning", "prompt-cache"],
			}),
		).toBe(false);
	});

	it("returns false when capabilities are missing (unknown catalog entry)", () => {
		// A model whose catalog entry has no `capabilities` field must not be
		// sent images — otherwise text-only providers reject the whole request.
		expect(modelSupportsImages({})).toBe(false);
		expect(modelSupportsImages({ capabilities: undefined })).toBe(false);
	});

	it("returns false for an explicitly empty capability list", () => {
		expect(modelSupportsImages({ capabilities: [] })).toBe(false);
	});
});
