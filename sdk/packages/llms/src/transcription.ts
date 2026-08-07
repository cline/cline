import { createOpenAI } from "@ai-sdk/openai";
import { experimental_transcribe as transcribe } from "ai";
import type { ProviderConfig } from "./providers/config";
import {
	resolveVercelAiGatewayBaseUrl,
	trimTrailingSlashes,
} from "./providers/url";

export const DEFAULT_TRANSCRIPTION_TIMEOUT_MS = 120_000;
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1";
const DEFAULT_VERCEL_AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v4/ai";
const VERCEL_AI_GATEWAY_PROTOCOL_VERSION = "0.0.1";
const VERCEL_AI_GATEWAY_TRANSCRIPTION_SPECIFICATION_VERSION = "4";

export interface AudioTranscriptionRequest {
	providerConfig: ProviderConfig;
	modelId: string;
	audio: Uint8Array;
	mediaType?: string;
	abortSignal?: AbortSignal;
	maxRetries?: number;
}

export interface AudioTranscriptionResult {
	text: string;
	language?: string;
	durationInSeconds?: number;
}

export interface StreamingAudioTranscriptionSessionRequest {
	providerConfig: ProviderConfig;
	modelId: string;
	expiresAfterSeconds?: number;
	abortSignal?: AbortSignal;
}

export interface StreamingAudioTranscriptionSession {
	token: string;
	url: string;
	expiresAt?: number;
}

export interface AudioTranscriptionRoute {
	kind: "elevenlabs" | "vercel-ai-gateway" | "openai-compatible";
	baseUrl: string;
	endpoint: string;
}

/**
 * Resolve the provider-specific transport used for audio transcription.
 *
 * Vercel AI Gateway's AI SDK protocol is not the OpenAI-compatible REST
 * surface: transcription requests go to `/v4/ai/transcription-model`.
 */
export function resolveAudioTranscriptionRoute(
	config: Pick<ProviderConfig, "providerId" | "baseUrl">,
): AudioTranscriptionRoute {
	if (config.providerId === "elevenlabs") {
		const baseUrl = trimTrailingSlashes(
			config.baseUrl ?? DEFAULT_ELEVENLABS_BASE_URL,
		);
		return {
			kind: "elevenlabs",
			baseUrl,
			endpoint: `${baseUrl}/speech-to-text`,
		};
	}

	if (config.providerId === "vercel-ai-gateway") {
		const baseUrl = resolveVercelAiGatewayBaseUrl(
			config.baseUrl,
			DEFAULT_VERCEL_AI_GATEWAY_BASE_URL,
		);
		return {
			kind: "vercel-ai-gateway",
			baseUrl,
			endpoint: `${baseUrl}/transcription-model`,
		};
	}

	const baseUrl = trimTrailingSlashes(
		config.baseUrl ?? DEFAULT_OPENAI_BASE_URL,
	);
	return {
		kind: "openai-compatible",
		baseUrl,
		endpoint: `${baseUrl}/audio/transcriptions`,
	};
}

function resolveApiKey(
	config: Pick<ProviderConfig, "apiKey" | "accessToken">,
): string | undefined {
	return config.apiKey?.trim() || config.accessToken?.trim() || undefined;
}

export function isStreamingTranscriptionModelId(modelId: string): boolean {
	return /(?:^|[/_.-])realtime(?:$|[/_.-])/.test(modelId.trim().toLowerCase());
}

function resolveAbortSignal(
	config: ProviderConfig,
	requestSignal: AbortSignal | undefined,
): AbortSignal {
	const timeoutSignal = AbortSignal.timeout(
		config.timeoutMs ?? DEFAULT_TRANSCRIPTION_TIMEOUT_MS,
	);
	const signals = [requestSignal, config.abortSignal, timeoutSignal].filter(
		(signal): signal is AbortSignal => signal !== undefined,
	);
	return signals.length === 1 ? signals[0] : AbortSignal.any(signals);
}

