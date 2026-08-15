import { createOpenAI } from "@ai-sdk/openai";
import { experimental_generateSpeech as generateSpeech } from "ai";
import type { ProviderConfig } from "./providers/config";
import {
	resolveVercelAiGatewayBaseUrl,
	trimTrailingSlashes,
} from "./providers/url";

export const DEFAULT_SPEECH_GENERATION_TIMEOUT_MS = 120_000;
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1";
const DEFAULT_GEMINI_BASE_URL =
	"https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_VERCEL_AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v4/ai";
const VERCEL_AI_GATEWAY_PROTOCOL_VERSION = "0.0.1";
const VERCEL_AI_GATEWAY_SPEECH_SPECIFICATION_VERSION = "4";

export interface SpeechGenerationRequest {
	providerConfig: ProviderConfig;
	modelId: string;
	text: string;
	voice?: string;
	outputFormat?: string;
	abortSignal?: AbortSignal;
	maxRetries?: number;
}

export interface SpeechGenerationResult {
	audio: Uint8Array;
	mediaType: string;
}

export interface SpeechGenerationRoute {
	kind: "elevenlabs" | "gemini" | "vercel-ai-gateway" | "openai-compatible";
	baseUrl: string;
	endpoint: string;
}

function resolveVercelAIGatewayBaseUrl(
	configuredBaseUrl: string | undefined,
): string {
	return resolveVercelAiGatewayBaseUrl(
		configuredBaseUrl,
		DEFAULT_VERCEL_AI_GATEWAY_BASE_URL,
	);
}

export function resolveSpeechGenerationRoute(
	config: Pick<ProviderConfig, "providerId" | "baseUrl">,
): SpeechGenerationRoute {
	if (config.providerId === "elevenlabs") {
		const baseUrl = trimTrailingSlashes(
			config.baseUrl ?? DEFAULT_ELEVENLABS_BASE_URL,
		);
		return {
			kind: "elevenlabs",
			baseUrl,
			endpoint: `${baseUrl}/text-to-speech`,
		};
	}

	if (config.providerId === "gemini") {
		const baseUrl = trimTrailingSlashes(
			config.baseUrl ?? DEFAULT_GEMINI_BASE_URL,
		);
		return {
			kind: "gemini",
			baseUrl,
			endpoint: `${baseUrl}/models`,
		};
	}

	if (config.providerId === "vercel-ai-gateway") {
		const baseUrl = resolveVercelAIGatewayBaseUrl(config.baseUrl);
		return {
			kind: "vercel-ai-gateway",
			baseUrl,
			endpoint: `${baseUrl}/speech-model`,
		};
	}

	const baseUrl = trimTrailingSlashes(
		config.baseUrl ?? DEFAULT_OPENAI_BASE_URL,
	);
	return {
		kind: "openai-compatible",
		baseUrl,
		endpoint: `${baseUrl}/audio/speech`,
	};
}

function resolveApiKey(
	config: Pick<ProviderConfig, "apiKey" | "accessToken">,
): string | undefined {
	return config.apiKey?.trim() || config.accessToken?.trim() || undefined;
}

function resolveAbortSignal(
	config: ProviderConfig,
	requestSignal: AbortSignal | undefined,
): AbortSignal {
	const timeoutSignal = AbortSignal.timeout(
		config.timeoutMs ?? DEFAULT_SPEECH_GENERATION_TIMEOUT_MS,
	);
	const signals = [requestSignal, config.abortSignal, timeoutSignal].filter(
		(signal): signal is AbortSignal => signal !== undefined,
	);
	return signals.length === 1 ? signals[0] : AbortSignal.any(signals);
}

async function readErrorBody(response: Response): Promise<string> {
	const body = await response.text().catch(() => "");
	if (!body) return "";
	try {
		const parsed = JSON.parse(body) as unknown;
		if (parsed && typeof parsed === "object") {
			const record = parsed as {
				detail?: unknown;
				error?: unknown;
				message?: unknown;
			};
			if (typeof record.message === "string") return record.message;
			if (record.error && typeof record.error === "object") {
				const message = (record.error as { message?: unknown }).message;
				if (typeof message === "string") return message;
			}
			if (typeof record.detail === "string") return record.detail;
		}
	} catch {
		// Use the raw response body below.
	}
	return body;
}

function mediaTypeForOutputFormat(outputFormat: string): string {
	switch (outputFormat.toLowerCase()) {
		case "wav":
			return "audio/wav";
		case "aac":
			return "audio/aac";
		case "flac":
			return "audio/flac";
		case "opus":
			return "audio/opus";
		case "pcm":
			return "audio/pcm";
		default:
			return "audio/mpeg";
	}
}

