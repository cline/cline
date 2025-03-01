import { memo } from "react"
import { ANTHROPIC_THINKING_BUDGET_TOKENS_MIN, anthropicModels, ApiConfiguration } from "../../../../src/shared/api"
import { vscode } from "../../utils/vscode"
import ClineSlider from "../common/cline-ui/ClineSlider"

interface ThinkingBudgetSliderProps {
	apiConfiguration: ApiConfiguration | undefined
	setApiConfiguration: (apiConfiguration: ApiConfiguration) => void
}

// Constants
const MIN_VALID_TOKENS = ANTHROPIC_THINKING_BUDGET_TOKENS_MIN
const MAX_PERCENTAGE = 0.8

const ThinkingBudgetSlider = ({ apiConfiguration, setApiConfiguration }: ThinkingBudgetSliderProps) => {
	// Calculate max tokens based on model
	const maxTokens = anthropicModels["claude-3-7-sonnet-20250219"].maxTokens
	const maxSliderValue = Math.floor(maxTokens * MAX_PERCENTAGE)
	const currentValue = apiConfiguration?.thinkingBudgetTokens || 0

	// Style constants for reasoning level display
	const labelStyle: React.CSSProperties = { color: "var(--vscode-editor-foreground)" }
	const valueStyle: React.CSSProperties = {
		color: "white",
		backgroundColor: "var(--vscode-button-background)",
		padding: "2px 6px",
		borderRadius: "4px",
		fontWeight: "bold",
	}

	// Handlers
	const handleChange = (value: number) => {
		if (!apiConfiguration) return
		setApiConfiguration({
			...apiConfiguration,
			thinkingBudgetTokens: value,
		})
	}

	const handleChangeEnd = (value: number) => {
		if (!apiConfiguration) return
		const validValue = getValidValue(value)

		setApiConfiguration({
			...apiConfiguration,
			thinkingBudgetTokens: validValue,
		})

		vscode.postMessage({
			type: "updateThinkingBudgetTokens",
			number: validValue,
		})
	}

	// Utility functions
	const getValidValue = (value: number): number => (value === 0 ? 0 : Math.max(MIN_VALID_TOKENS, value))

	const getReasoningLevel = (value: number, min: number, max: number): JSX.Element => {
		let levelText: string

		if (value === 0) {
			levelText = "Off"
		} else {
			const percentage = (value - min) / (max - min)
			levelText = percentage <= 1 / 3 ? "Low" : percentage <= 2 / 3 ? "Medium" : "High"
		}

		return (
			<span>
				<span style={labelStyle}>Reasoning:</span> <span style={valueStyle}>{levelText}</span>
			</span>
		)
	}

	return (
		<ClineSlider
			id="thinking-budget-slider"
			label="Thinking tokens"
			value={currentValue}
			min={0}
			max={maxSliderValue}
			step={100}
			onChange={handleChange}
			onChangeEnd={handleChangeEnd}
			validateValue={getValidValue}
			dynamicColor={true}
			getSecondaryLabel={getReasoningLevel}
			description="Set to 0 to disable extended thinking. Higher values allow Claude to think more deeply before responding."
		/>
	)
}

export default memo(ThinkingBudgetSlider)
