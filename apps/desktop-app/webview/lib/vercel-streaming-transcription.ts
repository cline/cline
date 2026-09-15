"use client";

import { desktopClient, writeDesktopDebugLog } from "@/lib/desktop-client";

const OUTPUT_SAMPLE_RATE = 24_000;
const STREAM_FINISH_TIMEOUT_MS = 15_000;
const GATEWAY_TRANSCRIPTION_PROTOCOL = "ai-gateway-transcription.v1";
const GATEWAY_AUTH_PROTOCOL_PREFIX = "ai-gateway-auth.";

type StreamingTranscriptionCredentials = {
	token: string;
	url: string;
	expiresAt?: number;
};

type TranscriptionStreamPart =
	| { type: "stream-start" }
	| { type: "transcript-delta"; delta: string }
	| { type: "transcript-partial"; id?: string; text: string }
	| { type: "transcript-final"; id?: string; text: string }
	| { type: "finish"; text: string }
	| { type: "error"; error: unknown }
	| { type: string };

export type StreamingSpeechSession = {
	done: Promise<void>;
	stop(): void;
	cancel(): void;
};

type AudioCapture = {
	stop(): void;
};

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (error && typeof error === "object") {
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string") return message;
		try {
			return JSON.stringify(error);
		} catch {
			// Fall through to the generic message.
		}
	}
	return typeof error === "string" ? error : "Streaming transcription failed";
}

function floatsToPcm16(samples: Float32Array): Uint8Array {
	const bytes = new Uint8Array(samples.length * 2);
	const view = new DataView(bytes.buffer);
	for (let index = 0; index < samples.length; index += 1) {
		const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
		view.setInt16(
			index * 2,
			sample < 0 ? sample * 0x8000 : sample * 0x7fff,
			true,
		);
	}
	return bytes;
}

function createResampler(inputRate: number, outputRate: number) {
	const step = inputRate / outputRate;
	let previousSample: number | undefined;
	let nextPosition = 0;

	return (input: Float32Array): Float32Array => {
		if (input.length === 0) return new Float32Array();
		const source =
			previousSample === undefined
				? input
				: Float32Array.from([previousSample, ...input]);
		const output: number[] = [];
		while (nextPosition < source.length - 1) {
			const leftIndex = Math.floor(nextPosition);
			const fraction = nextPosition - leftIndex;
			const left = source[leftIndex] ?? 0;
			const right = source[leftIndex + 1] ?? left;
			output.push(left + (right - left) * fraction);
			nextPosition += step;
		}
		nextPosition -= source.length - 1;
		previousSample = source[source.length - 1];
		return Float32Array.from(output);
	};
}

async function startPcmCapture(
	stream: MediaStream,
	onAudio: (bytes: Uint8Array) => void,
): Promise<AudioCapture> {
	const context = new AudioContext();
	await context.resume();
	const source = context.createMediaStreamSource(stream);
	const processor = context.createScriptProcessor(4096, 1, 1);
	const silentOutput = context.createGain();
	silentOutput.gain.value = 0;
	const resample = createResampler(context.sampleRate, OUTPUT_SAMPLE_RATE);

	processor.onaudioprocess = (event) => {
		const samples = resample(event.inputBuffer.getChannelData(0));
		if (samples.length > 0) {
			onAudio(floatsToPcm16(samples));
		}
	};
	source.connect(processor);
	processor.connect(silentOutput);
	silentOutput.connect(context.destination);

	let stopped = false;
	return {
		stop() {
			if (stopped) return;
			stopped = true;
			processor.onaudioprocess = null;
			source.disconnect();
			processor.disconnect();
			silentOutput.disconnect();
			for (const track of stream.getTracks()) track.stop();
			void context.close();
		},
	};
}

function parseStreamPart(value: unknown): TranscriptionStreamPart | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const type = (value as { type?: unknown }).type;
	return typeof type === "string" ? (value as TranscriptionStreamPart) : null;
}

