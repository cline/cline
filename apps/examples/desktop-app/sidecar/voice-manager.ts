import { createGateway } from "@ai-sdk/gateway";
import { createOpenAI } from "@ai-sdk/openai";
import { ProviderSettingsManager } from "@cline/core";
import { resolveAudioTranscriptionRoute } from "@cline/llms";
import type { Experimental_RealtimeSessionConfig } from "ai";

const VOICE_MANAGER_MODELS = {
	"openai-native": "gpt-realtime",
	"vercel-ai-gateway": "spacexai/grok-voice-3.0",
} as const;

export type VoiceManagerTransport = keyof typeof VOICE_MANAGER_MODELS;

export type VoiceManagerModel = {
	transport: VoiceManagerTransport;
	modelId: string;
};

function isVoiceManagerTransport(
	id: string | undefined,
): id is VoiceManagerTransport {
	return Boolean(id && id in VOICE_MANAGER_MODELS);
}

function resolveVoiceManagerProvider(manager: ProviderSettingsManager) {
	const candidates = [
		manager.getVoiceInputSettings()?.providerId,
		"openai-native",
		"vercel-ai-gateway",
	].filter(isVoiceManagerTransport);
	for (const id of candidates) {
		const config = manager.getProviderConfig(id, { includeKnownModels: false });
		const apiKey = config?.apiKey?.trim() || config?.accessToken?.trim();
		if (config && apiKey) return { id, config, apiKey };
	}
	throw new Error(
		"Talking to Cline needs an OpenAI or Vercel AI Gateway API key. Add one in Settings → Providers.",
	);
}

export function getVoiceManagerModel(): VoiceManagerModel {
	const { id } = resolveVoiceManagerProvider(new ProviderSettingsManager());
	return { transport: id, modelId: VOICE_MANAGER_MODELS[id] };
}

/** Mints a short-lived realtime client secret so the provider key stays in the sidecar. */
export async function createVoiceManagerToken(
	sessionConfig: Experimental_RealtimeSessionConfig | undefined,
) {
	const { id, config, apiKey } = resolveVoiceManagerProvider(
		new ProviderSettingsManager(),
	);
	const { baseUrl } = resolveAudioTranscriptionRoute(config);
	const realtime =
		id === "openai-native"
			? createOpenAI({ apiKey, baseURL: baseUrl }).experimental_realtime
			: createGateway({ apiKey, baseURL: baseUrl }).experimental_realtime;
	return await realtime.getToken({
		model: VOICE_MANAGER_MODELS[id],
		sessionConfig,
	});
}