function resolveAudioFileExtension(mediaType: string | undefined): string {
	switch (mediaType?.split(";", 1)[0]?.trim().toLowerCase()) {
		case "audio/mpeg":
		case "audio/mp3":
			return "mp3";
		case "audio/mp4":
		case "audio/m4a":
		case "audio/x-m4a":
			return "m4a";
		case "audio/ogg":
			return "ogg";
		case "audio/wav":
		case "audio/wave":
		case "audio/x-wav":
			return "wav";
		default:
			return "webm";
	}
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
			const detail = record.detail;
			if (typeof detail === "string") return detail;
			if (detail && typeof detail === "object") {
				const message = (detail as { message?: unknown }).message;
				if (typeof message === "string") return message;
			}
		}
	} catch {
		// Use the response body below when it is not JSON.
	}
	return body;
}

async function transcribeVercelAIGatewayAudio(
	request: AudioTranscriptionRequest,
	apiKey: string,
): Promise<AudioTranscriptionResult> {
	if (isStreamingTranscriptionModelId(request.modelId)) {
		throw new Error(
			`Model "${request.modelId}" requires streaming transcription and cannot transcribe a completed recording`,
		);
	}
	const route = resolveAudioTranscriptionRoute(request.providerConfig);
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
		"ai-transcription-model-specification-version",
		VERCEL_AI_GATEWAY_TRANSCRIPTION_SPECIFICATION_VERSION,
	);
	headers.set("ai-model-id", request.modelId.trim());
	headers.set("content-type", "application/json");

	const mediaType =
		request.mediaType?.split(";", 1)[0]?.trim().toLowerCase() || "audio/webm";
	const fetchImpl = request.providerConfig.fetch ?? fetch;
	const response = await fetchImpl(route.endpoint, {
		method: "POST",
		headers,
		body: JSON.stringify({
			audio: Buffer.from(request.audio).toString("base64"),
			mediaType,
		}),
		signal: resolveAbortSignal(request.providerConfig, request.abortSignal),
	});
	if (!response.ok) {
		const detail = await readErrorBody(response);
		throw new Error(
			`Vercel AI Gateway transcription failed (${response.status})${detail ? `: ${detail}` : ""}`,
		);
	}

	const result = (await response.json()) as {
		text?: unknown;
		language?: unknown;
		durationInSeconds?: unknown;
	};
	if (typeof result.text !== "string" || !result.text.trim()) {
		throw new Error("Vercel AI Gateway transcription returned no text");
	}
	return {
		text: result.text,
		language: typeof result.language === "string" ? result.language : undefined,
		durationInSeconds:
			typeof result.durationInSeconds === "number"
				? result.durationInSeconds
				: undefined,
	};
}

/**
 * Mint a short-lived credential for a browser transcription WebSocket.
 *
 * The long-lived provider credential remains on the trusted SDK/sidecar side;
 * only the transcription-bound client secret is returned to the webview.
 */
export async function createStreamingAudioTranscriptionSession(
	request: StreamingAudioTranscriptionSessionRequest,
): Promise<StreamingAudioTranscriptionSession> {
	const modelId = request.modelId.trim();
	if (!modelId) {
		throw new Error("A streaming transcription model is required");
	}
	if (request.providerConfig.providerId !== "vercel-ai-gateway") {
		throw new Error(
			`Provider "${request.providerConfig.providerId}" does not support browser streaming transcription`,
		);
	}
	const expiresAfterSeconds = request.expiresAfterSeconds ?? 300;
	if (
		!Number.isInteger(expiresAfterSeconds) ||
		expiresAfterSeconds < 1 ||
		expiresAfterSeconds > 300
	) {
		throw new Error(
			"Streaming transcription session lifetime must be between 1 and 300 seconds",
		);
	}
	const apiKey = resolveApiKey(request.providerConfig);
	if (!apiKey) {
		throw new Error(
			`Provider "${request.providerConfig.providerId}" is missing credentials`,
		);
	}

	const route = resolveAudioTranscriptionRoute(request.providerConfig);
	const mintEndpoint = new URL(
		"/v1/realtime/client-secrets",
		route.baseUrl,
	).toString();
	const headers = new Headers(request.providerConfig.headers);
	if (!headers.has("authorization")) {
		headers.set("authorization", `Bearer ${apiKey}`);
	}
	headers.set(
		"ai-gateway-protocol-version",
		VERCEL_AI_GATEWAY_PROTOCOL_VERSION,
	);
	headers.set("ai-gateway-auth-method", "api-key");
	headers.set("content-type", "application/json");

	const fetchImpl = request.providerConfig.fetch ?? fetch;
	const response = await fetchImpl(mintEndpoint, {
		method: "POST",
		headers,
		body: JSON.stringify({
			model: modelId,
			routeKind: "transcription",
			expiresIn: expiresAfterSeconds,
		}),
		signal: resolveAbortSignal(request.providerConfig, request.abortSignal),
	});
	if (!response.ok) {
		const detail = await readErrorBody(response);
		throw new Error(
			`Vercel AI Gateway streaming transcription setup failed (${response.status})${detail ? `: ${detail}` : ""}`,
		);
	}

	const result = (await response.json()) as {
		token?: unknown;
		expiresAt?: unknown;
	};
	if (typeof result.token !== "string" || !result.token.trim()) {
		throw new Error(
			"Vercel AI Gateway streaming transcription setup returned no token",
		);
	}
	const url = new URL(route.endpoint);
	url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
	url.searchParams.set("ai-model-id", modelId);
	return {
		token: result.token,
		url: url.toString(),
		expiresAt:
			typeof result.expiresAt === "number" ? result.expiresAt : undefined,
	};
}

