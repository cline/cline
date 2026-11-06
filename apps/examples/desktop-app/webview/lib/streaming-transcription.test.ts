// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, writeDesktopDebugLogMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(),
	writeDesktopDebugLogMock: vi.fn(),
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: invokeMock },
	writeDesktopDebugLog: writeDesktopDebugLogMock,
}));

import { startStreamingTranscription } from "./streaming-transcription";

class FakeWebSocket extends EventTarget {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSED = 3;
	static instances: FakeWebSocket[] = [];

	readyState = FakeWebSocket.CONNECTING;
	binaryType = "";
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onerror: (() => void) | null = null;
	onclose: ((event: { code: number }) => void) | null = null;
	send = vi.fn();
	close = vi.fn(() => {
		this.readyState = FakeWebSocket.CLOSED;
	});

	constructor(
		readonly url: string,
		readonly protocols: string[],
	) {
		super();
		FakeWebSocket.instances.push(this);
	}

	open() {
		this.readyState = FakeWebSocket.OPEN;
		this.dispatchEvent(new Event("open"));
		this.onopen?.();
	}

	message(part: unknown) {
		this.onmessage?.({ data: JSON.stringify(part) });
	}
}

type FakeAudioProcess = {
	inputBuffer: { getChannelData: () => Float32Array };
};

class FakeAudioContext {
	static instances: FakeAudioContext[] = [];
	static resumeHook: (() => Promise<void>) | undefined;

	readonly sampleRate = 48_000;
	readonly destination = {};
	readonly source = { connect: vi.fn(), disconnect: vi.fn() };
	readonly processor = {
		onaudioprocess: null as ((event: FakeAudioProcess) => void) | null,
		connect: vi.fn(),
		disconnect: vi.fn(),
	};
	readonly gain = {
		gain: { value: 1 },
		connect: vi.fn(),
		disconnect: vi.fn(),
	};
	resume = vi.fn(async () => {
		await FakeAudioContext.resumeHook?.();
	});
	close = vi.fn(async () => undefined);

	constructor() {
		FakeAudioContext.instances.push(this);
	}

	createMediaStreamSource() {
		return this.source;
	}

	createScriptProcessor() {
		return this.processor;
	}

	createGain() {
		return this.gain;
	}
}