export async function startVercelStreamingTranscription(options: {
	onTranscript: (text: string) => void;
}): Promise<StreamingSpeechSession> {
	writeDesktopDebugLog({
		scope: "voice-input",
		level: "debug",
		message: "Requesting a streaming transcription session",
		timestamp: new Date().toISOString(),
	});
	const credentials =
		await desktopClient.invoke<StreamingTranscriptionCredentials>(
			"create_streaming_transcription_session",
		);
	const mediaStream = await navigator.mediaDevices.getUserMedia({
		audio: true,
	});

	let capture: AudioCapture | null = null;
	let socket: WebSocket | null = null;
	let stopped = false;
	let finished = false;
	let receivedDeltas = false;
	let deltaTranscript = "";
	const finalSegments: string[] = [];
	const partialSegments = new Map<string, string>();
	let finishTimeout: ReturnType<typeof setTimeout> | null = null;
	let resolveDone: () => void = () => {};
	let rejectDone: (error: Error) => void = () => {};
	const done = new Promise<void>((resolve, reject) => {
		resolveDone = resolve;
		rejectDone = reject;
	});

	const cleanup = () => {
		if (finishTimeout) {
			clearTimeout(finishTimeout);
			finishTimeout = null;
		}
		capture?.stop();
		capture = null;
		for (const track of mediaStream.getTracks()) track.stop();
		if (
			socket &&
			(socket.readyState === WebSocket.OPEN ||
				socket.readyState === WebSocket.CONNECTING)
		) {
			socket.close(1000);
		}
		socket = null;
	};
	const fail = (error: unknown) => {
		if (finished) return;
		finished = true;
		cleanup();
		rejectDone(new Error(errorMessage(error)));
	};
	const complete = (text: string) => {
		if (finished) return;
		finished = true;
		const transcript = text.trim();
		if (transcript) options.onTranscript(transcript);
		cleanup();
		resolveDone();
	};
	const emitSegmentTranscript = () => {
		const text = [...finalSegments, ...partialSegments.values()]
			.join(" ")
			.trim();
		if (text) options.onTranscript(text);
	};

	try {
		socket = new WebSocket(credentials.url, [
			GATEWAY_TRANSCRIPTION_PROTOCOL,
			`${GATEWAY_AUTH_PROTOCOL_PREFIX}${credentials.token}`,
		]);
		socket.binaryType = "arraybuffer";
		await new Promise<void>((resolve, reject) => {
			if (!socket) {
				reject(new Error("Streaming transcription socket was not created"));
				return;
			}
			const connectionTimeout = window.setTimeout(
				() => reject(new Error("Streaming transcription connection timed out")),
				15_000,
			);
			socket.onopen = () => {
				window.clearTimeout(connectionTimeout);
				resolve();
			};
			socket.onerror = () => {
				window.clearTimeout(connectionTimeout);
				reject(new Error("Unable to connect to streaming transcription"));
			};
		});
		socket.send(
			JSON.stringify({
				type: "transcription-stream.start",
				inputAudioFormat: { type: "audio/pcm", rate: OUTPUT_SAMPLE_RATE },
			}),
		);
		capture = await startPcmCapture(mediaStream, (bytes) => {
			if (socket?.readyState === WebSocket.OPEN && !stopped && !finished) {
				socket.send(bytes);
			}
		});

		socket.onmessage = (event) => {
			if (typeof event.data !== "string") return;
			let parsed: unknown;
			try {
				parsed = JSON.parse(event.data) as unknown;
			} catch {
				return;
			}
			const part = parseStreamPart(parsed);
			if (!part) return;
			switch (part.type) {
				case "transcript-delta":
					if (typeof part.delta !== "string") return;
					receivedDeltas = true;
					deltaTranscript += part.delta;
					if (deltaTranscript.trim()) {
						options.onTranscript(deltaTranscript.trim());
					}
					break;
				case "transcript-partial":
					if (receivedDeltas || typeof part.text !== "string") return;
					partialSegments.set(part.id ?? "active", part.text);
					emitSegmentTranscript();
					break;
				case "transcript-final":
					if (receivedDeltas || typeof part.text !== "string") return;
					partialSegments.delete(part.id ?? "active");
					if (part.text.trim()) finalSegments.push(part.text.trim());
					emitSegmentTranscript();
					break;
				case "finish":
					complete(typeof part.text === "string" ? part.text : "");
					break;
				case "error":
					fail(part.error);
					break;
			}
		};
		socket.onerror = () => {
			fail(new Error("Streaming transcription connection failed"));
		};
		socket.onclose = () => {
			if (!finished) {
				fail(
					new Error(
						"Streaming transcription ended before a final transcript was received",
					),
				);
			}
		};
		writeDesktopDebugLog({
			scope: "voice-input",
			level: "debug",
			message: "Streaming transcription is connected",
			timestamp: new Date().toISOString(),
			metadata: { expiresAt: credentials.expiresAt },
		});
	} catch (error) {
		fail(error);
		await done;
	}

	return {
		done,
		stop() {
			if (stopped || finished) return;
			stopped = true;
			capture?.stop();
			capture = null;
			if (socket?.readyState === WebSocket.OPEN) {
				socket.send(
					JSON.stringify({ type: "transcription-stream.audio-done" }),
				);
				finishTimeout = setTimeout(() => {
					fail(new Error("Streaming transcription timed out while finalizing"));
				}, STREAM_FINISH_TIMEOUT_MS);
			} else {
				fail(new Error("Streaming transcription connection is not open"));
			}
		},
		cancel() {
			if (finished) return;
			finished = true;
			cleanup();
			resolveDone();
		},
	};
}
