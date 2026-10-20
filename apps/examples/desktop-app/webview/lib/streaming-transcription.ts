"use client";

import { createGateway } from "@ai-sdk/gateway";
import { createOpenAI } from "@ai-sdk/openai";
import type { StreamingAudioTranscriptionSession } from "@cline/shared/browser";
import { experimental_streamTranscribe as streamTranscribe } from "ai";
import { desktopClient, writeDesktopDebugLog } from "@/lib/desktop-client";

const STREAM_FINISH_TIMEOUT_MS = 15_000;

type TranscriptionStreamPart = {
	type: string;
	id?: string;
	delta?: string;
	text?: string;
	error?: unknown;
	rawValue?: unknown;
};

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
	sampleRate: number,
	onAudio: (bytes: Uint8Array) => void,
): Promise<AudioCapture> {
	const context = new AudioContext();
	try {
		await context.resume();
	} catch (error) {
		void context.close();
		throw error;
	}
	const source = context.createMediaStreamSource(stream);
	const processor = context.createScriptProcessor(4096, 1, 1);
	const silentOutput = context.createGain();
	silentOutput.gain.value = 0;
	const resample = createResampler(context.sampleRate, sampleRate);

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

function parseElevenLabsPart(value: unknown): TranscriptionStreamPart | null {
	if (!value || typeof value !== "object") return null;
	const part = value as {
		message_type?: string;
		text?: unknown;
		error?: unknown;
	};
	if (part.error !== undefined) return { type: "error", error: part.error };
	if (typeof part.text !== "string") return null;
	if (part.message_type === "partial_transcript")
		return { type: "transcript-partial", text: part.text };
	if (part.message_type === "committed_transcript")
		return { type: "transcript-final", text: part.text };
	return null;
}

export async function startStreamingTranscription(options: {
	onTranscript: (text: string) => void;
}): Promise<StreamingSpeechSession> {
	writeDesktopDebugLog({
		scope: "voice-input",
		level: "debug",
		message: "Requesting a streaming transcription session",
		timestamp: new Date().toISOString(),
	});
	const credentials =
		await desktopClient.invoke<StreamingAudioTranscriptionSession>(
			"create_streaming_transcription_session",
		);
	const mediaStream = await navigator.mediaDevices.getUserMedia({
		audio: true,
	});

	let capture: AudioCapture | null = null;
	const abort = new AbortController();
	let audioController: ReadableStreamDefaultController<Uint8Array> | undefined;
	let socket: WebSocket | null = null;
	let stopped = false;
	let sdkConnectionOpened = false;
	let sdkConnectionLost = false;
	let finished = false;
	const finalSegments: string[] = [];
	const segments = new Map<string, { text: string; delta: string }>();
	let connectionTimeout: ReturnType<typeof setTimeout> | null = null;
	let rejectConnection: (error: Error) => void = () => {};
	let providerError: string | undefined;
	let finishTimeout: ReturnType<typeof setTimeout> | null = null;
	let resolveDone: () => void = () => {};
	let rejectDone: (error: Error) => void = () => {};
	const done = new Promise<void>((resolve, reject) => {
		resolveDone = resolve;
		rejectDone = reject;
	});

	// A provider may fail before microphone startup has returned the session.
	void done.catch(() => {});
	const cleanup = () => {
		window.removeEventListener("offline", handleOffline);
		abort.abort();
		if (connectionTimeout) clearTimeout(connectionTimeout);
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
		const failure =
			sdkConnectionLost &&
			!providerError &&
			((error instanceof Error &&
				error.name === "AI_NoTranscriptGeneratedError") ||
				/(Connection error on AI Gateway transcription stream|AI Gateway transcription stream closed before a finish part was received|OpenAI realtime transcription error)$/.test(
					errorMessage(error),
				))
				? new Error("Streaming transcription network connection was lost", {
						cause: error,
					})
				: error instanceof Error
					? error
					: new Error(errorMessage(error));
		rejectConnection(failure);
		rejectDone(failure);
		writeDesktopDebugLog({
			scope: "voice-input",
			level: "warn",
			message: failure.message,
			timestamp: new Date().toISOString(),
			metadata: { transport: credentials.transport },
		});
	};
	const handleOffline = () =>
		fail(new Error("Streaming transcription network connection was lost"));
	window.addEventListener("offline", handleOffline);
	const complete = (text: string) => {
		if (finished) return;
		finished = true;
		const transcript = text.trim();
		if (transcript) options.onTranscript(transcript);
		cleanup();
		resolveDone();
	};
	const emitSegmentTranscript = () => {
		const text = [
			...finalSegments,
			...Array.from(segments.values(), (segment) => segment.text),
		]
			.join(" ")
			.trim();
		if (text) options.onTranscript(text);
	};

	const handlePart = (part: TranscriptionStreamPart) => {
		if (finished) return;
		switch (part.type) {
			case "transcript-delta": {
				if (typeof part.delta !== "string") return;
				const id = part.id ?? "active";
				const delta = (segments.get(id)?.delta ?? "") + part.delta;
				segments.set(id, { text: delta, delta });
				emitSegmentTranscript();
				break;
			}
			case "transcript-partial": {
				if (typeof part.text !== "string") return;
				const id = part.id ?? "active";
				segments.set(id, {
					text: part.text,
					delta: segments.get(id)?.delta ?? "",
				});
				emitSegmentTranscript();
				break;
			}
			case "transcript-final":
				if (typeof part.text !== "string") return;
				if (part.id)
					segments.set(part.id, { text: part.text, delta: part.text });
				else {
					segments.delete("active");
					if (part.text.trim()) finalSegments.push(part.text.trim());
				}
				emitSegmentTranscript();
				break;
			case "finish":
				complete(typeof part.text === "string" ? part.text : "");
				break;
			case "raw": {
				// Gateway otherwise replaces upstream errors with a generic message.
				const raw = part.rawValue as {
					type?: string;
					error?: { message?: unknown };
				} | null;
				if (raw?.type === "error" && typeof raw.error?.message === "string")
					providerError = raw.error.message;
				break;
			}
			case "error":
				fail(providerError ?? part.error);
				break;
		}
	};
	try {
		if (credentials.transport !== "elevenlabs") {
			const audio = new ReadableStream<Uint8Array>(
				{
					start(controller) {
						audioController = controller;
					},
				},
				{ highWaterMark: 1024 * 1024, size: (chunk) => chunk.byteLength },
			);
			const provider = (
				credentials.transport === "openai-native" ? createOpenAI : createGateway
			)({
				apiKey: credentials.token,
				baseURL: credentials.baseUrl,
				webSocket: class extends WebSocket {
					constructor(url: string | URL, protocols?: string | string[]) {
						super(url, protocols);
						this.addEventListener("open", () => {
							sdkConnectionOpened = true;
						});
						this.addEventListener("error", () => {
							sdkConnectionLost =
								sdkConnectionOpened || navigator.onLine === false;
						});
						this.addEventListener("close", (event) => {
							if (event.code === 1006 && sdkConnectionOpened)
								sdkConnectionLost = true;
						});
					}
				},
			});
			const result = streamTranscribe({
				model: provider.transcriptionModel(credentials.modelId),
				audio,
				inputAudioFormat: { type: "audio/pcm", rate: credentials.sampleRate },
				abortSignal: abort.signal,
				includeRawChunks: true,
			});
			// Claim the stream before requesting the final text (which otherwise drains it).
			const parts = result.fullStream;
			const finalText = Promise.resolve(result.text);
			void finalText.catch(() => {});
			void (async () => {
				try {
					for await (const part of parts) handlePart(part);
					complete(await finalText);
				} catch (error) {
					fail(providerError ?? error);
				}
			})();
		} else {
			const url = new URL(credentials.url);
			url.searchParams.set("token", credentials.token);
			socket = new WebSocket(url.toString(), []);
			const activeSocket = socket;
			let connectionOpened = false;
			const connected = new Promise<void>((resolve, reject) => {
				rejectConnection = reject;
				connectionTimeout = setTimeout(
					() => fail(new Error("Streaming transcription connection timed out")),
					15_000,
				);
				activeSocket.onopen = () => {
					connectionOpened = true;
					if (connectionTimeout) clearTimeout(connectionTimeout);
					connectionTimeout = null;
					resolve();
				};
			});
			socket.onmessage = (event) => {
				if (finished || typeof event.data !== "string") return;
				let parsed: unknown;
				try {
					parsed = JSON.parse(event.data);
				} catch {
					return;
				}
				const part = parseElevenLabsPart(parsed);
				if (part) {
					handlePart(part);
					if (part.type === "transcript-final" && stopped)
						complete(finalSegments.join(" "));
				}
			};
			socket.onerror = () => {
				fail(
					new Error(
						providerError ??
							(connectionOpened || navigator.onLine === false
								? "Streaming transcription network connection was lost"
								: "Streaming transcription connection failed"),
					),
				);
			};
			socket.onclose = (event) => {
				if (!finished) {
					fail(
						new Error(
							providerError ??
								(connectionOpened && event.code === 1006
									? "Streaming transcription network connection was lost"
									: `Streaming transcription ended before a final transcript was received (code ${event.code})`),
						),
					);
				}
			};
			await connected;
			if (finished) {
				await done;
				throw new Error("Streaming transcription ended during setup");
			}
		}
		const startedCapture = await startPcmCapture(
			mediaStream,
			credentials.sampleRate,
			(bytes) => {
				if (stopped || finished) return;
				if (audioController) {
					if ((audioController.desiredSize ?? 0) < bytes.byteLength) {
						fail(
							new Error(
								"Streaming transcription network is too slow to send microphone audio",
							),
						);
					} else audioController.enqueue(bytes);
				} else if (socket?.readyState === WebSocket.OPEN) {
					socket.send(
						JSON.stringify({
							message_type: "input_audio_chunk",
							audio_base_64: btoa(String.fromCharCode(...bytes)),
							sample_rate: credentials.sampleRate,
						}),
					);
				}
			},
		);
		if (finished) {
			startedCapture.stop();
			await done;
		} else capture = startedCapture;

		writeDesktopDebugLog({
			scope: "voice-input",
			level: "debug",
			message: "Streaming transcription microphone capture started",
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
			if (audioController) audioController.close();
			else if (socket?.readyState === WebSocket.OPEN) {
				socket.send(
					JSON.stringify({
						message_type: "input_audio_chunk",
						audio_base_64: "",
						commit: true,
						sample_rate: credentials.sampleRate,
					}),
				);
			} else {
				fail(new Error("Streaming transcription connection is not open"));
				return;
			}
			finishTimeout = setTimeout(
				() =>
					fail(new Error("Streaming transcription timed out while finalizing")),
				STREAM_FINISH_TIMEOUT_MS,
			);
		},
		cancel() {
			if (finished) return;
			finished = true;
			cleanup();
			resolveDone();
		},
	};
}
