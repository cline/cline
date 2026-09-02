import { languageOptions } from "@shared/Languages"
import React from "react"
import { useTranslation } from "react-i18next"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { updateSetting } from "./utils/settingsHandlers"

const PreferredLanguageSetting: React.FC = () => {
	const { preferredLanguage } = useExtensionState()
	const { t } = useTranslation("settings")

	return (
		<div>
			<label className="block mb-1 text-base font-medium" htmlFor="preferred-language-dropdown">
				{t("preferredLanguage.label")}
			</label>
			<Select
				onValueChange={(newLanguage) => updateSetting("preferredLanguage", newLanguage)}
				value={preferredLanguage || "English"}>
				<SelectTrigger className="w-full" id="preferred-language-dropdown">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{languageOptions.map(({ key, display }) => (
						<SelectItem key={key} value={display}>
							{display}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<p className="text-sm text-description mt-1">{t("preferredLanguage.description")}</p>
		</div>
	)
}

export default React.memo(PreferredLanguageSetting)
