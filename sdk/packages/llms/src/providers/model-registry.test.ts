import { afterEach, describe, expect, it } from "vitest";
import {
	getModelsForProvider,
	registerModel,
	registerProvider,
	resetRegistry,
} from "./model-registry";

const PROVIDER_ID = "model-filter-test";

afterEach(() => {
	resetRegistry();
});

describe("getModelsForProvider", () => {
	it("filters the merged provider catalog through query options", async () => {
		registerProvider({
			provider: {
				id: PROVIDER_ID,
				name: "Model Filter Test",
				defaultModelId: "legacy",
				client: "custom",
				source: "system",
			},
			models: {
				legacy: { id: "legacy", name: "Legacy" },
				chat: {
					id: "chat",
					name: "Chat",
					operation: "language",
					modalities: { input: ["text"], output: ["text"] },
				},
				mixed: {
					id: "mixed",
					name: "Mixed",
					operation: "language",
					modalities: {
						input: ["text", "image"],
						output: ["text", "image"],
					},
				},
				image: {
					id: "image",
					name: "Image",
					operation: "image-generation",
					modalities: { input: ["text"], output: ["image"] },
				},
				transcription: {
					id: "transcription",
					name: "Transcription",
					operation: "transcription",
					modalities: { input: ["audio"], output: ["text"] },
				},
			},
		});
		registerModel(PROVIDER_ID, "speech", {
			id: "speech",
			name: "Speech",
			operation: "speech-generation",
			modalities: { input: ["text"], output: ["audio"] },
		});

		expect(Object.keys(await getModelsForProvider(PROVIDER_ID))).toEqual([
			"legacy",
			"chat",
			"mixed",
			"image",
			"transcription",
			"speech",
		]);
		expect(
			Object.keys(await getModelsForProvider(PROVIDER_ID, { filter: "chat" })),
		).toEqual(["legacy", "chat", "mixed"]);
	});
});
