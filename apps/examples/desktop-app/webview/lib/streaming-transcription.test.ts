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

class FakeWebSocket {
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
		FakeWebSocket.instances.push(this);
	}

	open() {
		this.readyState = FakeWebSocket.OPEN;
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
		});
		const audioContext = FakeAudioContext.instances[0] as FakeAudioContext;
		audioContext.processor.onaudioprocess?.({
			inputBuffer: {
				getChannelData: () => Float32Array.from([0, 0.25, -0.25, 0.5, -0.5, 0]),
			},
		});
		expect(socket.send).toHaveBeenCalledWith(expect.any(Uint8Array));

		socket.message({ type: "transcript-delta", delta: "hello" });
		socket.message({ type: "transcript-delta", delta: " world" });
		expect(onTranscript).toHaveBeenLastCalledWith("hello world");

		session.stop();
		expect(
			socket.send.mock.calls.some(([value]) => {
				if (typeof value !== "string") return false;
				return (
					(JSON.parse(value) as { type?: string }).type ===
					"transcription-stream.audio-done"
				);
			}),
		).toBe(true);
		socket.message({ type: "finish", text: "hello world" });
		await expect(session.done).resolves.toBeUndefined();
		expect(stopTrack).toHaveBeenCalled();
	});
	it.each([
		["en-US", "en"],
		["fr-CA", "fr"],
		[undefined, null],
	])("passes language %s to ElevenLabs and waits for the committed transcript after Stop", async (language, expectedLanguage) => {
		invokeMock.mockResolvedValue({
			transport: "elevenlabs",
			sampleRate: 24_000,
			token: "single-use",
			url: "wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime",
		});
		const onTranscript = vi.fn();
		const starting = startStreamingTranscription({ onTranscript, language });
		const socket = await vi.waitFor(() => {
			expect(FakeWebSocket.instances).toHaveLength(1);
			return FakeWebSocket.instances[0] as FakeWebSocket;
		});
		expect(new URL(socket.url).searchParams.get("token")).toBe("single-use");
		expect(new URL(socket.url).searchParams.get("language_code")).toBe(
			expectedLanguage,
		);
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
		socket.message({ message_type: "partial_transcript", text: "hello there" });
		expect(onTranscript).toHaveBeenLastCalledWith("hello there");
		session.stop();
		expect(JSON.parse(String(socket.send.mock.lastCall?.[0]))).toMatchObject({
			message_type: "input_audio_chunk",
			commit: true,
			audio_base_64: "",
		});
		socket.message({
			message_type: "committed_transcript",
			text: "Hello there.",
		});
		await session.done;
		expect(onTranscript).toHaveBeenLastCalledWith("Hello there.");
		expect(socket.close).toHaveBeenCalled();
	});

	it.each([
		"Last sentence.",
		"",
	])("keeps recording across ElevenLabs automatic commits and preserves earlier text when Stop commits %j", async (lastSegment) => {
		invokeMock.mockResolvedValue({
			transport: "elevenlabs",
			sampleRate: 24_000,
			token: "single-use",
			url: "wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&commit_strategy=manual",
		});
		const onTranscript = vi.fn();
		const onDone = vi.fn();
		const starting = startStreamingTranscription({ onTranscript });
		const socket = await vi.waitFor(() => {
			expect(FakeWebSocket.instances).toHaveLength(1);
			return FakeWebSocket.instances[0] as FakeWebSocket;
		});
		socket.open();
		const session = await starting;
		void session.done.then(onDone);
		const audioContext = FakeAudioContext.instances[0] as FakeAudioContext;

		for (const text of ["First sentence.", "Second sentence."]) {
			socket.message({ message_type: "partial_transcript", text });
			socket.message({ message_type: "committed_transcript", text });
			await Promise.resolve();
			expect(onDone).not.toHaveBeenCalled();
			expect(socket.close).not.toHaveBeenCalled();
			expect(stopTrack).not.toHaveBeenCalled();
			const sent = socket.send.mock.calls.length;
			audioContext.processor.onaudioprocess?.({
				inputBuffer: { getChannelData: () => new Float32Array(480) },
			});
			expect(socket.send.mock.calls.length).toBe(sent + 1);
		}
		socket.message({ message_type: "partial_transcript", text: "last" });
		expect(onTranscript).toHaveBeenLastCalledWith(
			"First sentence. Second sentence. last",
		);
		session.stop();
		expect(stopTrack).toHaveBeenCalled();
		expect(socket.close).not.toHaveBeenCalled();
		socket.message({
			message_type: "committed_transcript",
			text: lastSegment,
		});
		await session.done;
		expect(onTranscript).toHaveBeenLastCalledWith(
			["First sentence.", "Second sentence.", lastSegment]
				.filter(Boolean)
				.join(" "),
		);
		expect(socket.close).toHaveBeenCalledOnce();
		expect(onDone).toHaveBeenCalledOnce();
	});

	it("uses the session sample rate for both capture and the Gateway start frame", async () => {
		invokeMock.mockResolvedValue({
			transport: "vercel-ai-gateway",
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
		expect((socket.send.mock.lastCall?.[0] as Uint8Array).byteLength).toBe(320);
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
		resume();
		await rejected;
		expect(stopTrack).toHaveBeenCalled();
		expect(
			(FakeAudioContext.instances[0] as FakeAudioContext).close,
		).toHaveBeenCalled();
	});

	it("rejects a socket closed before opening without waiting for the connection timeout", async () => {
		const starting = startStreamingTranscription({ onTranscript: vi.fn() });
		const rejected = expect(starting).rejects.toThrow("code 1006");
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
		expect(onTranscript).toHaveBeenLastCalledWith("Hello. Second sentence");
		socket.message({
			type: "transcript-final",
			id: "second",
			text: "Second sentence.",
		});
		expect(onTranscript).toHaveBeenLastCalledWith("Hello. Second sentence.");
		session.cancel();
	});
});
