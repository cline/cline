import { memo } from "react"
import { ApiConfiguration } from "../../../../src/shared/api"
import { vscode } from "../../utils/vscode"
import ClineSlider from "../common/cline-ui/ClineSlider"

interface ThinkingBudgetSliderProps {
	apiConfiguration?: ApiConfiguration
	setApiConfiguration: (config: ApiConfiguration) => void
}

const ThinkingBudgetSlider = ({ apiConfiguration, setApiConfiguration }: ThinkingBudgetSliderProps) => {
	const handleChange = (value: number) => {
		setApiConfiguration({
			...apiConfiguration,
			thinkingBudgetTokens: value,
		})

		// Update VS Code settings
		vscode.postMessage({
			type: "updateThinkingBudgetTokens",
			number: value,
		})
	}

	return (
		<ClineSlider
			id="thinking-budget-slider"
			label="Thinking Budget (tokens)"
			value={apiConfiguration?.thinkingBudgetTokens || 0}
			min={0}
			max={4000}
			step={100}
			onChange={handleChange}
			description="Set to 0 to disable extended thinking. Higher values allow Claude to think more deeply before responding."
		/>
	)
}

export default memo(ThinkingBudgetSlider)
