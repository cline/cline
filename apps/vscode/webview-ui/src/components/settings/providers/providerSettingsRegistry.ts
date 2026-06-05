import type { ProviderListing } from "@shared/proto/cline/models"
import type { GenericProviderSettingsProps } from "./GenericProviderSettings"

type GenericProviderSettingsConfig = Omit<GenericProviderSettingsProps, "currentMode" | "isPopup" | "showModelOptions">

type GenericProviderPresentationOverride = Pick<GenericProviderSettingsConfig, "signupUrl" | "baseUrlField"> &
	Partial<Pick<GenericProviderSettingsConfig, "allowsCustomIds">>

const CUSTOM_PROVIDER_SETTINGS_IDS = new Set([
	"aihubmix",
	"anthropic",
	"asksage",
	"bedrock",
	"claude-code",
	"cline",
	"dify",
	"hicap",
	"litellm",
	"lmstudio",
	"moonshot",
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
	"vertex",
	"vscode-lm",
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
	doubao: {
		signupUrl: "https://console.volcengine.com/home",
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
		signupUrl: "https://aistudio.google.com/apikey",
	},
	huggingface: {
		signupUrl: "https://huggingface.co/settings/tokens",
	},
	"huawei-cloud-maas": {
		signupUrl: "https://support.huaweicloud.com/intl/zh-cn/usermanual-maas/maas_01_0001.html",
	},
	minimax: {
		signupUrl: "https://www.minimax.io/platform/user-center/basic-information/interface-key",
		baseUrlField: {
			label: "Base URL",
			placeholder: "https://api.minimax.io/anthropic",
		},
	},
	mistral: {
		signupUrl: "https://console.mistral.ai/codestral",
	},
	nebius: {
		signupUrl: "https://auth.tokenfactory.nebius.com/ui/login",
	},
	nousResearch: {},
	sambanova: {
		signupUrl: "https://docs.sambanova.ai/cloud/docs/get-started/overview",
	},
	together: {
		allowsCustomIds: true,
		signupUrl: "https://api.together.ai/settings/api-keys",
		baseUrlField: {
			label: "Base URL",
			placeholder: "https://api.together.xyz/v1",
		},
	},
	"vercel-ai-gateway": {
		signupUrl: "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai",
	},
	wandb: {
		signupUrl: "https://wandb.ai",
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

	const overrides = GENERIC_PROVIDER_PRESENTATION_OVERRIDES[providerId]

	return {
		...overrides,
		allowsCustomIds: overrides?.allowsCustomIds ?? listing.allowsCustomModelIds,
		providerId: listing.id,
		providerName: listing.name,
	}
}

const FALLBACK_GENERIC_PROVIDER_NAMES = {
	deepseek: "DeepSeek",
	doubao: "Doubao",
	gemini: "Gemini",
	"huawei-cloud-maas": "Huawei Cloud MaaS",
	minimax: "MiniMax",
	mistral: "Mistral",
	nousResearch: "NousResearch",
	together: "Together",
	wandb: "W&B",
} as const

export function getFallbackGenericProviderSettings(providerId: string): GenericProviderSettingsConfig | undefined {
	const providerName = FALLBACK_GENERIC_PROVIDER_NAMES[providerId as keyof typeof FALLBACK_GENERIC_PROVIDER_NAMES]
	if (!providerName) {
		return undefined
	}

	const overrides = GENERIC_PROVIDER_PRESENTATION_OVERRIDES[providerId]

	return {
		...overrides,
		allowsCustomIds: overrides?.allowsCustomIds ?? false,
		providerId,
		providerName,
	}
}
