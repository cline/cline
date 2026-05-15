import type { ProviderListing } from "@shared/proto/cline/models"
import type { GenericProviderSettingsProps } from "./GenericProviderSettings"

type GenericProviderSettingsConfig = Omit<GenericProviderSettingsProps, "currentMode" | "isPopup" | "showModelOptions">

type GenericProviderPresentationOverride = Pick<GenericProviderSettingsConfig, "signupUrl" | "baseUrlField">

const CUSTOM_PROVIDER_SETTINGS_IDS = new Set([
	"aihubmix",
	"anthropic",
	"asksage",
	"bedrock",
	"claude-code",
	"cline",
	"dify",
	"doubao",
	"hicap",
	"huawei-cloud-maas",
	"litellm",
	"lmstudio",
	"minimax",
	"mistral",
	"moonshot",
	"nousResearch",
	"oca",
	"ollama",
	"openai",
	"openai-codex",
	"openai-native",
	"openrouter",
	"qwen",
	"qwen-code",
	"requesty",
	"sapaicore",
	"together",
	"vertex",
	"vscode-lm",
	"wandb",
	"xai",
	"zai",
])

const GENERIC_PROVIDER_PRESENTATION_OVERRIDES: Record<string, GenericProviderPresentationOverride> = {
	baseten: {
		signupUrl: "https://app.baseten.co/settings/api_keys",
	},
	deepseek: {
		signupUrl: "https://www.deepseek.com/",
	},
	fireworks: {
		signupUrl: "https://fireworks.ai/",
	},
	groq: {
		signupUrl: "https://console.groq.com/keys",
	},
	cerebras: {
		signupUrl: "https://cloud.cerebras.ai/",
	},
	gemini: {
		baseUrlField: {
			label: "Use custom base URL",
			placeholder: "Default: https://generativelanguage.googleapis.com",
		},
		signupUrl: "https://aistudio.google.com/apikey",
	},
	huggingface: {
		signupUrl: "https://huggingface.co/settings/tokens",
	},
	nebius: {
		signupUrl: "https://studio.nebius.com/settings/api-keys",
	},
	sambanova: {
		signupUrl: "https://docs.sambanova.ai/cloud/docs/get-started/overview",
	},
	"vercel-ai-gateway": {
		signupUrl: "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai",
	},
}

const GENERIC_PROVIDER_PROTOCOLS = new Set(["anthropic", "gemini", "openai-chat", "openai-responses"])

export function hasCustomProviderSettings(providerId: string): boolean {
	return CUSTOM_PROVIDER_SETTINGS_IDS.has(providerId)
}

export function isGenericProviderListing(listing: ProviderListing | undefined): listing is ProviderListing {
	if (!listing) {
		return false
	}

	return (
		!hasCustomProviderSettings(listing.id) && Boolean(listing.name) && GENERIC_PROVIDER_PROTOCOLS.has(listing.protocol ?? "")
	)
}

export function getGenericProviderSettings(
	providerId: string,
	listing?: ProviderListing,
): GenericProviderSettingsConfig | undefined {
	if (!isGenericProviderListing(listing) || listing.id !== providerId) {
		return undefined
	}

	return {
		...GENERIC_PROVIDER_PRESENTATION_OVERRIDES[providerId],
		allowsCustomIds: listing.allowsCustomModelIds,
		providerId: listing.id,
		providerName: listing.name,
	}
}

export function getFallbackGenericProviderSettings(providerId: "deepseek" | "gemini"): GenericProviderSettingsConfig {
	return {
		...GENERIC_PROVIDER_PRESENTATION_OVERRIDES[providerId],
		allowsCustomIds: false,
		providerId,
		providerName: providerId === "deepseek" ? "DeepSeek" : "Gemini",
	}
}
