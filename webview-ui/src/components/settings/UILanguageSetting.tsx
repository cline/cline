import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import React, { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useExtensionState } from "@/context/ExtensionStateContext"
import i18n from "@/i18n/i18n"
import { updateSetting } from "./utils/settingsHandlers"

// 获取支持的语言列表
const SUPPORTED_LANGUAGES = Object.keys(i18n.options.resources || {})
const LANGUAGE_OPTIONS: Record<string, string> = {
	en: "English",
	"zh-CN": "Simplified Chinese - 简体中文",
	// 可以在这里添加更多语言选项
}

const UILanguageSetting: React.FC = () => {
	const { i18n: i18nInstance } = useTranslation()
	const { uiLanguage } = useExtensionState()
	const [currentLanguage, setCurrentLanguage] = useState<string>("en")
	const { t } = useTranslation("common")

	const handleLanguageChange = (newLanguage: string) => {
		i18nInstance.changeLanguage(newLanguage)
		setCurrentLanguage(newLanguage)
		// 使用独立的字段保存界面语言设置
		updateSetting("uiLanguage", newLanguage)
		// 同时更新localStorage确保一致性
		localStorage.setItem("i18nextLng", newLanguage)
	}

	// Set language from extension state
	useEffect(() => {
		let languageCode = "en"
		if (uiLanguage && SUPPORTED_LANGUAGES.includes(uiLanguage)) {
			languageCode = uiLanguage
		} else {
			// 如果没有设置，则使用当前i18n语言或默认英语
			languageCode =
				i18nInstance.language && SUPPORTED_LANGUAGES.includes(i18nInstance.language) ? i18nInstance.language : "en"
		}

		setCurrentLanguage(languageCode)
		// Only change language if it's different to avoid unnecessary re-renders
		if (i18nInstance.language !== languageCode) {
			i18nInstance.changeLanguage(languageCode)
		}
	}, [uiLanguage, i18nInstance])

	return (
		<div style={{}}>
			<label className="block mb-1 text-base font-medium" htmlFor="ui-language-dropdown">
				{t("settings.general.ui_language")}
			</label>
			<VSCodeDropdown
				id="ui-language-dropdown"
				onChange={(e: any) => {
					handleLanguageChange(e.target.value)
				}}
				style={{ width: "100%" }}
				value={currentLanguage}>
				{SUPPORTED_LANGUAGES.map((lang) => (
					<VSCodeOption key={lang} value={lang}>
						{LANGUAGE_OPTIONS[lang] || lang}
					</VSCodeOption>
				))}
			</VSCodeDropdown>
			<p className="text-sm text-description mt-1">{t("settings.general.ui_language_description")}</p>
		</div>
	)
}

export default UILanguageSetting
