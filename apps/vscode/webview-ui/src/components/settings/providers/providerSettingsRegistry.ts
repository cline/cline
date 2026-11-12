import type { ProviderListing } from "@shared/proto/cline/models"
import type { GenericProviderSettingsProps } from "./GenericProviderSettings"

type GenericProviderSettingsConfig = Omit<GenericProviderSettingsProps, "currentMode" | "isPopup" | "showModelOptions">

type GenericProviderPresentationOverride = Pick<GenericProviderSettingsConfig, "signupUrl" | "baseUrlField"> &
	Partial<Pick<GenericProviderSettingsConfig, "allowsCustomIds">> & {
		fallbackName: string
	}

const CUSTOM_PROVIDER_SETTINGS_IDS = new Set([
	"aihubmix",
	"anthropic",
	"asksage",
	"bedrock",
	"claude-code",
	"cline",
	"cline-pass",
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
		fallbackName: "Baseten",
		signupUrl: "https://app.baseten.co/settings/api_keys",
	},
	deepseek: {
		fallbackName: "DeepSeek",
		signupUrl: "https://platform.deepseek.com/api_keys",
	},
	doubao: {
		fallbackName: "Doubao",
		signupUrl: "https://console.volcengine.com/home",
	},
	fireworks: {
		fallbackName: "Fireworks",
		signupUrl: "https://app.fireworks.ai/settings/users/api-keys",
	},
	groq: {
		fallbackName: "Groq",
		signupUrl: "https://console.groq.com/keys",
	},
	poolside: {
		fallbackName: "Poolside",
	},
	cerebras: {
		fallbackName: "Cerebras",
		signupUrl: "https://cloud.cerebras.ai/",
	},
	gemini: {
		fallbackName: "Gemini",
		signupUrl: "https://aistudio.google.com/apikey",
		baseUrlField: {
			label: "Use custom base URL",
			placeholder: "Default: https://generativelanguage.googleapis.com",
		},
	},
	huggingface: {
		fallbackName: "Hugging Face",
		signupUrl: "https://huggingface.co/settings/tokens",
	},
	"huawei-cloud-maas": {
		fallbackName: "Huawei Cloud MaaS",
		signupUrl: "https://support.huaweicloud.com/intl/zh-cn/usermanual-maas/maas_01_0001.html",
	},
	minimax: {
		fallbackName: "MiniMax",
		signupUrl: "https://www.minimax.io/platform/user-center/basic-information/interface-key",
		baseUrlField: {
			label: "Base URL",
			placeholder: "https://api.minimax.io/anthropic",
		},
	},
	mistral: {
		fallbackName: "Mistral",
		signupUrl: "https://console.mistral.ai/api-keys",
	},
	nebius: {
		fallbackName: "Nebius",
		signupUrl: "https://auth.tokenfactory.nebius.com/ui/login",
	},
	nousResearch: {
		fallbackName: "NousResearch",
	},
	sambanova: {
		fallbackName: "SambaNova",
		signupUrl: "https://docs.sambanova.ai/cloud/docs/get-started/overview",
	},
	together: {
		allowsCustomIds: true,
		fallbackName: "Together",
		signupUrl: "https://api.together.ai/settings/api-keys",
		baseUrlField: {
			label: "Base URL",
			placeholder: "https://api.together.xyz/v1",
		},
	},
	"vercel-ai-gateway": {
		fallbackName: "Vercel AI Gateway",
		signupUrl: "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai",
	},
	v0: {
		fallbackName: "Vercel v0",
	},
	wandb: {
		fallbackName: "CoreWeave",
		signupUrl: "https://wandb.ai/settings",
	},
	xiaomi: {
		fallbackName: "Xiaomi",
	},
	"tencent-tokenhub": {
		fallbackName: "Tencent TokenHub",
		signupUrl: "https://cloud.tencent.com/document/product/1823/130050",
	},
	chutes: {
		fallbackName: "Chutes",
		signupUrl: "https://chutes.ai/app/api",
	},
	aiand: {
		fallbackName: "ai&",
		signupUrl: "https://console.aiand.com/",
	},
	"zai-coding-plan": {
		fallbackName: "Z.AI Coding Plan",
	},
}

const GENERIC_PROVIDER_PROTOCOLS = new Set(["anthropic", "gemini", "openai-chat", "openai-responses"])

export function hasCustomProviderSettings(providerId: string): boolean {
	return CUSTOM_PROVIDER_SETTINGS_IDS.has(providerId)
}

/**
 * True when we ship a curated "generic" settings form for this provider id.
 * Providers that are neither here nor in {@link hasCustomProviderSettings} are
 * user-configured/custom and should use the richer OpenAI-compatible form
 * instead.
 */
export function isKnownGenericProvider(providerId: string): boolean {
	return providerId in GENERIC_PROVIDER_PRESENTATION_OVERRIDES
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

	const entry = GENERIC_PROVIDER_PRESENTATION_OVERRIDES[providerId]
	if (!entry) {
		return {
			allowsCustomIds: listing.allowsCustomModelIds,
			providerId: listing.id,
			providerName: listing.name,
		}
	}

	const { fallbackName: _fallbackName, ...overrides } = entry

	return {
		...overrides,
		allowsCustomIds: overrides.allowsCustomIds ?? listing.allowsCustomModelIds,
		providerId: listing.id,
		providerName: listing.name,
	}
}

export function getFallbackGenericProviderSettings(providerId: string): GenericProviderSettingsConfig | undefined {
	const entry = GENERIC_PROVIDER_PRESENTATION_OVERRIDES[providerId]
	if (!entry) {
		return undefined
	}

	const { fallbackName, ...overrides } = entry

	return {
		...overrides,
		allowsCustomIds: overrides.allowsCustomIds ?? false,
		providerId,
		providerName: fallbackName,
	}
}
