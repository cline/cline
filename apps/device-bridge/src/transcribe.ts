import { createGateway } from "@ai-sdk/gateway";
import { createOpenAI } from "@ai-sdk/openai";
import {
	createConfiguredStreamingTranscriptionSession,
	type ProviderSettingsManager,
	transcribeConfiguredVoiceInput,
} from "@cline/core";
import type { StreamingAudioTranscriptionSession } from "@cline/shared";
import { experimental_streamTranscribe as streamTranscribe } from "ai";
import type { Transcriber, TranscriptionStream } from "./bridge";
import { AUDIO_SAMPLE_RATE } from "./protocol";
import { pcmToWav } from "./wav";

/*
 * Server-side twin of the desktop app's webview voice input
 * (apps/examples/desktop-app/webview/lib/streaming-transcription.ts).
 *
 * Voice settings only accept streaming models, so the bridge does what the
 * webview does: mint a short-lived provider session with
 * createConfiguredStreamingTranscriptionSession() and stream PCM into it
 * while the user talks. Batch transcription is kept as a fallback for
 * providers.json setups that point at a non-streaming model.
 */

const FINISH_TIMEOUT_MS = 15_000;
/** Generous: covers the longest recording plus finalisation. */
const SESSION_SECONDS = 180;

/** Linear-interpolating s16le resampler that carries state across chunks. */
export function createPcmResampler(inputRate: number, outputRate: number) {
	if (inputRate === outputRate) return (chunk: Uint8Array) => chunk;
	const step = inputRate / outputRate;
	let previous: number | undefined;
	let position = 0;
	return (chunk: Uint8Array): Uint8Array => {
		const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
		const count = Math.floor(chunk.byteLength / 2);
		if (count === 0) return new Uint8Array();
		const source = new Float64Array(count + (previous === undefined ? 0 : 1));
		let offset = 0;
		if (previous !== undefined) source[offset++] = previous;
		for (let i = 0; i < count; i++)
			source[offset++] = view.getInt16(i * 2, true);
		const out: number[] = [];
		while (position < source.length - 1) {
			const left = Math.floor(position);
			const fraction = position - left;
			out.push(source[left] + (source[left + 1] - source[left]) * fraction);
			position += step;
		}
		position -= source.length - 1;
		previous = source[source.length - 1];
		const bytes = new Uint8Array(out.length * 2);
		const outView = new DataView(bytes.buffer);
		for (let i = 0; i < out.length; i++) {
			outView.setInt16(i * 2, Math.round(out[i]), true);
		}
		return bytes;
	};
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (error && typeof error === "object") {
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string") return message;
	}
	return typeof error === "string" ? error : "Transcription failed";
}

interface Sink {
	push(pcm: Uint8Array): void;
	finish(): Promise<string>;
	cancel(): void;
}

/** OpenAI realtime / Vercel AI Gateway via the AI SDK's streamTranscribe. */
function aiSdkSink(
	session: Extract<StreamingAudioTranscriptionSession, { baseUrl: string }>,
): Sink {
	const abort = new AbortController();
	let controller!: ReadableStreamDefaultController<Uint8Array>;
	const audio = new ReadableStream<Uint8Array>({
		start(c) {
			controller = c;
		},
	});
	const options = { apiKey: session.token, baseURL: session.baseUrl };
	const model =
		session.transport === "openai-native"
			? createOpenAI(options).transcription(session.modelId)
			: createGateway(options).transcriptionModel(session.modelId);
	const result = streamTranscribe({
		model,
		audio,
		inputAudioFormat: { type: "audio/pcm", rate: session.sampleRate },
		abortSignal: abort.signal,
		includeRawChunks: true,
	});
	// Surface the upstream error text instead of the gateway's generic one.
	let providerError: string | undefined;
	const drained = (async () => {
		for await (const part of result.fullStream as AsyncIterable<{
			type: string;
			rawValue?: { type?: string; error?: { message?: unknown } } | null;
		}>) {
			const raw = part.type === "raw" ? part.rawValue : undefined;
			if (raw?.type === "error" && typeof raw.error?.message === "string") {
				providerError = raw.error.message;
			}
		}
	})();
	const text = Promise.resolve(result.text);
	void drained.catch(() => {});
	void text.catch(() => {});
	let closed = false;
	return {
		push(pcm) {
			if (!closed) controller.enqueue(pcm);
		},
		async finish() {
			if (!closed) {
				closed = true;
				controller.close();
			}
			try {
				await drained;
				return await text;
			} catch (error) {
				throw new Error(providerError ?? errorMessage(error));
			}
		},
		cancel() {
			closed = true;
			abort.abort();
		},
	};
}

