import { AUTO_LOCALE, LOCALE_DISPLAY_NAMES, SUPPORTED_LOCALES } from "@cline/i18n"
import React from "react"
import { useTranslation } from "react-i18next"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { updateSetting } from "./utils/settingsHandlers"

const UiLanguageSetting: React.FC = () => {
	const { uiLanguage } = useExtensionState()
	const { t } = useTranslation("settings")

	return (
		<div>
			<label className="block mb-1 text-base font-medium" htmlFor="ui-language-dropdown">
				{t("uiLanguage.label")}
			</label>
			<Select onValueChange={(newLanguage) => updateSetting("uiLanguage", newLanguage)} value={uiLanguage || AUTO_LOCALE}>
				<SelectTrigger className="w-full" id="ui-language-dropdown">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value={AUTO_LOCALE}>{t("uiLanguage.auto")}</SelectItem>
					{SUPPORTED_LOCALES.map((locale) => (
						<SelectItem key={locale} value={locale}>
							{LOCALE_DISPLAY_NAMES[locale]}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<p className="text-sm text-description mt-1">{t("uiLanguage.description")}</p>
		</div>
	)
}

export default React.memo(UiLanguageSetting)
