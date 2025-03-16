import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useAppTranslation } from "@/i18n/TranslationContext"

interface ExperimentalFeatureProps {
	name: string
	description: string
	enabled: boolean
	onChange: (value: boolean) => void
}

export const ExperimentalFeature = ({ name, description, enabled, onChange }: ExperimentalFeatureProps) => {
	const { t } = useAppTranslation()

	return (
		<div>
			<div className="flex items-center gap-2">
				<span className="text-vscode-errorForeground">{t("settings:experimental.warning")}</span>
				<VSCodeCheckbox checked={enabled} onChange={(e: any) => onChange(e.target.checked)}>
					<span className="font-medium">{name}</span>
				</VSCodeCheckbox>
			</div>
			<p className="text-vscode-descriptionForeground text-sm mt-0">{description}</p>
		</div>
	)
}