/** ElevenLabs Scribe realtime over a raw WebSocket (manual commit). */
function elevenLabsSink(session: StreamingAudioTranscriptionSession): Sink {
	const url = new URL(session.url);
	url.searchParams.set("token", session.token);
	const socket = new WebSocket(url.toString());
	const queue: string[] = [];
	const finals: string[] = [];
	let stopped = false;
	let settle:
		| { resolve(text: string): void; reject(error: Error): void }
		| undefined;
	let failure: Error | undefined;
	const fail = (error: Error) => {
		failure ??= error;
		settle?.reject(failure);
	};
	const send = (message: object) => {
		const data = JSON.stringify(message);
		if (socket.readyState === WebSocket.OPEN) socket.send(data);
		else queue.push(data);
	};
	socket.onopen = () => {
		for (const data of queue.splice(0)) socket.send(data);
	};
	socket.onmessage = (event) => {
		if (typeof event.data !== "string") return;
		let part: { message_type?: string; text?: unknown; error?: unknown };
		try {
			part = JSON.parse(event.data);
		} catch {
			return;
		}
		if (part.error !== undefined)
			return fail(new Error(errorMessage(part.error)));
		if (
			part.message_type === "committed_transcript" &&
			typeof part.text === "string"
		) {
			if (part.text.trim()) finals.push(part.text.trim());
			if (stopped) settle?.resolve(finals.join(" "));
		}
	};
	socket.onerror = () =>
		fail(new Error("ElevenLabs transcription connection failed"));
	socket.onclose = (event) => {
		if (stopped) settle?.resolve(finals.join(" "));
		else
			fail(new Error(`ElevenLabs transcription closed (code ${event.code})`));
	};
	return {
		push(pcm) {
			send({
				message_type: "input_audio_chunk",
				audio_base_64: Buffer.from(pcm).toString("base64"),
				sample_rate: session.sampleRate,
			});
		},
		finish() {
			stopped = true;
			if (failure) return Promise.reject(failure);
			const done = new Promise<string>((resolve, reject) => {
				settle = { resolve, reject };
			});
			send({
				message_type: "input_audio_chunk",
				audio_base_64: "",
				commit: true,
				sample_rate: session.sampleRate,
			});
			return done.finally(() => socket.close(1000));
		},
		cancel() {
			stopped = true;
			socket.close(1000);
		},
	};
}

/** Fallback for non-streaming models: buffer, then transcribe a WAV. */
function batchSink(providers: ProviderSettingsManager): Sink {
	const chunks: Uint8Array[] = [];
	const abort = new AbortController();
	return {
		push(pcm) {
			chunks.push(pcm);
		},
		async finish() {
			const pcm = Buffer.concat(chunks);
			const result = await transcribeConfiguredVoiceInput(providers, {
				audio: pcmToWav(pcm),
				abortSignal: abort.signal,
			});
			return result.text;
		},
		cancel() {
			abort.abort();
		},
	};
}

function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	message: string,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return Promise.race([
		promise,
		new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error(message)), ms);
		}),
	]).finally(() => clearTimeout(timer));
}

/**
 * Transcriber backed by the user's Settings → Voice input selection.
 * Audio pushed before the provider session is ready is buffered (resampled)
 * and flushed once it connects, so no speech is lost to setup latency.
 */
export function createVoiceTranscriber(
	providers: ProviderSettingsManager,
	log: (message: string) => void = () => {},
): Transcriber {
	return (): TranscriptionStream => {
		const abort = new AbortController();
		const pending: Uint8Array[] = [];
		let sink: Sink | undefined;
		let resample = (chunk: Uint8Array) => chunk;
		let cancelled = false;

		const ready: Promise<Sink> = (async () => {
			let next: Sink;
			try {
				const session = await createConfiguredStreamingTranscriptionSession(
					providers,
					{
						expiresAfterSeconds: SESSION_SECONDS,
						abortSignal: abort.signal,
					},
				);
				resample = createPcmResampler(AUDIO_SAMPLE_RATE, session.sampleRate);
				next =
					session.transport === "elevenlabs"
						? elevenLabsSink(session)
						: aiSdkSink(session);
				log(
					`voice: streaming to ${session.transport} (${session.sampleRate} Hz)`,
				);
			} catch (error) {
				if (!/does not support streaming/.test(errorMessage(error)))
					throw error;
				next = batchSink(providers);
				log("voice: model is batch-only; transcribing after release");
			}
			if (cancelled) {
				next.cancel();
				return next;
			}
			for (const chunk of pending.splice(0)) next.push(resample(chunk));
			sink = next;
			return next;
		})();
		void ready.catch(() => {});

		return {
			push(pcm) {
				if (cancelled) return;
				if (sink) sink.push(resample(pcm));
				else pending.push(pcm);
			},
			async finish() {
				const active = await ready;
				return withTimeout(
					active.finish(),
					FINISH_TIMEOUT_MS,
					"Transcription timed out while finalizing",
				);
			},
			cancel() {
				cancelled = true;
				abort.abort();
				sink?.cancel();
			},
		};
	};
}
