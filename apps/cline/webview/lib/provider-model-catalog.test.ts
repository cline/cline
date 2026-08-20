import { describe, expect, it, vi } from "vitest";
import {
	buildProviderModelCatalog,
	filterChatModels,
	isDedicatedTranscriptionModel,
	publishProviderModels,
	selectTranscriptionModel,
	subscribeToProviderModels,
	supportsAudio,
} from "./provider-model-catalog";
import type { Provider } from "./provider-schema";

describe("transcription model selection", () => {
	it("distinguishes speech-to-text from text-to-speech and chat audio", () => {
		expect(
			isDedicatedTranscriptionModel({
				id: "whisper",
				name: "Whisper",
				operation: "transcription",
				inputModalities: ["audio"],
				outputModalities: ["text"],
			}),
		).toBe(true);
		expect(
			isDedicatedTranscriptionModel({
				id: "elevenlabs",
				name: "ElevenLabs",
				inputModalities: ["text"],
				outputModalities: ["audio"],
			}),
		).toBe(false);
		expect(
			isDedicatedTranscriptionModel({
				id: "omni",
				name: "Omni",
				inputModalities: ["text", "audio"],
				outputModalities: ["text"],
			}),
		).toBe(false);
	});

	it("detects audio support in either modality direction", () => {
		expect(
			supportsAudio({
				id: "transcription",
				name: "Transcription",
				inputModalities: ["audio"],
				outputModalities: ["text"],
			}),
		).toBe(true);
		expect(
			supportsAudio({
				id: "speech",
				name: "Speech",
				inputModalities: ["text"],
				outputModalities: ["audio"],
			}),
		).toBe(true);
		expect(
			supportsAudio({
				id: "text",
				name: "Text",
				inputModalities: ["text"],
				outputModalities: ["text"],
			}),
		).toBe(false);
	});

	it("selects only the explicitly configured enabled model", () => {
		const providers: Provider[] = [
			{
				id: "groq",
				name: "Groq",
				models: 1,
				color: "#000000",
				letter: "GR",
				enabled: true,
				modelList: [
					{
						id: "whisper-large-v3",
						name: "Whisper",
						operation: "transcription",
						inputModalities: ["audio"],
						outputModalities: ["text"],
					},
				],
			},
			{
				id: "nvidia",
				name: "Nvidia",
				models: 1,
				color: "#000000",
				letter: "NV",
				enabled: true,
				modelList: [
					{
						id: "whisper-large-v3",
						name: "Whisper",
						operation: "transcription",
						inputModalities: ["audio"],
						outputModalities: ["text"],
					},
				],
			},
		];

		expect(
			selectTranscriptionModel(providers, {
				providerId: "nvidia",
				modelId: "whisper-large-v3",
			}),
		).toEqual({
			providerId: "nvidia",
			providerName: "Nvidia",
			modelId: "whisper-large-v3",
			modelName: "Whisper",
			supportsStreaming: false,
		});
		expect(selectTranscriptionModel(providers, undefined)).toBeNull();
	});

	it("keeps voice selection in the provider catalog", () => {
		const elevenLabs: Provider = {
			id: "elevenlabs",
			name: "ElevenLabs",
			models: 1,
			color: "#000000",
			letter: "EL",
			enabled: true,
			modelList: [
				{
					id: "scribe_v2",
					name: "Scribe v2",
					operation: "transcription",
					inputModalities: ["audio"],
					outputModalities: ["text"],
				},
			],
		};

		const selection = {
			providerId: "elevenlabs",
			modelId: "scribe_v2",
		};
		const catalog = buildProviderModelCatalog([elevenLabs], selection);
		expect(catalog.providerModels.elevenlabs).toEqual([]);
		expect(catalog.voiceInput).toMatchObject({
			providerId: "elevenlabs",
			modelId: "scribe_v2",
			supportsStreaming: false,
		});
	});

	it("keeps transcription-only models out of chat while retaining chat audio models", () => {
		const provider: Provider = {
			id: "openai",
			name: "OpenAI",
			models: 3,
			color: "#000000",
			letter: "OA",
			enabled: true,
			modelList: [
				{
					id: "gpt-4o-mini-transcribe",
					name: "GPT-4o mini Transcribe",
					operation: "transcription",
					inputModalities: ["audio"],
					outputModalities: ["text"],
				},
				{
					id: "gpt-audio",
					name: "GPT Audio",
					inputModalities: ["text", "audio"],
					outputModalities: ["text", "audio"],
				},
				{
					id: "gpt-text",
					name: "GPT Text",
					inputModalities: ["text"],
					outputModalities: ["text"],
				},
			],
		};

		const catalog = buildProviderModelCatalog([provider]);
		expect(catalog.providerModels.openai).toEqual(["gpt-audio", "gpt-text"]);
		expect(
			filterChatModels(provider.modelList).map((model) => model.id),
		).toEqual(["gpt-audio", "gpt-text"]);

		const listener = vi.fn();
		const unsubscribe = subscribeToProviderModels(listener);
		try {
			publishProviderModels("openai", provider.modelList ?? []);
			expect(listener).toHaveBeenCalledWith(
				"openai",
				expect.arrayContaining([
					expect.objectContaining({ id: "gpt-audio" }),
					expect.objectContaining({ id: "gpt-text" }),
				]),
			);
			expect(listener.mock.calls[0]?.[1]).toHaveLength(2);
		} finally {
			unsubscribe();
		}
	});

	it("preserves streaming transcription capability for the composer", () => {
		const provider: Provider = {
			id: "vercel-ai-gateway",
			name: "Vercel AI Gateway",
			models: 1,
			color: "#000000",
			letter: "VA",
			enabled: true,
			modelList: [
				{
					id: "openai/gpt-realtime-whisper",
					name: "GPT Realtime Whisper",
					operation: "transcription",
					operationModes: ["streaming"],
					inputModalities: ["audio"],
					outputModalities: ["text"],
				},
			],
		};

		expect(
			selectTranscriptionModel([provider], {
				providerId: provider.id,
				modelId: "openai/gpt-realtime-whisper",
			}),
		).toMatchObject({ supportsStreaming: true });
	});
});
