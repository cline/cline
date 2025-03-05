import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"

interface ExperimentalFeatureProps {
	name: string
	description: string
	enabled: boolean
	onChange: (value: boolean) => void
}

export const ExperimentalFeature = ({ name, description, enabled, onChange }: ExperimentalFeatureProps) => (
	<div>
		<div className="flex items-center gap-2">
			<span className="text-vscode-errorForeground">⚠️</span>
			<VSCodeCheckbox checked={enabled} onChange={(e: any) => onChange(e.target.checked)}>
				<span className="font-medium">{name}</span>
			</VSCodeCheckbox>
		</div>
		<p className="text-vscode-descriptionForeground text-sm mt-0">{description}</p>
	</div>
)
