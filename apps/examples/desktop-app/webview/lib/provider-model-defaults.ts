import {
	ANTHROPIC_DEFAULT_MODEL_ID,
	CLINE_DEFAULT_MODEL_ID,
} from "@cline/shared/browser";

/** Model discovery fallbacks shared by chat and independent schedule drafts. */
export const FALLBACK_PROVIDER_MODELS: Record<string, string[]> = {
	cline: [CLINE_DEFAULT_MODEL_ID],
	// Anthropic's API expects bare model IDs rather than gateway-prefixed IDs.
	anthropic: [ANTHROPIC_DEFAULT_MODEL_ID],
	"openai-native": ["gpt-5.5"],
	openrouter: [CLINE_DEFAULT_MODEL_ID],
	gemini: ["gemini-3-pro-latest"],
};
