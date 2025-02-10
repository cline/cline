import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"

interface ExperimentalFeatureProps {
	name: string
	description: string
	enabled: boolean
	onChange: (value: boolean) => void
}

const ExperimentalFeature = ({ name, description, enabled, onChange }: ExperimentalFeatureProps) => {
	return (
		<div>
			<div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
				<span style={{ color: "var(--vscode-errorForeground)" }}>⚠️</span>
				<VSCodeCheckbox checked={enabled} onChange={(e: any) => onChange(e.target.checked)}>
					<span style={{ fontWeight: "500" }}>{name}</span>
				</VSCodeCheckbox>
			</div>
			<p
				style={{
					fontSize: "12px",
					marginBottom: 15,
					color: "var(--vscode-descriptionForeground)",
				}}>
				{description}
			</p>
		</div>
	)
}

export default ExperimentalFeature
