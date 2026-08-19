import { describe, expect, it } from "vitest";
import {
	isChatCompatibleModel,
	ModelInfoSchema,
	modelHasCapability,
	modelSupportsToolCalling,
	supportsChatModalities,
} from "./model-info";

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

describe("isChatCompatibleModel", () => {
	it("keeps legacy and explicit language models", () => {
		expect(isChatCompatibleModel({})).toBe(true);
		expect(
			isChatCompatibleModel({
				operation: "language",
				modalities: { input: ["text"], output: ["text"] },
			}),
		).toBe(true);
	});

	it("rejects non-language operations even without modality metadata", () => {
		expect(isChatCompatibleModel({ operation: "transcription" })).toBe(false);
		expect(isChatCompatibleModel({ operation: "speech-generation" })).toBe(
			false,
		);
		expect(isChatCompatibleModel({ operation: "image-generation" })).toBe(
			false,
		);
	});

	it("rejects language models without text chat modalities", () => {
		expect(
			isChatCompatibleModel({
				operation: "language",
				modalities: { input: ["text"], output: ["image"] },
			}),
		).toBe(false);
	});
});

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
