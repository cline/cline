import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { Monitor } from "lucide-react"

import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"

type InterfaceSettingsProps = HTMLAttributes<HTMLDivElement> & {
	showGreeting?: boolean
	setCachedStateField: SetCachedStateField<"showGreeting">
}

export const InterfaceSettings = ({ showGreeting, setCachedStateField, ...props }: InterfaceSettingsProps) => {
	const { t } = useAppTranslation()
	return (
		<div {...props}>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<Monitor className="w-4" />
					<div>{t("settings:sections.interface")}</div>
				</div>
			</SectionHeader>

			<Section>
				<div>
					<VSCodeCheckbox
						checked={showGreeting}
						onChange={(e: any) => setCachedStateField("showGreeting", e.target.checked)}>
						<span className="font-medium">{t("settings:interface.showgreeting.label")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:interface.showgreeting.description")}
					</div>
				</div>
			</Section>
		</div>
	)
}
