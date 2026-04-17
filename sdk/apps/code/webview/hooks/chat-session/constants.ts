import type { ChatSessionConfig } from "@/lib/chat-schema";
import { readModelSelectionStorageFromWindow } from "@/lib/model-selection";
import { normalizeProviderId } from "@/lib/provider-id";

export const CHAT_TRANSPORT_UNAVAILABLE_MESSAGE =
	"Chat connection is unavailable. Reopen the app window to restore realtime chat.";
export const CHAT_WS_ENDPOINT_RETRY_ATTEMPTS = 60;
export const CHAT_WS_ENDPOINT_RETRY_DELAY_MS = 100;
export const CHAT_WS_RECONNECT_BASE_DELAY_MS = 300;
export const CHAT_WS_RECONNECT_MAX_DELAY_MS = 3000;
export const CHAT_WS_REQUEST_TIMEOUT_MS = 120000;
export const OAUTH_MANAGED_PROVIDERS = new Set([
	"cline",
	"oca",
	"openai-codex",
]);

// Default Cline model — keep in sync with @clinebot/llms CLINE_DEFAULT_MODEL
const CLINE_DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";

export const DEFAULT_CHAT_CONFIG: ChatSessionConfig = {
	workspaceRoot: "",
	cwd: "",
	provider: "cline",
	model: CLINE_DEFAULT_MODEL,
	apiKey: process.env.CLINE_API_KEY || "",
	mode: "act",
	systemPrompt: undefined,
	maxIterations: undefined,
	enableTools: true,
	enableSpawn: true,
	enableTeams: true,
	autoApproveTools: true,
	teamName: "app-team",
	missionStepInterval: 3,
	missionTimeIntervalMs: 120000,
};

export function getInitialChatConfig(): ChatSessionConfig {
	const selection = readModelSelectionStorageFromWindow();
	const rememberedProvider = normalizeProviderId(selection.lastProvider);
	const rememberedModelForProvider = rememberedProvider
		? (selection.lastModelByProvider[rememberedProvider] ??
			selection.lastModelByProvider[selection.lastProvider.trim()])
		: undefined;
	const rememberedModelForDefaultProvider =
		selection.lastModelByProvider[DEFAULT_CHAT_CONFIG.provider];
	const provider = rememberedProvider || DEFAULT_CHAT_CONFIG.provider;
	const model =
		rememberedModelForProvider ||
		(provider === DEFAULT_CHAT_CONFIG.provider
			? rememberedModelForDefaultProvider
			: undefined) ||
		DEFAULT_CHAT_CONFIG.model;

	return {
		...DEFAULT_CHAT_CONFIG,
		provider,
		model,
	};
}
