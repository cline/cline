import i18n from "i18next"
import { initReactI18next } from "react-i18next"

import translationEN from "./locales/en/translation.json"
import translationES from "./locales/es/translation.json"
import translationDE from "./locales/de/translation.json"
import translationZHCN from "./locales/zh-cn/translation.json"
import translationZHTW from "./locales/zh-tw/translation.json"
import translationJA from "./locales/ja/translation.json"

i18n.use(initReactI18next) // passes i18n down to react-i18next
	.init({
		fallbackLng: "en",
		debug: true,
		react: {
			bindI18n: "languageChanged",
			transSupportBasicHtmlNodes: true,
			transKeepBasicHtmlNodesFor: ["b", "i", "strong", "em", "br"],
		},
	})

i18n.addResourceBundle("en", "translation", translationEN)
i18n.addResourceBundle("es", "translation", translationES)
i18n.addResourceBundle("de", "translation", translationDE)
i18n.addResourceBundle("zh-CN", "translation", translationZHCN)
i18n.addResourceBundle("zh-TW", "translation", translationZHTW)
i18n.addResourceBundle("ja", "translation", translationJA)

export default i18n
