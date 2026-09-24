import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createStreamingAudioTranscriptionSession,
	transcribeAudio,
} from "./transcription";

// Exercise the actual AI SDK and Gateway provider; only the network is replaced.
const audio = Buffer.alloc(46);
audio.write("RIFF", 0);
audio.writeUInt32LE(38, 4);
audio.write("WAVEfmt ", 8);
audio.writeUInt32LE(16, 16);
audio.writeUInt16LE(1, 20);
audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(24000, 24);
audio.writeUInt32LE(48000, 28);
audio.writeUInt16LE(2, 32);
audio.writeUInt16LE(16, 34);
audio.write("data", 36);
audio.writeUInt32LE(2, 40);

const config = {
	providerId: "vercel-ai-gateway",
	modelId: "unused-chat-model",
	apiKey: "test-gateway-key",
};

afterEach(() => vi.useRealTimers());

describe("Gateway transcription through the real AI SDK", () => {
	it.each([
		[
			Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0xff, 0xfb]),
			"audio/mpeg",
		],
		[Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), "audio/webm"],
		[
			Buffer.from([
				0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20,
			]),
			"audio/mp4",
		],
	])("detects encoded recording formats", async (recording, mediaType) => {
		const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
			expect(JSON.parse(String(init?.body)).mediaType).toBe(mediaType);
			return Response.json({ text: "Recorded speech" });
		});
		await transcribeAudio({
			providerConfig: { ...config, fetch: fetchImpl },
			modelId: "openai/whisper-1",
			audio: recording,
			maxRetries: 0,
		});
	});

	it("does not retry authentication failures by default", async () => {
		const fetchImpl = vi.fn<typeof fetch>(async () =>
			Response.json({ error: { message: "Invalid API key" } }, { status: 401 }),
		);
		await expect(
			transcribeAudio({
				providerConfig: { ...config, fetch: fetchImpl },
				modelId: "openai/whisper-1",
				audio,
			}),
		).rejects.toThrow();
		expect(fetchImpl).toHaveBeenCalledOnce();
	});

	it("rejects malformed provider results and empty transcripts", async () => {
		for (const body of [{ text: 123 }, { text: "" }]) {
			const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(body));
			await expect(
				transcribeAudio({
					providerConfig: { ...config, fetch: fetchImpl },
					modelId: "openai/whisper-1",
					audio,
					maxRetries: 0,
				}),
			).rejects.toThrow();
		}
	});

	it("preserves provider options and timestamped results", async () => {
		const segments = [{ text: "Hello", startSecond: 0, endSecond: 0.5 }];
		const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
			expect(JSON.parse(String(init?.body))).toEqual({
				audio: audio.toString("base64"),
				mediaType: "audio/wav",
				providerOptions: { openai: { timestampGranularities: ["word"] } },
			});
			return Response.json({
				text: "Hello",
				segments,
				language: "en",
				durationInSeconds: 0.5,
				warnings: [],
			});
		});
		await expect(
			transcribeAudio({
				providerConfig: { ...config, fetch: fetchImpl },
				modelId: "openai/whisper-1",
				audio,
				providerOptions: { openai: { timestampGranularities: ["word"] } },
			}),
		).resolves.toEqual({
			text: "Hello",
			segments,
			language: "en",
			durationInSeconds: 0.5,
			warnings: [],
		});
	});

	it("retries transient Gateway failures", async () => {
		vi.useFakeTimers();
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				Response.json({ error: { message: "busy" } }, { status: 503 }),
			)
			.mockResolvedValueOnce(Response.json({ text: "Recovered" }));
		const result = transcribeAudio({
			providerConfig: { ...config, fetch: fetchImpl },
			modelId: "openai/whisper-1",
			audio,
			maxRetries: 1,
		});
		const assertion = expect(result).resolves.toMatchObject({
			text: "Recovered",
		});
		await vi.runAllTimersAsync();
		await assertion;
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it.each([401, 503])("honors maxRetries=0 on HTTP %s", async (status) => {
		const fetchImpl = vi.fn<typeof fetch>(async () =>
			Response.json({ error: { message: "Request failed" } }, { status }),
		);
		await expect(
			transcribeAudio({
				providerConfig: { ...config, fetch: fetchImpl },
				modelId: "openai/whisper-1",
				audio,
				maxRetries: 0,
			}),
		).rejects.toThrow();
		expect(fetchImpl).toHaveBeenCalledOnce();
	});

	it("passes cancellation to the HTTP transport", async () => {
		const controller = new AbortController();
		const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
			controller.abort(new Error("Recording cancelled"));
			expect(init?.signal?.aborted).toBe(true);
			init?.signal?.throwIfAborted();
			return Response.json({ text: "unreachable" });
		});
		await expect(
			transcribeAudio({
				providerConfig: { ...config, fetch: fetchImpl },
				modelId: "openai/whisper-1",
				audio,
				abortSignal: controller.signal,
				maxRetries: 0,
			}),
		).rejects.toThrow();
		expect(fetchImpl).toHaveBeenCalledOnce();
	});

	it("mints model-bound tokens with the documented default expiry", async () => {
		const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
			expect(JSON.parse(String(init?.body))).toEqual({
				model: "openai/gpt-realtime-whisper",
				routeKind: "transcription",
				expiresIn: 60,
			});
			return Response.json({ token: "vcst_test", expiresAt: 1800000000 });
		});
		await expect(
			createStreamingAudioTranscriptionSession({
				providerConfig: { ...config, fetch: fetchImpl },
				modelId: "openai/gpt-realtime-whisper",
			}),
		).resolves.toMatchObject({
			token: "vcst_test",
			url: "wss://ai-gateway.vercel.sh/v4/ai/transcription-model?ai-model-id=openai%2Fgpt-realtime-whisper",
		});
	});

	it("does not mint a token for an already cancelled request", async () => {
		const fetchImpl = vi.fn<typeof fetch>();
		await expect(
			createStreamingAudioTranscriptionSession({
				providerConfig: { ...config, fetch: fetchImpl },
				modelId: "openai/gpt-realtime-whisper",
				abortSignal: AbortSignal.abort(),
			}),
		).rejects.toThrow();
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});
