import { afterEach, describe, expect, it, vi } from "vitest";
import { desktopClient } from "./desktop-client";
import {
	buildProviderModelCatalog,
	fetchProviderCatalog,
	filterChatModels,
	invalidateProviderCatalogCache,
	isChatModel,
	isDedicatedTranscriptionModel,
	loadProviderModelCatalog,
	loadTranscriptionModels,
	notifyVoiceInputSettingsChanged,
	publishProviderModels,
	readVoiceInputCatalog,
	selectTranscriptionModel,
	subscribeToProviderModels,
	supportsAudio,
} from "./provider-model-catalog";
import type { Provider } from "./provider-schema";

describe("verified voice model loading", () => {
	afterEach(() => {
		invalidateProviderCatalogCache();
		vi.restoreAllMocks();
	});

	it("deduplicates discovery across navigation and selection changes, but refreshes after expiry or credential changes", async () => {
		let now = 1_000;
		vi.spyOn(Date, "now").mockImplementation(() => now);
		const invoke = vi.spyOn(desktopClient, "invoke").mockResolvedValue({
			models: [
				{
					inputModalities: ["audio"],
					outputModalities: ["text"],
					id: "stt",
					name: "STT",
					operation: "transcription",
				},
			],
		});
		await Promise.all([
			loadTranscriptionModels("voice"),
			loadTranscriptionModels("voice"),
		]);
		await loadTranscriptionModels("voice");
		expect(invoke).toHaveBeenCalledTimes(1);
		invoke.mockResolvedValueOnce({ providers: [], voiceInput: undefined });
		await fetchProviderCatalog();
		notifyVoiceInputSettingsChanged({
			voiceInput: { providerId: "voice", modelId: "stt" },
		});
		await loadTranscriptionModels("voice");
		expect(invoke).toHaveBeenCalledTimes(2);
		expect(readVoiceInputCatalog()?.voiceInput?.modelId).toBe("stt");
		now += 5 * 60_000;
		await loadTranscriptionModels("voice");
		expect(invoke).toHaveBeenCalledTimes(3);
		invalidateProviderCatalogCache();
		expect(readVoiceInputCatalog()).toBeNull();
		await loadTranscriptionModels("voice");
		expect(invoke).toHaveBeenCalledTimes(4);
	});

	it("does not cache failed discovery or resurrect results invalidated while loading", async () => {
		let resolveOld!: (value: unknown) => void;
		const invoke = vi.spyOn(desktopClient, "invoke").mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveOld = resolve;
				}),
		);
		const old = loadTranscriptionModels("voice");
		invalidateProviderCatalogCache();
		invoke.mockResolvedValue({
			models: [
				{
					inputModalities: ["audio"],
					outputModalities: ["text"],
					id: "new",
					name: "New",
					operation: "transcription",
				},
			],
		});
		await loadTranscriptionModels("voice");
		resolveOld({
			models: [
				{
					inputModalities: ["audio"],
					outputModalities: ["text"],
					id: "old",
					name: "Old",
					operation: "transcription",
				},
			],
		});
		await old;
		expect((await loadTranscriptionModels("voice"))[0]?.id).toBe("new");
		invalidateProviderCatalogCache();
		invoke.mockRejectedValueOnce(new Error("offline"));
		await expect(loadTranscriptionModels("voice")).rejects.toThrow("offline");
		expect((await loadTranscriptionModels("voice"))[0]?.id).toBe("new");
	});

	it("accepts only audio-to-text, excluding multimodal models even when labeled transcription", async () => {
		vi.spyOn(desktopClient, "invoke").mockResolvedValue({
			models: [
				{
					id: "stt",
					name: "STT",
					inputModalities: ["audio"],
					outputModalities: ["text"],
				},
				{
					id: "live",
					name: "Live",
					operation: "transcription",
					inputModalities: ["audio", "text"],
					outputModalities: ["text"],
					operationModes: ["streaming"],
				},
				{
					id: "chat-transcribe",
					name: "Transcribe",
					inputModalities: ["text", "audio"],
					outputModalities: ["text"],
				},
				{
					id: "tts",
					name: "Speech",
					inputModalities: ["text"],
					outputModalities: ["audio"],
				},
			],
		});
		expect(
			(await loadTranscriptionModels("vercel-ai-gateway")).map(
				(model) => model.id,
			),
		).toEqual(["stt"]);
		expect(desktopClient.invoke).toHaveBeenCalledWith(
			"list_transcription_models",
			{ provider: "vercel-ai-gateway" },
		);
	});

	it.each([
		true,
		false,
	])("validates the composer's saved model against current discovery (present: %s)", async (present) => {
		const provider: Provider = {
			id: "vercel-ai-gateway",
			name: "Vercel",
			enabled: true,
			apiKey: "key",
			models: 1,
			color: "#000",
			letter: "V",
			modelList: [
				{
					inputModalities: ["audio"],
					outputModalities: ["text"],
					id: "saved",
					name: "Stale",
					operation: "transcription",
					operationModes: ["batch"],
				},
			],
		};
		vi.spyOn(desktopClient, "invoke").mockImplementation(async (command) =>
			command === "list_provider_catalog"
				? {
						providers: [provider],
						voiceInput: { providerId: provider.id, modelId: "saved" },
					}
				: {
						models: present
							? [
									{
										inputModalities: ["audio"],
										outputModalities: ["text"],
										id: "saved",
										name: "Current",
										operation: "transcription",
										operationModes: ["streaming"],
									},
								]
							: [],
					},
		);
		const result = await loadProviderModelCatalog({ includeVoiceInput: true });
		if (present)
			expect(result.voiceInput).toMatchObject({
				modelName: "Current",
				supportsStreaming: true,
			});
		else expect(result.voiceInput).toBeNull();
	});

	it("does not fall back to the bundled selection on discovery failure", async () => {
		vi.spyOn(desktopClient, "invoke").mockImplementation(async (command) => {
			if (command === "list_provider_catalog")
				return {
					providers: [
						{
							id: "vercel-ai-gateway",
							name: "Vercel",
							enabled: true,
							apiKey: "key",
							modelList: [
								{
									inputModalities: ["audio"],
									outputModalities: ["text"],
									id: "saved",
									name: "Stale",
									operation: "transcription",
								},
							],
						},
					],
					voiceInput: { providerId: "vercel-ai-gateway", modelId: "saved" },
				};
			throw new Error("catalog offline");
		});
		await expect(
			loadProviderModelCatalog({ includeVoiceInput: true }),
		).rejects.toThrow("catalog offline");
		// Ordinary chat model loading never depends on voice discovery.
		await expect(loadProviderModelCatalog()).resolves.toMatchObject({
			voiceInput: null,
		});
	});
});

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

	it("keeps chat and image-generation models in the composer", () => {
		expect(
			isChatModel({
				id: "chat",
				name: "Chat",
				inputModalities: ["text", "audio"],
				outputModalities: ["text"],
			}),
		).toBe(true);
		expect(
			isChatModel({
				id: "legacy",
				name: "Legacy",
			}),
		).toBe(true);
		expect(
			isChatModel({
				id: "image",
				name: "Image",
				operation: "image-generation",
				inputModalities: ["text", "image"],
				outputModalities: ["image"],
			}),
		).toBe(true);
		expect(
			isChatModel({
				id: "whisper",
				name: "Whisper",
				operation: "transcription",
				inputModalities: ["audio"],
				outputModalities: ["text"],
			}),
		).toBe(false);
		expect(
			isChatModel({
				inputModalities: ["audio"],
				outputModalities: ["text"],
				id: "operation-only-whisper",
				name: "Operation-only Whisper",
				operation: "transcription",
			}),
		).toBe(false);
		expect(
			isChatModel({
				id: "tts",
				name: "TTS",
				operation: "speech-generation",
				inputModalities: ["text"],
				outputModalities: ["audio"],
			}),
		).toBe(false);
	});

	it("rejects a configured batch-only transcription model", () => {
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
		).toBeNull();
		expect(selectTranscriptionModel(providers, undefined)).toBeNull();
	});

	it("keeps an enabled audio-only provider out of chat without losing voice selection", () => {
		const elevenLabs: Provider = {
			id: "elevenlabs",
			name: "ElevenLabs",
			models: 1,
			color: "#000000",
			letter: "EL",
			enabled: true,
			modelList: [
				{
					id: "scribe_v2_realtime",
					name: "Scribe v2",
					operation: "transcription",
					operationModes: ["streaming"],
					inputModalities: ["audio"],
					outputModalities: ["text"],
				},
			],
		};

		const selection = {
			providerId: "elevenlabs",
			modelId: "scribe_v2_realtime",
		};
		const catalog = buildProviderModelCatalog([elevenLabs], selection);
		expect(catalog.enabledProviderIds).toEqual([]);
		expect(catalog.providerModels.elevenlabs).toEqual([]);
		expect(catalog.voiceInput).toMatchObject({
			providerId: "elevenlabs",
			modelId: "scribe_v2_realtime",
			supportsStreaming: true,
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
		expect(catalog.providerModelDetails.openai).toEqual(
			provider.modelList?.slice(1),
		);
		expect(catalog.providerNames.openai).toBe("OpenAI");
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
