import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { memo } from "react"
import { useTranslation } from "react-i18next"
import { useExtensionState } from "../../context/ExtensionStateContext"

const LanguageOptions = () => {
	const { setCustomInstructions } = useExtensionState()
	const { t, i18n } = useTranslation("translation")

	const changeLanguage = (e: any) => {
		const language = e.target.value
		i18n.changeLanguage(language)
		setCustomInstructions(t("appRoot.customInstructions"))
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
			<div className="dropdown-container">
				<label htmlFor="language-dropdown">
					<span style={{ fontWeight: 500 }}>{t("settingsView.language")}</span>
				</label>
				<VSCodeDropdown
					id="language-dropdown"
					value={i18n.resolvedLanguage}
					style={{ width: "100%" }}
					onChange={changeLanguage}>
					<VSCodeOption value="en">English</VSCodeOption>
					<VSCodeOption value="es">Español</VSCodeOption>
					<VSCodeOption value="de">Deutsch</VSCodeOption>
					<VSCodeOption value="zh-CN">中文(简体)</VSCodeOption>
					<VSCodeOption value="zh-TW">中文(繁體)</VSCodeOption>
					<VSCodeOption value="ja">日本語</VSCodeOption>
				</VSCodeDropdown>
			</div>
		</div>
	)
}

export default memo(LanguageOptions)
