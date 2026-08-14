import { describe, expect, it } from "vitest";
import {
	ModelInfoSchema,
	modelHasCapability,
	modelSupportsToolCalling,
} from "./model-info";

describe("ModelInfoSchema operations", () => {
	it("preserves an explicit operation and its execution modes", () => {
		expect(
			ModelInfoSchema.parse({
				id: "openai/gpt-realtime-whisper",
				operation: "transcription",
				operationModes: ["streaming"],
				modalities: { input: ["audio"], output: ["text"] },
			}),
		).toMatchObject({
			operation: "transcription",
			operationModes: ["streaming"],
		});
	});

	it("rejects operation-specific flags from the generic capability list", () => {
		expect(
			ModelInfoSchema.safeParse({
				id: "legacy-realtime-model",
				capabilities: ["transcription-streaming"],
			}).success,
		).toBe(false);
	});
});

describe("modelHasCapability", () => {
	it("reads a populated capability list authoritatively", () => {
		const model = { capabilities: ["tools", "reasoning"] };

		expect(modelHasCapability(model, "tools")).toBe(true);
		expect(modelHasCapability(model, "images")).toBe(false);
		expect(
			modelHasCapability(model, "images", { assumeWhenUnspecified: true }),
		).toBe(false);
	});

	it("treats a missing capability list as unspecified", () => {
		expect(modelHasCapability({}, "tools")).toBe(false);
		expect(
			modelHasCapability({}, "tools", { assumeWhenUnspecified: true }),
		).toBe(true);
	});

	it("treats an empty capability list as unspecified, not as denial", () => {
		// Host boundaries (VS Code legacy ModelInfo, user overrides) can emit
		// empty arrays when no capability data was available; an empty list
		// carries no signal and must follow the check's declared default.
		const model = { capabilities: [] as string[] };

		expect(modelHasCapability(model, "tools")).toBe(false);
		expect(
			modelHasCapability(model, "tools", { assumeWhenUnspecified: true }),
		).toBe(true);
	});
});

describe("modelSupportsToolCalling", () => {
	it("fails open when capability metadata is missing or empty", () => {
		expect(modelSupportsToolCalling({})).toBe(true);
		expect(modelSupportsToolCalling({ capabilities: [] })).toBe(true);
	});

	it("trusts a populated capability list", () => {
		expect(modelSupportsToolCalling({ capabilities: ["tools"] })).toBe(true);
		expect(
			modelSupportsToolCalling({ capabilities: ["images", "prompt-cache"] }),
		).toBe(false);
	});
});
