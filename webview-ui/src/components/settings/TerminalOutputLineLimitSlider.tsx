import React from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import { Int64, Int64Request } from "@shared/proto/common"

const TerminalOutputLineLimitSlider: React.FC = () => {
	const { terminalOutputLineLimit, setTerminalOutputLineLimit } = useExtensionState()

	const handleSliderChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		const value = parseInt(event.target.value, 10)
		setTerminalOutputLineLimit(value)

		StateServiceClient.updateTerminalOutputLinesLimit({
			value,
		} as Int64Request)
			.then((response: Int64) => {
				setTerminalOutputLineLimit(response.value)
			})
			.catch((error) => {
				console.error("Failed to update terminal output line limit:", error)
			})
	}

	return (
		<div style={{ marginBottom: 15 }}>
			<label htmlFor="terminal-output-limit" style={{ fontWeight: "500", display: "block", marginBottom: 5 }}>
				Terminal output limit
			</label>
			<div style={{ display: "flex", alignItems: "center" }}>
				<input
					type="range"
					id="terminal-output-limit"
					min="100"
					max="5000"
					step="100"
					value={terminalOutputLineLimit ?? 500}
					onChange={handleSliderChange}
					style={{ flexGrow: 1, marginRight: "1rem" }}
				/>
				<span>{terminalOutputLineLimit ?? 500}</span>
			</div>
			<p style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)", margin: "5px 0 0 0" }}>
				Maximum number of lines to include in terminal output when executing commands. When exceeded, lines will be
				removed from the middle, saving tokens.
			</p>
		</div>
	)
}

export default TerminalOutputLineLimitSlider