function decodeBase64Audio(value: string, source: string): Uint8Array {
	const audio = new Uint8Array(Buffer.from(value, "base64"));
	if (audio.byteLength === 0) {
		throw new Error(`${source} returned empty audio`);
	}
	return audio;
}

function writeAscii(target: Uint8Array, offset: number, value: string): void {
	for (let index = 0; index < value.length; index += 1) {
		target[offset + index] = value.charCodeAt(index);
	}
}

/**
 * Gemini's REST speech response is headerless, signed 16-bit little-endian
 * PCM. Browsers need a WAV container before they can play it.
 */
function wrapPcm16LeAsWav(
	pcm: Uint8Array,
	sampleRate: number,
	channels = 1,
): Uint8Array {
	const headerSize = 44;
	const wav = new Uint8Array(headerSize + pcm.byteLength);
	const view = new DataView(wav.buffer);
	const bytesPerSample = 2;
	writeAscii(wav, 0, "RIFF");
	view.setUint32(4, wav.byteLength - 8, true);
	writeAscii(wav, 8, "WAVE");
	writeAscii(wav, 12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, channels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * channels * bytesPerSample, true);
	view.setUint16(32, channels * bytesPerSample, true);
	view.setUint16(34, bytesPerSample * 8, true);
	writeAscii(wav, 36, "data");
	view.setUint32(40, pcm.byteLength, true);
	wav.set(pcm, headerSize);
	return wav;
}

async function generateVercelAIGatewaySpeech(
	request: SpeechGenerationRequest,
	apiKey: string,
): Promise<SpeechGenerationResult> {
	const route = resolveSpeechGenerationRoute(request.providerConfig);
	const outputFormat = request.outputFormat?.trim() || "mp3";
	const headers = new Headers(request.providerConfig.headers);
	if (!headers.has("authorization")) {
		headers.set("authorization", `Bearer ${apiKey}`);
	}
	headers.set(
		"ai-gateway-protocol-version",
		VERCEL_AI_GATEWAY_PROTOCOL_VERSION,
	);
	headers.set("ai-gateway-auth-method", "api-key");
	headers.set(
		"ai-speech-model-specification-version",
		VERCEL_AI_GATEWAY_SPEECH_SPECIFICATION_VERSION,
	);
	headers.set("ai-model-id", request.modelId.trim());
	headers.set("content-type", "application/json");

	const fetchImpl = request.providerConfig.fetch ?? fetch;
	const response = await fetchImpl(route.endpoint, {
		method: "POST",
		headers,
		body: JSON.stringify({
			text: request.text,
			voice: request.voice?.trim() || undefined,
			outputFormat,
		}),
		signal: resolveAbortSignal(request.providerConfig, request.abortSignal),
	});
	if (!response.ok) {
		const detail = await readErrorBody(response);
		throw new Error(
			`Vercel AI Gateway speech generation failed (${response.status})${detail ? `: ${detail}` : ""}`,
		);
	}

	const result = (await response.json()) as { audio?: unknown };
	if (typeof result.audio !== "string") {
		throw new Error("Vercel AI Gateway speech generation returned no audio");
	}
	return {
		audio: decodeBase64Audio(result.audio, "Vercel AI Gateway"),
		mediaType: mediaTypeForOutputFormat(outputFormat),
	};
}

async function generateElevenLabsSpeech(
	request: SpeechGenerationRequest,
	apiKey: string,
): Promise<SpeechGenerationResult> {
	const voice = request.voice?.trim();
	if (!voice) {
		throw new Error(
			"ElevenLabs speech generation requires a voice ID in voice output settings",
		);
	}
	const route = resolveSpeechGenerationRoute(request.providerConfig);
	const endpoint = `${route.endpoint}/${encodeURIComponent(voice)}`;
	const headers = new Headers(request.providerConfig.headers);
	headers.set("xi-api-key", apiKey);
	headers.set("accept", "audio/mpeg");
	headers.set("content-type", "application/json");

	const fetchImpl = request.providerConfig.fetch ?? fetch;
	const response = await fetchImpl(endpoint, {
		method: "POST",
		headers,
		body: JSON.stringify({
			text: request.text,
			model_id: request.modelId.trim(),
		}),
		signal: resolveAbortSignal(request.providerConfig, request.abortSignal),
	});
	if (!response.ok) {
		const detail = await readErrorBody(response);
		throw new Error(
			`ElevenLabs speech generation failed (${response.status})${detail ? `: ${detail}` : ""}`,
		);
	}
	const audio = new Uint8Array(await response.arrayBuffer());
	if (audio.byteLength === 0) {
		throw new Error("ElevenLabs speech generation returned empty audio");
	}
	return {
		audio,
		mediaType: response.headers.get("content-type") || "audio/mpeg",
	};
}

