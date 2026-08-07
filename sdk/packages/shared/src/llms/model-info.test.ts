import { describe, expect, it } from "vitest";
import { supportsChatModalities } from "./model-info";

describe("supportsChatModalities", () => {
	it("keeps models with absent legacy modality metadata", () => {
		expect(supportsChatModalities(undefined)).toBe(true);
		expect(supportsChatModalities({})).toBe(true);
	});

	it("keeps text chat and mixed-output models", () => {
		expect(supportsChatModalities({ input: ["text"], output: ["text"] })).toBe(
			true,
		);
		expect(
			supportsChatModalities({
				input: ["text", "image"],
				output: ["text", "image"],
			}),
		).toBe(true);
	});

	it("rejects dedicated transcription and media-generation models", () => {
		expect(supportsChatModalities({ input: ["audio"], output: ["text"] })).toBe(
			false,
		);
		expect(supportsChatModalities({ input: ["text"], output: ["audio"] })).toBe(
			false,
		);
		expect(supportsChatModalities({ input: ["text"], output: ["image"] })).toBe(
			false,
		);
	});
});
