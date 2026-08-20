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

import { startVercelStreamingTranscription } from "./vercel-streaming-transcription";

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
	onclose: (() => void) | null = null;
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
	resume = vi.fn(async () => undefined);
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

describe("Vercel streaming transcription", () => {
	const stopTrack = vi.fn();

	beforeEach(() => {
		FakeWebSocket.instances = [];
		FakeAudioContext.instances = [];
		invokeMock.mockReset().mockResolvedValue({
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
		const startPromise = startVercelStreamingTranscription({ onTranscript });
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
});