describe("streaming transcription", () => {
	const stopTrack = vi.fn();

	beforeEach(() => {
		FakeWebSocket.instances = [];
		FakeAudioContext.instances = [];
		FakeAudioContext.resumeHook = undefined;
		stopTrack.mockClear();
		invokeMock.mockReset().mockResolvedValue({
			transport: "vercel-ai-gateway",
			modelId: "openai/gpt-realtime-whisper",
			baseUrl: "https://ai-gateway.vercel.sh/v4/ai",
			sampleRate: 24_000,
			token: "vcst_short_lived",
			url: "wss://ai-gateway.vercel.sh/v4/ai/transcription-model?ai-model-id=openai%2Fgpt-realtime-whisper",
		});
		Object.defineProperty(window, "WebSocket", {
			configurable: true,
			value: FakeWebSocket,
		});
		Object.defineProperty(window, "AudioContext", {
			configurable: true,
			value: FakeAudioContext,
		});
		Object.defineProperty(navigator, "mediaDevices", {
			configurable: true,
			value: {
				getUserMedia: vi.fn(async () => ({
					getTracks: () => [{ stop: stopTrack }],
				})),
			},
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("streams PCM audio and emits cumulative transcript text", async () => {
		const onTranscript = vi.fn();
		const startPromise = startStreamingTranscription({ onTranscript });
		const socket = await vi.waitFor(() => {
			expect(FakeWebSocket.instances).toHaveLength(1);
			return FakeWebSocket.instances[0] as FakeWebSocket;
		});
		expect(socket.protocols).toEqual([
			"ai-gateway-transcription.v1",
			"ai-gateway-auth.vcst_short_lived",
		]);
		socket.open();
		const session = await startPromise;

		expect(JSON.parse(String(socket.send.mock.calls[0]?.[0]))).toEqual({
			type: "transcription-stream.start",
			inputAudioFormat: { type: "audio/pcm", rate: 24_000 },
			includeRawChunks: true,
			providerOptions: {},
		});
		const audioContext = FakeAudioContext.instances[0] as FakeAudioContext;
		audioContext.processor.onaudioprocess?.({
			inputBuffer: {
				getChannelData: () => Float32Array.from([0, 0.25, -0.25, 0.5, -0.5, 0]),
			},
		});
		await vi.waitFor(() =>
			expect(socket.send).toHaveBeenCalledWith(expect.any(Uint8Array)),
		);

		socket.message({ type: "transcript-delta", delta: "hello" });
		socket.message({ type: "transcript-delta", delta: " world" });
		await vi.waitFor(() =>
			expect(onTranscript).toHaveBeenLastCalledWith("hello world"),
		);

		session.stop();
		await vi.waitFor(() =>
			expect(
				socket.send.mock.calls.some(([value]) => {
					if (typeof value !== "string") return false;
					return (
						(JSON.parse(value) as { type?: string }).type ===
						"transcription-stream.audio-done"
					);
				}),
			).toBe(true),
		);
		socket.message({ type: "finish", text: "hello world", segments: [] });
		await expect(session.done).resolves.toBeUndefined();
		expect(stopTrack).toHaveBeenCalled();
	});
	it("shows ElevenLabs partials before Stop and waits for the committed transcript", async () => {
		invokeMock.mockResolvedValue({
			transport: "elevenlabs",
			sampleRate: 24_000,
			token: "single-use",
			url: "wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime",
		});
		const onTranscript = vi.fn();
		const starting = startStreamingTranscription({ onTranscript });
		const socket = await vi.waitFor(() => {
			expect(FakeWebSocket.instances).toHaveLength(1);
			return FakeWebSocket.instances[0] as FakeWebSocket;
		});
		expect(new URL(socket.url).searchParams.get("token")).toBe("single-use");
		expect(socket.protocols).toEqual([]);
		socket.open();
		const session = await starting;
		(
			FakeAudioContext.instances[0] as FakeAudioContext
		).processor.onaudioprocess?.({
			inputBuffer: {
				getChannelData: () => Float32Array.from([0, 0.5, -0.5, 0]),
			},
		});
		expect(JSON.parse(String(socket.send.mock.calls[0]?.[0]))).toMatchObject({
			message_type: "input_audio_chunk",
			sample_rate: 24_000,
			audio_base_64: expect.any(String),
		});
		socket.message({ message_type: "partial_transcript", text: "hello" });
		socket.message({ message_type: "committed_transcript", text: "hello" });
		expect(socket.close).not.toHaveBeenCalled();
		socket.message({ message_type: "partial_transcript", text: "there" });
		await vi.waitFor(() =>
			expect(onTranscript).toHaveBeenLastCalledWith("hello there"),
		);
		session.stop();
		expect(JSON.parse(String(socket.send.mock.lastCall?.[0]))).toMatchObject({
			message_type: "input_audio_chunk",
			commit: true,
			audio_base_64: "",
		});
		socket.message({
			message_type: "committed_transcript",
			text: "there.",
		});
		await session.done;
		await vi.waitFor(() =>
			expect(onTranscript).toHaveBeenLastCalledWith("hello there."),
		);
		expect(socket.close).toHaveBeenCalled();
	});

	it("uses the session sample rate for both capture and the Gateway start frame", async () => {
		invokeMock.mockResolvedValue({
			transport: "vercel-ai-gateway",
			modelId: "openai/gpt-realtime-whisper",
			baseUrl: "https://ai-gateway.vercel.sh/v4/ai",
			sampleRate: 16_000,
			token: "short-lived",
			url: "wss://gateway.test",
		});
		const starting = startStreamingTranscription({ onTranscript: vi.fn() });
		const socket = await vi.waitFor(() => {
			expect(FakeWebSocket.instances).toHaveLength(1);
			return FakeWebSocket.instances[0] as FakeWebSocket;
		});
		socket.open();
		const session = await starting;
		expect(
			JSON.parse(String(socket.send.mock.calls[0]?.[0])).inputAudioFormat.rate,
		).toBe(16_000);
		(
			FakeAudioContext.instances[0] as FakeAudioContext
		).processor.onaudioprocess?.({
			inputBuffer: { getChannelData: () => new Float32Array(480) },
		});
		await vi.waitFor(() =>
			expect((socket.send.mock.lastCall?.[0] as Uint8Array).byteLength).toBe(
				320,
			),
		);
		session.cancel();
		await session.done;
	});

	it("preserves upstream errors arriving while microphone capture is starting and releases audio resources", async () => {
		let resume!: () => void;
		FakeAudioContext.resumeHook = () =>
			new Promise<void>((resolve) => {
				resume = resolve;
			});
		const starting = startStreamingTranscription({ onTranscript: vi.fn() });
		const rejected = expect(starting).rejects.toThrow(
			"You do not have access to the organization tied to the API key.",
		);
		const socket = await vi.waitFor(() => {
			expect(FakeWebSocket.instances).toHaveLength(1);
			return FakeWebSocket.instances[0] as FakeWebSocket;
		});
		socket.open();
		await vi.waitFor(() => expect(FakeAudioContext.instances).toHaveLength(1));
		socket.message({
			type: "raw",
			rawValue: {
				type: "error",
				error: {
					code: "invalid_organization",
					message:
						"You do not have access to the organization tied to the API key.",
				},
			},
		});
		socket.message({
			type: "error",
			error: { message: "Transcription provider stream error" },
		});
		await vi.waitFor(() => expect(stopTrack).toHaveBeenCalled());
		resume();
		await rejected;
		expect(stopTrack).toHaveBeenCalled();
		expect(
			(FakeAudioContext.instances[0] as FakeAudioContext).close,
		).toHaveBeenCalled();
	});

	it("rejects a socket closed before opening without waiting for the connection timeout", async () => {
		const starting = startStreamingTranscription({ onTranscript: vi.fn() });
		const session = await starting;
		const rejected = expect(session.done).rejects.toThrow();
		const socket = await vi.waitFor(() => {
			expect(FakeWebSocket.instances).toHaveLength(1);
			return FakeWebSocket.instances[0] as FakeWebSocket;
		});
		socket.onclose?.({ code: 1006 });
		await rejected;
		expect(stopTrack).toHaveBeenCalled();
	});
	it("continues showing partials after a completed Gateway segment without duplicating final text", async () => {
		const onTranscript = vi.fn();
		const starting = startStreamingTranscription({ onTranscript });
		const socket = await vi.waitFor(() => {
			expect(FakeWebSocket.instances).toHaveLength(1);
			return FakeWebSocket.instances[0] as FakeWebSocket;
		});
		socket.open();
		const session = await starting;
		socket.message({ type: "transcript-partial", id: "first", text: "hello" });
		socket.message({ type: "transcript-delta", id: "first", delta: "Hello." });
		socket.message({ type: "transcript-final", id: "first", text: "Hello." });
		socket.message({
			type: "transcript-partial",
			id: "second",
			text: "Second sentence",
		});
		await vi.waitFor(() =>
			expect(onTranscript).toHaveBeenLastCalledWith("Hello. Second sentence"),
		);
		socket.message({
			type: "transcript-final",
			id: "second",
			text: "Second sentence.",
		});
		await vi.waitFor(() =>
			expect(onTranscript).toHaveBeenLastCalledWith("Hello. Second sentence."),
		);
		session.cancel();
	});
	it("cancels the SDK stream and ignores late transcript updates", async () => {
		const onTranscript = vi.fn();
		const session = await startStreamingTranscription({ onTranscript });
		const socket = await vi.waitFor(() => {
			expect(FakeWebSocket.instances).toHaveLength(1);
			return FakeWebSocket.instances[0] as FakeWebSocket;
		});
		socket.open();
		session.cancel();
		await session.done;
		socket.message({ type: "transcript-partial", text: "late" });
		expect(onTranscript).not.toHaveBeenCalled();
		expect(socket.close).toHaveBeenCalled();
		expect(stopTrack).toHaveBeenCalled();
	});
	it("aborts capture on network loss so speech input can select browser fallback", async () => {
		const session = await startStreamingTranscription({
			onTranscript: vi.fn(),
		});
		const rejected = expect(session.done).rejects.toThrow(
			"network connection was lost",
		);
		window.dispatchEvent(new Event("offline"));
		await rejected;
		expect(stopTrack).toHaveBeenCalled();
	});
	it("surfaces provider budget errors without replacing them with a connection error", async () => {
		const session = await startStreamingTranscription({
			onTranscript: vi.fn(),
		});
		const rejected = expect(session.done).rejects.toThrow(
			"API key budget exceeded",
		);
		const socket = await vi.waitFor(() => {
			expect(FakeWebSocket.instances).toHaveLength(1);
			return FakeWebSocket.instances[0] as FakeWebSocket;
		});
		socket.open();
		socket.message({
			type: "error",
			error: {
				message: "API key budget exceeded",
				type: "quota_for_entity_exceeded",
			},
		});
		await rejected;
		expect(stopTrack).toHaveBeenCalled();
	});
	it("aborts a stream that does not finish after Stop", async () => {
		const session = await startStreamingTranscription({
			onTranscript: vi.fn(),
		});
		const socket = await vi.waitFor(() => {
			expect(FakeWebSocket.instances).toHaveLength(1);
			return FakeWebSocket.instances[0] as FakeWebSocket;
		});
		socket.open();
		vi.useFakeTimers();
		try {
			const rejected = expect(session.done).rejects.toThrow(
				"timed out while finalizing",
			);
			session.stop();
			await vi.advanceTimersByTimeAsync(15_000);
			await rejected;
			expect(socket.close).toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});
	it("streams native OpenAI transcripts through the SDK before Stop", async () => {
		invokeMock.mockResolvedValue({
			transport: "openai-native",
			modelId: "gpt-realtime-whisper",
			baseUrl: "https://api.openai.com/v1",
			token: "ek_short",
			sampleRate: 24000,
		});
		const onTranscript = vi.fn();
		const session = await startStreamingTranscription({ onTranscript });
		const socket = await vi.waitFor(() => {
			expect(FakeWebSocket.instances).toHaveLength(1);
			return FakeWebSocket.instances[0] as FakeWebSocket;
		});
		expect(String(socket.url)).toContain("/v1/realtime?intent=transcription");
		expect(socket.protocols).toEqual([
			"realtime",
			"openai-insecure-api-key.ek_short",
		]);
		socket.open();
		expect(JSON.parse(String(socket.send.mock.calls[0]?.[0]))).toMatchObject({
			type: "session.update",
			session: {
				type: "transcription",
				audio: { input: { transcription: { model: "gpt-realtime-whisper" } } },
			},
		});
		socket.message({
			type: "conversation.item.input_audio_transcription.delta",
			item_id: "one",
			delta: "Hello",
		});
		await vi.waitFor(() =>
			expect(onTranscript).toHaveBeenLastCalledWith("Hello"),
		);
		session.stop();
		await vi.waitFor(() =>
			expect(socket.send).toHaveBeenCalledWith(
				JSON.stringify({ type: "input_audio_buffer.commit" }),
			),
		);
		socket.message({
			type: "conversation.item.input_audio_transcription.completed",
			item_id: "one",
			transcript: "Hello.",
		});
		await session.done;
		expect(onTranscript).toHaveBeenLastCalledWith("Hello.");
		expect(stopTrack).toHaveBeenCalled();
	});
	it.each([
		"openai-native",
		"vercel-ai-gateway",
	])("classifies an established %s socket failure as network loss", async (transport) => {
		invokeMock.mockResolvedValue({
			transport,
			modelId: "gpt-realtime-whisper",
			baseUrl: "https://example.test/v1",
			token: "short",
			sampleRate: 24000,
		});
		const session = await startStreamingTranscription({
			onTranscript: vi.fn(),
		});
		const socket = await vi.waitFor(() => {
			expect(FakeWebSocket.instances).toHaveLength(1);
			return FakeWebSocket.instances[0] as FakeWebSocket;
		});
		socket.open();
		const rejected = expect(session.done).rejects.toThrow(
			"network connection was lost",
		);
		socket.dispatchEvent(new Event("error"));
		socket.onerror?.();
		await rejected;
	});
});
