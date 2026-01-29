import React from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import SettingsSlider from "./SettingsSlider"
import { updateSetting } from "./utils/settingsHandlers"

const SubagentOutputLineLimitSlider: React.FC = () => {
	const { subagentTerminalOutputLineLimit } = useExtensionState()

	const handleSliderChange = (value: number) => {
		updateSetting("subagentTerminalOutputLineLimit", value)
	}

	return (
		<SettingsSlider
			description="Maximum number of lines to include in output from CLI subagents. Truncates middle to save tokens."
			label="Output Limit (100-5000)"
			max={5000}
			min={100}
			onChange={handleSliderChange}
			step={100}
			value={subagentTerminalOutputLineLimit ?? 2000}
		/>
	)
}

export default SubagentOutputLineLimitSlider
