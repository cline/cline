import React from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { updateSetting } from "./utils/settingsHandlers"

const SubagentOutputLineLimitSlider: React.FC = () => {
	const { subagentTerminalOutputLineLimit } = useExtensionState()

	const handleSliderChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		const value = parseInt(event.target.value, 10)
		updateSetting("subagentTerminalOutputLineLimit", value)
	}

	return (
		<div>
			<label htmlFor="subagent-output-limit" style={{ fontWeight: "700", fontSize: 12, display: "block", marginBottom: 5 }}>
				Subagent output limit
			</label>
			<div style={{ display: "flex", alignItems: "center" }}>
				<input
					id="subagent-output-limit"
					max="5000"
					min="100"
					onChange={handleSliderChange}
					step="100"
					style={{ flexGrow: 1, marginRight: "1rem" }}
					type="range"
					value={subagentTerminalOutputLineLimit ?? 2000}
				/>
				<span>{subagentTerminalOutputLineLimit ?? 2000}</span>
			</div>
			<p style={{ fontSize: 11, color: "var(--vscode-descriptionForeground)", margin: "5px 0 0 0" }}>
				Maximum number of lines to include in output from CLI subagents. Truncates middle to save tokens.
			</p>
		</div>
	)
}

export default SubagentOutputLineLimitSlider
