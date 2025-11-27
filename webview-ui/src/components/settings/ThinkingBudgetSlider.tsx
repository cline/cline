import { ANTHROPIC_MAX_THINKING_BUDGET, ANTHROPIC_MIN_THINKING_BUDGET } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { memo, useCallback, useEffect, useState } from "react"
import styled from "styled-components"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { getModeSpecificFields } from "./utils/providerUtils"
import { useApiConfigurationHandlers } from "./utils/useApiConfigurationHandlers"

const THUMB_SIZE = 16

const Container = styled.div`
	display: flex;
	flex-direction: column;
	margin-top: 5px;
	margin-bottom: 10px;
`

const RangeInput = styled.input<{ $value: number; $min: number; $max: number }>`
	width: 100%;
	height: 8px;
	appearance: none;
	border-radius: 4px;
	outline: none;
	cursor: pointer;
	margin: 5px 0 0;
	padding: 0;
	background: ${(props) => {
		const percentage = ((props.$value - props.$min) / (props.$max - props.$min)) * 100
		return `linear-gradient(to right, 
			var(--vscode-progressBar-background) 0%,
			var(--vscode-progressBar-background) ${percentage}%,
			var(--vscode-scrollbarSlider-background) ${percentage}%,
			var(--vscode-scrollbarSlider-background) 100%)`
	}};

	&::-webkit-slider-thumb {
		appearance: none;
		width: ${THUMB_SIZE}px;
		height: ${THUMB_SIZE}px;
		border-radius: 50%;
		background: var(--vscode-foreground);
		cursor: pointer;
		border: 0px solid var(--vscode-progressBar-background);
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
	}

	&:focus {
		outline: none;
	}

	&:focus::-webkit-slider-thumb,
	&:hover::-webkit-slider-thumb {
		border-color: var(--vscode-progressBar-background);
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
	}

	&:active::-webkit-slider-thumb {
		outline: none;
		border-color: var(--vscode-progressBar-background);
	}
`

interface ThinkingBudgetSliderProps {
	maxBudget?: number
	currentMode: Mode
}

const ThinkingBudgetSlider = ({ currentMode }: ThinkingBudgetSliderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleModeFieldChange } = useApiConfigurationHandlers()

	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)

	// Add local state for the slider value
	const [localValue, setLocalValue] = useState(modeFields.thinkingBudgetTokens || 0)

	const [isEnabled, setIsEnabled] = useState<boolean>((modeFields.thinkingBudgetTokens || 0) > 0)

	useEffect(() => {
		const newThinkingBudgetValue = modeFields.thinkingBudgetTokens || 0
		const newIsEnabled = newThinkingBudgetValue > 0

		// Check if the value has changed, we could be getting the same value as feedback from the user's action of clicking the enabled checkbox or moving the slider
		if (newThinkingBudgetValue !== localValue) {
			setLocalValue(newThinkingBudgetValue)
		}
		if (newIsEnabled !== isEnabled) {
			setIsEnabled(newIsEnabled)
		}
	}, [modeFields.thinkingBudgetTokens])

	const handleSliderChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
		const value = parseInt(event.target.value, 10)
		const clampedValue = Math.max(value, ANTHROPIC_MIN_THINKING_BUDGET)
		setLocalValue(clampedValue)
	}, [])

	const handleSliderComplete = () => {
		handleModeFieldChange(
			{ plan: "planModeThinkingBudgetTokens", act: "actModeThinkingBudgetTokens" },
			localValue,
			currentMode,
		)
	}

	const handleToggleChange = (event: any) => {
		const isChecked = (event.target as HTMLInputElement).checked
		const newThinkingBudgetValue = isChecked ? ANTHROPIC_MIN_THINKING_BUDGET : 0
		setIsEnabled(isChecked)
		setLocalValue(newThinkingBudgetValue)

		handleModeFieldChange(
			{ plan: "planModeThinkingBudgetTokens", act: "actModeThinkingBudgetTokens" },
			newThinkingBudgetValue,
			currentMode,
		)
	}

	return (
		<>
			<VSCodeCheckbox checked={isEnabled} onClick={handleToggleChange}>
				Enable thinking{localValue && localValue > 0 ? ` (${localValue.toLocaleString()} tokens)` : ""}
			</VSCodeCheckbox>

			{isEnabled && (
				<Container>
					<RangeInput
						$max={ANTHROPIC_MAX_THINKING_BUDGET}
						$min={0}
						$value={localValue}
						aria-describedby="thinking-budget-description"
						aria-label={`Thinking budget: ${localValue.toLocaleString()} tokens`}
						aria-valuemax={ANTHROPIC_MAX_THINKING_BUDGET}
						aria-valuemin={ANTHROPIC_MIN_THINKING_BUDGET}
						aria-valuenow={localValue}
						id="thinking-budget-slider"
						max={ANTHROPIC_MAX_THINKING_BUDGET}
						min={0}
						onChange={handleSliderChange}
						onMouseUp={handleSliderComplete}
						onTouchEnd={handleSliderComplete}
						step={1}
						type="range"
						value={localValue}
					/>
				</Container>
			)}
		</>
	)
}

export default memo(ThinkingBudgetSlider)
