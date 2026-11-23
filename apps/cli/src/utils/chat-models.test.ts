import { describe, expect, it } from "vitest";
import { filterChatModels, isChatProviderModel } from "./chat-models";

describe("chat model filtering", () => {
	it("keeps unknown and text-capable catalog models", () => {
		const models = {
			legacy: { name: "Legacy" },
			chat: {
				name: "Chat",
				modalities: { input: ["text"] as const, output: ["text"] as const },
			},
			mixed: {
				name: "Mixed",
				modalities: {
					input: ["text", "image"] as const,
					output: ["text", "image"] as const,
				},
			},
		};

		expect(Object.keys(filterChatModels(models))).toEqual([
			"legacy",
			"chat",
			"mixed",
		]);
	});

	it("removes dedicated transcription and media-generation models", () => {
		const models = {
			operationOnly: { operation: "speech-generation" as const },
			whisper: {
				modalities: { input: ["audio"] as const, output: ["text"] as const },
			},
			tts: {
				modalities: { input: ["text"] as const, output: ["audio"] as const },
			},
		};

		expect(filterChatModels(models)).toEqual({});
	});

	it("filters flattened provider model responses with the same rule", () => {
		expect(isChatProviderModel({ operation: "transcription" })).toBe(false);
		expect(
			isChatProviderModel({
				inputModalities: ["audio"],
				outputModalities: ["text"],
			}),
		).toBe(false);
		expect(
			isChatProviderModel({
				inputModalities: ["text", "image"],
				outputModalities: ["text"],
			}),
		).toBe(true);
		expect(isChatProviderModel({})).toBe(true);
	});
});
