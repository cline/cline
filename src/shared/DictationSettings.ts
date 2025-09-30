export interface DictationSettings {
	featureEnabled: boolean // Feature flag - whether dictation feature is available
	dictationEnabled: boolean // User preference - whether user has enabled dictation
	dictationLanguage: string
}

export const DEFAULT_DICTATION_SETTINGS: DictationSettings = {
	featureEnabled: false, // Feature flag, will be set by the extension based on platform
	dictationEnabled: false, // Default is false while this service is in Experimental status
	dictationLanguage: "en",
}

export interface LanguageItem {
	name: string
	code: string
}

export const SUPPORTED_DICTATION_LANGUAGES: LanguageItem[] = [
	{ name: "English", code: "en" },
	{ name: "Spanish (Español)", code: "es" },
	{ name: "Chinese (中文)", code: "zh" },
	{ name: "Japanese (日本語)", code: "ja" },
	{ name: "Afrikaans", code: "af" },
	{ name: "Arabic (العربية)", code: "ar" },
	{ name: "Armenian (Հայերեն)", code: "hy" },
	{ name: "Azerbaijani (Azərbaycan)", code: "az" },
	{ name: "Belarusian (Беларуская)", code: "be" },
	{ name: "Bosnian (Bosanski)", code: "bs" },
	{ name: "Bulgarian (Български)", code: "bg" },
	{ name: "Catalan (Català)", code: "ca" },
	{ name: "Croatian (Hrvatski)", code: "hr" },
	{ name: "Czech (Čeština)", code: "cs" },
	{ name: "Danish (Dansk)", code: "da" },
	{ name: "Dutch (Nederlands)", code: "nl" },
	{ name: "Estonian (Eesti)", code: "et" },
	{ name: "Finnish (Suomi)", code: "fi" },
	{ name: "French (Français)", code: "fr" },
	{ name: "Galician (Galego)", code: "gl" },
	{ name: "German (Deutsch)", code: "de" },
	{ name: "Greek (Ελληνικά)", code: "el" },
	{ name: "Hebrew (עברית)", code: "he" },
	{ name: "Hindi (हिन्दी)", code: "hi" },
	{ name: "Hungarian (Magyar)", code: "hu" },
	{ name: "Icelandic (Íslenska)", code: "is" },
	{ name: "Indonesian (Bahasa Indonesia)", code: "id" },
	{ name: "Italian (Italiano)", code: "it" },
	{ name: "Kannada (ಕನ್ನಡ)", code: "kn" },
	{ name: "Kazakh (Қазақша)", code: "kk" },
	{ name: "Korean (한국어)", code: "ko" },
	{ name: "Latvian (Latviešu)", code: "lv" },
	{ name: "Lithuanian (Lietuvių)", code: "lt" },
	{ name: "Macedonian (Македонски)", code: "mk" },
	{ name: "Malay (Bahasa Melayu)", code: "ms" },
	{ name: "Marathi (मराठी)", code: "mr" },
	{ name: "Maori (Te Reo Māori)", code: "mi" },
	{ name: "Nepali (नेपाली)", code: "ne" },
	{ name: "Norwegian (Norsk)", code: "no" },
	{ name: "Persian (فارسی)", code: "fa" },
	{ name: "Polish (Polski)", code: "pl" },
	{ name: "Portuguese (Português)", code: "pt" },
	{ name: "Romanian (Română)", code: "ro" },
	{ name: "Russian (Русский)", code: "ru" },
	{ name: "Serbian (Српски)", code: "sr" },
	{ name: "Slovak (Slovenčina)", code: "sk" },
	{ name: "Slovenian (Slovenščina)", code: "sl" },
	{ name: "Swahili (Kiswahili)", code: "sw" },
	{ name: "Swedish (Svenska)", code: "sv" },
	{ name: "Tagalog", code: "tl" },
	{ name: "Tamil (தமிழ்)", code: "ta" },
	{ name: "Thai (ไทย)", code: "th" },
	{ name: "Turkish (Türkçe)", code: "tr" },
	{ name: "Ukrainian (Українська)", code: "uk" },
	{ name: "Urdu (اردو)", code: "ur" },
	{ name: "Vietnamese (Tiếng Việt)", code: "vi" },
	{ name: "Welsh (Cymraeg)", code: "cy" },
]