async function generateGeminiSpeech(
	request: SpeechGenerationRequest,
	apiKey: string,
): Promise<SpeechGenerationResult> {
	const route = resolveSpeechGenerationRoute(request.providerConfig);
	const endpoint = `${route.endpoint}/${encodeURIComponent(
		request.modelId.trim(),
	)}:generateContent`;
	const headers = new Headers(request.providerConfig.headers);
	headers.set("x-goog-api-key", apiKey);
	headers.set("content-type", "application/json");

	const fetchImpl = request.providerConfig.fetch ?? fetch;
	const response = await fetchImpl(endpoint, {
		method: "POST",
		headers,
		body: JSON.stringify({
			contents: [{ parts: [{ text: request.text }] }],
			generationConfig: {
				responseModalities: ["AUDIO"],
				speechConfig: {
					voiceConfig: {
						prebuiltVoiceConfig: {
							voiceName: request.voice?.trim() || "Kore",
						},
					},
				},
			},
		}),
		signal: resolveAbortSignal(request.providerConfig, request.abortSignal),
	});
	if (!response.ok) {
		const detail = await readErrorBody(response);
		throw new Error(
			`Gemini speech generation failed (${response.status})${detail ? `: ${detail}` : ""}`,
		);
	}

	const result = (await response.json()) as {
		candidates?: Array<{
			content?: {
				parts?: Array<{
					inlineData?: { data?: unknown; mimeType?: unknown };
					inline_data?: { data?: unknown; mime_type?: unknown };
				}>;
			};
		}>;
	};
	const parts = result.candidates?.flatMap(
		(candidate) => candidate.content?.parts ?? [],
	);
	const inlineData = parts
		?.map(
			(part): { data?: unknown; mimeType?: unknown; mime_type?: unknown } =>
				part.inlineData ?? part.inline_data ?? {},
		)
		.find((part) => typeof part?.data === "string");
	if (!inlineData || typeof inlineData.data !== "string") {
		throw new Error("Gemini speech generation returned no audio");
	}

	const pcm = decodeBase64Audio(inlineData.data, "Gemini");
	const rawMediaType =
		typeof inlineData.mimeType === "string"
			? inlineData.mimeType
			: typeof inlineData.mime_type === "string"
				? inlineData.mime_type
				: "audio/L16;rate=24000";
	const isRawPcm = /audio\/(?:l16|pcm)/i.test(rawMediaType);
	if (!isRawPcm) {
		return { audio: pcm, mediaType: rawMediaType };
	}
	const rateMatch = /(?:^|;)\s*rate=(\d+)/i.exec(rawMediaType);
	const sampleRate = rateMatch ? Number(rateMatch[1]) : 24_000;
	return {
		audio: wrapPcm16LeAsWav(pcm, sampleRate),
		mediaType: "audio/wav",
	};
}

export async function generateSpeechAudio(
	request: SpeechGenerationRequest,
): Promise<SpeechGenerationResult> {
	const modelId = request.modelId.trim();
	if (!modelId) {
		throw new Error("A speech generation model is required");
	}
	const text = request.text.trim();
	if (!text) {
		throw new Error("Speech generation text is required");
	}
	const apiKey = resolveApiKey(request.providerConfig);
	if (!apiKey) {
		throw new Error(
			`Provider "${request.providerConfig.providerId}" is missing credentials`,
		);
	}

	switch (request.providerConfig.providerId) {
		case "elevenlabs":
			return generateElevenLabsSpeech({ ...request, text }, apiKey);
		case "gemini":
			return generateGeminiSpeech({ ...request, text }, apiKey);
		case "vercel-ai-gateway":
			return generateVercelAIGatewaySpeech({ ...request, text }, apiKey);
		default: {
			const route = resolveSpeechGenerationRoute(request.providerConfig);
			const provider = createOpenAI({
				apiKey,
				baseURL: route.baseUrl,
				fetch: request.providerConfig.fetch,
				headers: request.providerConfig.headers,
			});
			const result = await generateSpeech({
				model: provider.speech(modelId),
				text,
				voice: request.voice?.trim() || "alloy",
				outputFormat: request.outputFormat?.trim() || "mp3",
				abortSignal: resolveAbortSignal(
					request.providerConfig,
					request.abortSignal,
				),
				maxRetries: request.maxRetries,
			});
			return {
				audio: result.audio.uint8Array,
				mediaType: result.audio.mediaType,
			};
		}
	}
}
