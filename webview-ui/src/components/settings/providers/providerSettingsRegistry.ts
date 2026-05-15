import type { GenericProviderSettingsProps } from "./GenericProviderSettings"

type GenericProviderSettingsConfig = Omit<GenericProviderSettingsProps, "currentMode" | "isPopup" | "showModelOptions">

export const GENERIC_PROVIDER_SETTINGS = {
	deepseek: {
		allowsCustomIds: false,
		apiKeyField: "deepSeekApiKey",
		providerId: "deepseek",
		providerName: "DeepSeek",
		signupUrl: "https://www.deepseek.com/",
	},
	gemini: {
		allowsCustomIds: false,
		apiKeyField: "geminiApiKey",
		baseUrlField: {
			field: "geminiBaseUrl",
			label: "Use custom base URL",
			placeholder: "Default: https://generativelanguage.googleapis.com",
		},
		providerId: "gemini",
		providerName: "Gemini",
		signupUrl: "https://aistudio.google.com/apikey",
	},
} satisfies Record<string, GenericProviderSettingsConfig>

export type GenericProviderSettingsProviderId = keyof typeof GENERIC_PROVIDER_SETTINGS

export function getGenericProviderSettings(providerId: string): GenericProviderSettingsConfig | undefined {
	return GENERIC_PROVIDER_SETTINGS[providerId as GenericProviderSettingsProviderId]
}
