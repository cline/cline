import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import common_en from "./locales/en/common.json"
import common_zhCN from "./locales/zh-CN/common.json"

const resources = {
	en: {
		common: common_en,
	},
	"zh-CN": {
		common: common_zhCN,
	},
}

// 初始化时使用默认语言，实际语言将在ExtensionStateContext中设置
// 这样可以确保语言设置始终来自后端状态而不是localStorage
i18n.use(initReactI18next).init({
	resources,
	lng: "en", // 默认使用英语，实际语言由ExtensionStateContext设置
	fallbackLng: "en",
	interpolation: {
		escapeValue: false, // react already safes from xss
	},
	ns: ["common"],
	defaultNS: "common",
})

export default i18n
