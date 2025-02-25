import { memo } from "react"
import { anthropicModels, ApiConfiguration } from "../../../../src/shared/api"
import { vscode } from "../../utils/vscode"
import ClineSlider from "../common/cline-ui/ClineSlider"

interface ThinkingBudgetSliderProps {
	apiConfiguration: ApiConfiguration | undefined
	setApiConfiguration: (apiConfiguration: ApiConfiguration) => void
}

const ThinkingBudgetSlider = ({ apiConfiguration, setApiConfiguration }: ThinkingBudgetSliderProps) => {
	const maxTokens = anthropicModels["claude-3-7-sonnet-20250219"].maxTokens
	const maxSliderValue = Math.floor(maxTokens * 0.8)

	// Get the current value from apiConfiguration
	const currentValue = apiConfiguration?.thinkingBudgetTokens || 0

	// Map the slider value to a valid thinking budget value
	const getValidValue = (value: number): number => {
		if (value === 0) return 0
		return value < 1024 ? 1024 : value
	}

	// This function is called during dragging - just update the UI with raw value
	const handleChange = (value: number) => {
		// No validation here - just pass the raw value
		if (apiConfiguration) {
			setApiConfiguration({
				...apiConfiguration,
				thinkingBudgetTokens: value,
			})
		}
	}

	// This function will be called when the user stops dragging
	const handleChangeEnd = (value: number) => {
		// Now apply validation when the user is done dragging
		const validValue = getValidValue(value)

		if (apiConfiguration) {
			setApiConfiguration({
				...apiConfiguration,
				thinkingBudgetTokens: validValue,
			})
		}

		// Update VS Code settings with the validated value
		vscode.postMessage({
			type: "updateThinkingBudgetTokens",
			number: validValue,
		})
	}

	return (
		<ClineSlider
			id="thinking-budget-slider"
			label="Thinking Budget (tokens)"
			value={currentValue}
			min={0}
			max={maxSliderValue}
			step={100}
			onChange={handleChange}
			onChangeEnd={handleChangeEnd}
			validateValue={getValidValue}
			description="Set to 0 to disable extended thinking. Higher values allow Claude to think more deeply before responding."
		/>
	)
}

export default memo(ThinkingBudgetSlider)
