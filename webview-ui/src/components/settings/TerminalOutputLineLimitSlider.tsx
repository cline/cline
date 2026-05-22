import React from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { updateSetting } from "./utils/settingsHandlers"

const TerminalOutputLineLimitSlider: React.FC = () => {
	const { terminalOutputLineLimit } = useExtensionState()

	const handleSliderChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		const value = parseInt(event.target.value, 10)
		updateSetting("terminalOutputLineLimit", value)
	}

	return (
		<div className="terminal-slider-container">
			<label className="terminal-slider-label" htmlFor="terminal-output-limit">
				Terminal output limit
			</label>
			<div className="terminal-slider-row">
				<input
					className="terminal-slider-input"
					id="terminal-output-limit"
					max="5000"
					min="100"
					onChange={handleSliderChange}
					step="100"
					type="range"
					value={terminalOutputLineLimit ?? 500}
				/>
				<span>{terminalOutputLineLimit ?? 500}</span>
			</div>
			<p className="terminal-slider-hint">
				Maximum number of lines to include in terminal output when executing commands. When exceeded, lines will be
				removed from the middle, saving tokens.
			</p>
		</div>
	)
}

export default TerminalOutputLineLimitSlider