async function transcribeElevenLabsAudio(
	request: AudioTranscriptionRequest,
	apiKey: string,
): Promise<AudioTranscriptionResult> {
	const route = resolveAudioTranscriptionRoute(request.providerConfig);
	const headers = new Headers(request.providerConfig.headers);
	headers.delete("content-type");
	headers.set("xi-api-key", apiKey);

	const mediaType =
		request.mediaType?.split(";", 1)[0]?.trim().toLowerCase() || "audio/webm";
	const formData = new FormData();
	formData.append("model_id", request.modelId.trim());
	formData.append(
		"file",
		new Blob([new Uint8Array(request.audio).buffer], { type: mediaType }),
		`audio.${resolveAudioFileExtension(mediaType)}`,
	);

	const fetchImpl = request.providerConfig.fetch ?? fetch;
	const response = await fetchImpl(route.endpoint, {
		method: "POST",
		headers,
		body: formData,
		signal: resolveAbortSignal(request.providerConfig, request.abortSignal),
	});
	if (!response.ok) {
		const detail = await readErrorBody(response);
		throw new Error(
			`ElevenLabs transcription failed (${response.status})${detail ? `: ${detail}` : ""}`,
		);
	}

	const result = (await response.json()) as {
		text?: unknown;
		language_code?: unknown;
	};
	if (typeof result.text !== "string" || !result.text.trim()) {
		throw new Error("ElevenLabs transcription returned no text");
	}
	return {
		text: result.text,
		language:
			typeof result.language_code === "string"
				? result.language_code
				: undefined,
	};
}

/**
 * Transcribe recorded audio through the selected provider's transcription
 * endpoint. Provider credentials and endpoints come from the same
 * ProviderConfig used by the rest of the SDK.
 */
export async function transcribeAudio(
	request: AudioTranscriptionRequest,
): Promise<AudioTranscriptionResult> {
	const modelId = request.modelId.trim();
	if (!modelId) {
		throw new Error("A transcription model is required");
	}
	if (request.audio.byteLength === 0) {
		throw new Error("Recorded audio is empty");
	}

	const apiKey = resolveApiKey(request.providerConfig);
	if (!apiKey) {
		throw new Error(
			`Provider "${request.providerConfig.providerId}" is missing credentials`,
		);
	}

	if (request.providerConfig.providerId === "elevenlabs") {
		return transcribeElevenLabsAudio(request, apiKey);
	}

	if (request.providerConfig.providerId === "vercel-ai-gateway") {
		return transcribeVercelAIGatewayAudio(request, apiKey);
	}

	const route = resolveAudioTranscriptionRoute(request.providerConfig);
	const provider = createOpenAI({
		apiKey,
		baseURL: route.baseUrl,
		fetch: request.providerConfig.fetch,
		headers: request.providerConfig.headers,
	});
	const result = await transcribe({
		model: provider.transcription(modelId),
		audio: request.audio,
		abortSignal: resolveAbortSignal(
			request.providerConfig,
			request.abortSignal,
		),
		maxRetries: request.maxRetries,
	});

	return {
		text: result.text,
		language: result.language,
		durationInSeconds: result.durationInSeconds,
	};
}
