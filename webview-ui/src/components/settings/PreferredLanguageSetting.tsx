import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import React from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { updateSetting } from "./utils/settingsHandlers"
import { convertChatSettingsToProtoChatSettings } from "@shared/proto-conversions/state/chat-settings-conversion"

const PreferredLanguageSetting: React.FC = () => {
	const { chatSettings } = useExtensionState()

	const handleLanguageChange = (newLanguage: string) => {
		if (!chatSettings) return

		const updatedChatSettings = {
			...chatSettings,
			preferredLanguage: newLanguage,
		}

		const protoChatSettings = convertChatSettingsToProtoChatSettings(updatedChatSettings)
		updateSetting("chatSettings", protoChatSettings)
	}

	return (
		<div style={{}}>
			<label htmlFor="preferred-language-dropdown" className="block mb-1 text-sm font-medium">
				Preferred Language
			</label>
			<VSCodeDropdown
				id="preferred-language-dropdown"
				currentValue={chatSettings.preferredLanguage || "English"}
				onChange={(e: any) => {
					handleLanguageChange(e.target.value)
				}}
				style={{ width: "100%" }}>
				<VSCodeOption value="English">English</VSCodeOption>
				<VSCodeOption value="Arabic - العربية">Arabic - العربية</VSCodeOption>
				<VSCodeOption value="Portuguese - Português (Brasil)">Portuguese - Português (Brasil)</VSCodeOption>
				<VSCodeOption value="Czech - Čeština">Czech - Čeština</VSCodeOption>
				<VSCodeOption value="French - Français">French - Français</VSCodeOption>
				<VSCodeOption value="German - Deutsch">German - Deutsch</VSCodeOption>
				<VSCodeOption value="Hindi - हिन्दी">Hindi - हिन्दी</VSCodeOption>
				<VSCodeOption value="Hungarian - Magyar">Hungarian - Magyar</VSCodeOption>
				<VSCodeOption value="Italian - Italiano">Italian - Italiano</VSCodeOption>
				<VSCodeOption value="Japanese - 日本語">Japanese - 日本語</VSCodeOption>
				<VSCodeOption value="Korean - 한국어">Korean - 한국어</VSCodeOption>
				<VSCodeOption value="Polish - Polski">Polish - Polski</VSCodeOption>
				<VSCodeOption value="Portuguese - Português (Portugal)">Portuguese - Português (Portugal)</VSCodeOption>
				<VSCodeOption value="Russian - Русский">Russian - Русский</VSCodeOption>
				<VSCodeOption value="Simplified Chinese - 简体中文">Simplified Chinese - 简体中文</VSCodeOption>
				<VSCodeOption value="Spanish - Español">Spanish - Español</VSCodeOption>
				<VSCodeOption value="Traditional Chinese - 繁體中文">Traditional Chinese - 繁體中文</VSCodeOption>
				<VSCodeOption value="Turkish - Türkçe">Turkish - Türkçe</VSCodeOption>
			</VSCodeDropdown>
			<p className="text-xs text-[var(--vscode-descriptionForeground)] mt-1">
				The language that Cline should use for communication.
			</p>
		</div>
	)
}

export default React.memo(PreferredLanguageSetting)
