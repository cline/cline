import { createGateway } from "@ai-sdk/gateway";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { Experimental_RealtimeSessionConfig } from "ai";
import type { ProviderConfig } from "./providers/config";
import { resolveVercelAiGatewayBaseUrl } from "./providers/url";

const DEFAULT_VERCEL_AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v4/ai";
const DEFAULT_REALTIME_VOICE_INSTRUCTIONS = [
	"You are the speech transport for the Cline coding agent.",
	"Never answer the user or call tools on your own.",
	"User speech is handled by Cline, which owns conversation context, tools, approvals, and persistence.",
	"Only speak when explicitly given a completed Cline response to read aloud.",
	"Read that response faithfully without adding analysis, answers, or claims of your own.",
].join(" ");

export type RealtimeProviderTransport =
	| "vercel-ai-gateway"
	| "google"
	| "openai";

export interface RealtimeVoiceSessionRequest {
	providerConfig: ProviderConfig;
	modelId: string;
	voice?: string;
	expiresAfterSeconds?: number;
}

export interface RealtimeVoiceSession {
	token: string;
	url: string;
	expiresAt?: number;
	transport: RealtimeProviderTransport;
	sessionConfig: Experimental_RealtimeSessionConfig;
}

function resolveApiKey(
	config: Pick<ProviderConfig, "apiKey" | "accessToken">,
): string | undefined {
	return config.apiKey?.trim() || config.accessToken?.trim() || undefined;
}

export function resolveVercelAIGatewayBaseUrl(
	configuredBaseUrl: string | undefined,
): string {
	return resolveVercelAiGatewayBaseUrl(
		configuredBaseUrl,
		DEFAULT_VERCEL_AI_GATEWAY_BASE_URL,
	);
}

export function resolveRealtimeProviderTransport(
	config: Pick<ProviderConfig, "providerId" | "routingProviderId">,
): RealtimeProviderTransport {
	const providerId = config.routingProviderId ?? config.providerId;
	switch (providerId) {
		case "vercel-ai-gateway":
			return "vercel-ai-gateway";
		case "gemini":
			return "google";
		case "openai":
		case "openai-native":
			return "openai";
		default:
			throw new Error(
				`Provider "${config.providerId}" does not have an AI SDK realtime transport`,
			);
	}
}

function createSessionConfig(
	voice: string | undefined,
): Experimental_RealtimeSessionConfig {
	const normalizedVoice = voice?.trim();
	return {
		instructions: DEFAULT_REALTIME_VOICE_INSTRUCTIONS,
		outputModalities: ["audio"],
		inputAudioTranscription: {},
		outputAudioTranscription: {},
		...(normalizedVoice ? { voice: normalizedVoice } : {}),
		turnDetection: {
			type: "server-vad",
			prefixPaddingMs: 300,
			silenceDurationMs: 650,
		},
	};
}

/**
 * Mints a short-lived browser credential for an AI SDK 7 realtime session.
 *
 * Long-lived provider credentials remain on the trusted server/sidecar. The
 * returned token is scoped to the configured model and safe to pass to the
 * browser realtime client.
 */
export async function createRealtimeVoiceSession(
	request: RealtimeVoiceSessionRequest,
): Promise<RealtimeVoiceSession> {
	const modelId = request.modelId.trim();
	if (!modelId) {
		throw new Error("A realtime voice model is required");
	}
	const expiresAfterSeconds = request.expiresAfterSeconds ?? 300;
	if (
		!Number.isInteger(expiresAfterSeconds) ||
		expiresAfterSeconds < 1 ||
		expiresAfterSeconds > 300
	) {
		throw new Error(
			"Realtime voice session lifetime must be between 1 and 300 seconds",
		);
	}
	const apiKey = resolveApiKey(request.providerConfig);
	if (!apiKey) {
		throw new Error(
			`Provider "${request.providerConfig.providerId}" is missing credentials`,
		);
	}

	const sessionConfig = createSessionConfig(request.voice);
	const transport = resolveRealtimeProviderTransport(request.providerConfig);
	const commonOptions = {
		apiKey,
		headers: request.providerConfig.headers,
		fetch: request.providerConfig.fetch,
	};
	const factory =
		transport === "vercel-ai-gateway"
			? createGateway({
					...commonOptions,
					baseURL: resolveVercelAIGatewayBaseUrl(
						request.providerConfig.baseUrl,
					),
				}).experimental_realtime
			: transport === "google"
				? createGoogle({
						...commonOptions,
						baseURL: request.providerConfig.baseUrl,
					}).experimental_realtime
				: createOpenAI({
						...commonOptions,
						baseURL: request.providerConfig.baseUrl,
					}).experimental_realtime;
	const session = await factory.getToken({
		model: modelId,
		expiresAfterSeconds,
		sessionConfig,
	});
	return {
		token: session.token,
		url: session.url,
		...(session.expiresAt === undefined
			? {}
			: { expiresAt: session.expiresAt }),
		transport,
		sessionConfig,
	};
}
