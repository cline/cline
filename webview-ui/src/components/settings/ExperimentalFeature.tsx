import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"

interface ExperimentalFeatureProps {
	id: string
	name: string
	description: string
	enabled: boolean
	onChange: (value: boolean) => void
}

const ExperimentalFeature = ({ id, name, description, enabled, onChange }: ExperimentalFeatureProps) => {
	return (
		<div
			style={{
				marginTop: 10,
				paddingLeft: 10,
				borderLeft: "2px solid var(--vscode-button-background)",
			}}>
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
