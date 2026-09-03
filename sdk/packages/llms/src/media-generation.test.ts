import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ApiHandler,
	ApiStream,
	ApiStreamChunk,
	ProviderConfig,
} from "./providers";

const { createHandlerAsyncMock } = vi.hoisted(() => ({
	createHandlerAsyncMock: vi.fn(),
}));

vi.mock("./providers", () => ({
	createHandlerAsync: createHandlerAsyncMock,
}));

import { generateMedia } from "./media-generation";

function apiStream(chunks: ApiStreamChunk[]): ApiStream {
	return (async function* () {
		for (const chunk of chunks) yield chunk;
	})() as ApiStream;
}

function mockHandler(chunks: ApiStreamChunk[]) {
	const createMessage = vi.fn(() => apiStream(chunks));
	const setAbortSignal = vi.fn();
	createHandlerAsyncMock.mockResolvedValue({
		createMessage,
		setAbortSignal,
	} as unknown as ApiHandler);
	return { createMessage, setAbortSignal };
}

function providerConfig(
	overrides: Partial<ProviderConfig> = {},
): ProviderConfig {
	return {
		providerId: "google",
		modelId: "chat-model",
		...overrides,
	};
}

describe("generateMedia", () => {
	beforeEach(() => {
		createHandlerAsyncMock.mockReset();
	});

	it("collects requested canonical media and provider usage", async () => {
		const image = {
			id: "image-1",
			modality: "image" as const,
			mediaType: "image/png",
			source: { type: "base64" as const, data: "aGVsbG8=" },
		};
		const imageModel = {
			id: "image-model",
			name: "Image Model",
			operation: "image-generation" as const,
		};
		const controller = new AbortController();
		const handler = mockHandler([
			{ type: "media", media: image, id: "response-1" },
			{
				type: "usage",
				inputTokens: 12,
				outputTokens: 4,
				cacheReadTokens: 2,
				thoughtsTokenCount: 1,
				totalCost: 0.02,
				id: "response-1",
			},
			{ type: "done", success: true, id: "response-1" },
		]);

		await expect(
			generateMedia({
				providerConfig: providerConfig({
					abortSignal: controller.signal,
					thinking: true,
					reasoningEffort: "medium",
					thinkingBudgetTokens: 4096,
					modelInfo: { id: "chat-model", name: "Chat Model" },
					knownModels: { "image-model": imageModel },
				}),
				modelId: "image-model",
				prompt: "  Draw a bee  ",
				mediaType: "image",
			}),
		).resolves.toEqual({
			media: [image],
			usage: {
				inputTokens: 12,
				outputTokens: 4,
				cacheReadTokens: 2,
				cacheWriteTokens: 0,
				reasoningTokenCount: 1,
				totalCost: 0.02,
			},
		});

		expect(createHandlerAsyncMock).toHaveBeenCalledWith(
			expect.objectContaining({
				modelId: "image-model",
				modelInfo: imageModel,
				abortSignal: controller.signal,
			}),
		);
		const mediaProviderConfig = createHandlerAsyncMock.mock.calls[0]?.[0];
		expect(mediaProviderConfig?.thinking).toBeUndefined();
		expect(mediaProviderConfig?.reasoningEffort).toBeUndefined();
		expect(mediaProviderConfig?.thinkingBudgetTokens).toBeUndefined();
		expect(handler.setAbortSignal).toHaveBeenCalledWith(controller.signal);
		expect(handler.createMessage).toHaveBeenCalledWith("", [
			{ role: "user", content: "Draw a bee" },
		]);
	});

	it.each([
		["audio", "audio/mpeg", "speech-generation"],
		["video", "video/mp4", "video-generation"],
	] as const)("collects requested %s media and ignores other modalities", async (mediaType, mimeType, operation) => {
		const requested = {
			id: `${mediaType}-1`,
			modality: mediaType,
			mediaType: mimeType,
			source: { type: "base64" as const, data: "bWVkaWE=" },
		};
		const otherImage = {
			id: "image-1",
			modality: "image" as const,
			mediaType: "image/png",
			source: { type: "base64" as const, data: "aGVsbG8=" },
		};
		mockHandler([
			{ type: "media", media: otherImage, id: "response-1" },
			{ type: "media", media: requested, id: "response-1" },
			{ type: "done", success: true, id: "response-1" },
		]);

		await expect(
			generateMedia({
				providerConfig: providerConfig({
					knownModels: {
						"media-model": {
							id: "media-model",
							name: "Media Model",
							operation,
						},
					},
				}),
				modelId: "media-model",
				prompt: "Produce a bee clip",
				mediaType,
			}),
		).resolves.toEqual({ media: [requested] });
	});

	it("throws when the stream reports an unsuccessful terminal chunk", async () => {
		mockHandler([
			{
				type: "media",
				media: {
					id: "image-1",
					modality: "image",
					mediaType: "image/png",
					source: { type: "base64", data: "aGVsbG8=" },
				},
				id: "response-1",
			},
			{
				type: "done",
				success: false,
				error: "provider rejected the image",
				id: "response-1",
			},
		]);

		await expect(
			generateMedia({
				providerConfig: providerConfig(),
				modelId: "image-model",
				prompt: "Draw a bee",
				mediaType: "image",
			}),
		).rejects.toThrow("Media generation failed: provider rejected the image");
	});

	it("throws when the stream returns no requested media", async () => {
		mockHandler([
			{
				type: "media",
				media: {
					id: "audio-1",
					modality: "audio",
					mediaType: "audio/mpeg",
					source: { type: "base64", data: "SUQz" },
				},
				id: "response-1",
			},
			{ type: "done", success: true, id: "response-1" },
		]);

		await expect(
			generateMedia({
				providerConfig: providerConfig(),
				modelId: "image-model",
				prompt: "Draw a bee",
				mediaType: "image",
			}),
		).rejects.toThrow("Media generation returned no image media");
	});

	it("composes provider and request cancellation signals", async () => {
		const providerController = new AbortController();
		const requestController = new AbortController();
		const handler = mockHandler([
			{
				type: "media",
				media: {
					id: "image-1",
					modality: "image",
					mediaType: "image/png",
					source: { type: "base64", data: "aGVsbG8=" },
				},
				id: "response-1",
			},
			{ type: "done", success: true, id: "response-1" },
		]);

		await generateMedia({
			providerConfig: providerConfig({
				abortSignal: providerController.signal,
			}),
			modelId: "image-model",
			prompt: "Draw a bee",
			mediaType: "image",
			abortSignal: requestController.signal,
		});

		const composedSignal = handler.setAbortSignal.mock.calls[0]?.[0];
		expect(composedSignal).toBeInstanceOf(AbortSignal);
		expect(composedSignal).not.toBe(providerController.signal);
		expect(composedSignal).not.toBe(requestController.signal);
		requestController.abort("cancelled");
		expect(composedSignal?.aborted).toBe(true);
		expect(composedSignal?.reason).toBe("cancelled");
	});
});
