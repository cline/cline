import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import React, { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { updateSetting } from "./utils/settingsHandlers"

const UILanguageSetting: React.FC = () => {
	const { i18n } = useTranslation()
	const { uiLanguage } = useExtensionState()
	const [currentLanguage, setCurrentLanguage] = useState<string>("en")

	const handleLanguageChange = (newLanguage: string) => {
		i18n.changeLanguage(newLanguage)
		setCurrentLanguage(newLanguage)
		// 使用独立的字段保存界面语言设置
		updateSetting("uiLanguage", newLanguage)
		// 同时更新localStorage确保一致性
		localStorage.setItem("i18nextLng", newLanguage)
	}

	// Set language from extension state
	useEffect(() => {
		let languageCode = "en"
		if (uiLanguage && ["en", "zh-CN"].includes(uiLanguage)) {
			languageCode = uiLanguage
		} else {
			// 如果没有设置，则使用当前i18n语言或默认英语
			languageCode = i18n.language && ["en", "zh-CN"].includes(i18n.language) ? i18n.language : "en"
		}

		setCurrentLanguage(languageCode)
		// Only change language if it's different to avoid unnecessary re-renders
		if (i18n.language !== languageCode) {
			i18n.changeLanguage(languageCode)
		}
	}, [uiLanguage, i18n])

	return (
		<div style={{}}>
			<label className="block mb-1 text-base font-medium" htmlFor="ui-language-dropdown">
				Interface Language
			</label>
			<VSCodeDropdown
				id="ui-language-dropdown"
				onChange={(e: any) => {
					handleLanguageChange(e.target.value)
				}}
				style={{ width: "100%" }}
				value={currentLanguage}>
				<VSCodeOption value="en">English</VSCodeOption>
				<VSCodeOption value="zh-CN">简体中文</VSCodeOption>
			</VSCodeDropdown>
			<p className="text-sm text-description mt-1">Select the language for the user interface.</p>
		</div>
	)
}

export default UILanguageSetting
