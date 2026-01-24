import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import en from "./locales/en.json"
import { errorMessages } from "./locales/errors"
import ko from "./locales/ko.json"

const mergeErrors = (base: Record<string, unknown>, lang: keyof typeof errorMessages) => ({
	...base,
	errors: {
		...(base.errors as Record<string, unknown> | undefined),
		...errorMessages[lang],
	},
})

i18n.use(initReactI18next).init({
	resources: {
		en: { translation: mergeErrors(en, "en") },
		ko: { translation: mergeErrors(ko, "ko") },
	},
	lng: "ko",
	fallbackLng: "en",
	interpolation: {
		escapeValue: false,
	},
})

export default i18n
