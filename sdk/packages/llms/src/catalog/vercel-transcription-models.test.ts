import { describe, expect, it, vi } from "vitest";
import { fetchVercelTranscriptionModels } from "./vercel-transcription-models";

describe("Vercel transcription discovery", () => {
	it("requires exact audio-to-text modalities and protocol support regardless of model name or type", async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
			Response.json({
				data: [
					{
						modalities: { input: ["audio"], output: ["text"] },
						id: "openai/whisper-1",
						type: "transcription",
						supported_specifications: ["v4"],
					},
					{
						modalities: { input: ["audio"], output: ["text"] },
						id: "spacexai/grok-stt",
						type: "transcription",
						supported_specifications: ["v4"],
						tags: ["websocket-transcription"],
					},
					{
						modalities: { input: ["audio"], output: ["text"] },
						id: "google/gemini-3.5-transcribe-live",
						type: "transcription",
						supported_specifications: ["v4"],
						tags: ["websocket-transcription"],
					},
					{
						id: "transcribe-chat",
						type: "language",
						supported_specifications: ["v4"],
					},
					{
						id: "audio-chat",
						type: "language",
						modalities: { input: ["audio", "text"], output: ["text"] },
						supported_specifications: ["v4"],
					},
					{
						id: "audio-to-text",
						modalities: { input: ["audio"], output: ["text"] },
						supported_specifications: ["v4"],
					},
					{
						id: "multimodal-stt",
						type: "transcription",
						modalities: { input: ["audio", "text"], output: ["text"] },
						supported_specifications: ["v4"],
						tags: ["websocket-transcription"],
					},
					{ id: "speech", type: "speech", supported_specifications: ["v4"] },
					{ id: "untyped-transcribe", supported_specifications: ["v4"] },
					{
						modalities: { input: ["audio"], output: ["text"] },
						id: "older-protocol",
						type: "transcription",
						supported_specifications: ["v3"],
					},
				],
			}),
		);
		const models = await fetchVercelTranscriptionModels({
			providerId: "vercel-ai-gateway",
			modelId: "chat",
			fetch: fetchImpl,
		});
		expect(Object.keys(models)).toEqual([
			"openai/whisper-1",
			"spacexai/grok-stt",
			"google/gemini-3.5-transcribe-live",
			"audio-to-text",
		]);
		expect(models["openai/whisper-1"]?.operationModes).toEqual(["batch"]);
		expect(models["google/gemini-3.5-transcribe-live"]?.operationModes).toEqual(
			["streaming"],
		);
		expect(models["spacexai/grok-stt"]?.operationModes).toEqual(["streaming"]);
		expect(fetchImpl).toHaveBeenCalledWith(
			"https://ai-gateway.vercel.sh/v1/models",
			expect.any(Object),
		);
	});

	it("honors a configured gateway base URL and treats an empty catalog as authoritative", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValue(Response.json({ data: [] }));
		await expect(
			fetchVercelTranscriptionModels({
				providerId: "vercel-ai-gateway",
				modelId: "chat",
				baseUrl: "https://gateway.example/proxy/v4/ai",
				fetch: fetchImpl,
			}),
		).resolves.toEqual({});
		expect(fetchImpl).toHaveBeenCalledWith(
			"https://gateway.example/proxy/v1/models",
			expect.any(Object),
		);
	});

	it.each([
		new Response("unavailable", { status: 503 }),
		Response.json({ models: [] }),
	])("rejects unavailable or malformed catalogs instead of using bundled models", async (response) => {
		await expect(
			fetchVercelTranscriptionModels({
				providerId: "vercel-ai-gateway",
				modelId: "chat",
				fetch: vi.fn<typeof fetch>().mockResolvedValue(response),
			}),
		).rejects.toThrow();
	});
});
