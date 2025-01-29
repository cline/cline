export type LanguageKey =
	| "en"
	| "ar"
	| "pt-BR"
	| "cs"
	| "fr"
	| "de"
	| "hi"
	| "hu"
	| "it"
	| "ja"
	| "ko"
	| "pl"
	| "pt-PT"
	| "ru"
	| "zh-CN"
	| "es"
	| "zh-TW"
	| "tr"

export const languageOptions: { key: LanguageKey; display: string }[] = [
	{ key: "en", display: "English" },
	{ key: "ar", display: "Arabic - العربية" },
	{ key: "pt-BR", display: "Portuguese - Português (Brasil)" },
	{ key: "cs", display: "Czech - Čeština" },
	{ key: "fr", display: "French - Français" },
	{ key: "de", display: "German - Deutsch" },
	{ key: "hi", display: "Hindi - हिन्दी" },
	{ key: "hu", display: "Hungarian - Magyar" },
	{ key: "it", display: "Italian - Italiano" },
	{ key: "ja", display: "Japanese - 日本語" },
	{ key: "ko", display: "Korean - 한국어" },
	{ key: "pl", display: "Polish - Polski" },
	{ key: "pt-PT", display: "Portuguese - Português (Portugal)" },
	{ key: "ru", display: "Russian - Русский" },
	{ key: "zh-CN", display: "Simplified Chinese - 简体中文" },
	{ key: "es", display: "Spanish - Español" },
	{ key: "zh-TW", display: "Traditional Chinese - 繁體中文" },
	{ key: "tr", display: "Turkish - Türkçe" },
]

export const DEFAULT_LANGUAGE_SETTINGS: LanguageKey = "en"
