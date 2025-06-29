import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { anthropicModels, ApiConfiguration, geminiDefaultModelId, geminiModels, ModelInfo } from "@shared/api"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import styled from "styled-components"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useApiConfigurationHandlers } from "./utils/useApiConfigurationHandlers"

// Constants
const DEFAULT_MIN_VALID_TOKENS = 1024
const MAX_PERCENTAGE = 0.8
const THUMB_SIZE = 16

// Styled Components
const Container = styled.div`
	display: flex;
	flex-direction: column;
	gap: 10px;
`

const LabelContainer = styled.div`
	display: flex;
	justify-content: space-between;
	flex-wrap: wrap;
	gap: 12px;
`

const Label = styled.label`
	font-weight: 500;
	display: block;
	margin-right: auto;
`
const Description = styled.p`
	font-size: 12px;
	margin-top: 0px;
	margin-bottom: 0px;
	color: var(--vscode-descriptionForeground);
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
}

const ThinkingBudgetSlider = ({ maxBudget }: ThinkingBudgetSliderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	const [isEnabled, setIsEnabled] = useState<boolean>((apiConfiguration?.thinkingBudgetTokens || 0) > 0)

	const maxTokens = useMemo(
		() =>
			apiConfiguration?.apiProvider === "gemini"
				? geminiModels[geminiDefaultModelId].maxTokens
				: anthropicModels["claude-3-7-sonnet-20250219"].maxTokens,
		[apiConfiguration?.apiProvider],
	)

	// use maxBudget prop if provided, otherwise apply the percentage cap to maxTokens
	const maxSliderValue = useMemo(() => {
		if (maxBudget !== undefined) {
			return maxBudget
		}
		return Math.floor(maxTokens * MAX_PERCENTAGE)
	}, [maxBudget, maxTokens])

	// Add local state for the slider value
	const [localValue, setLocalValue] = useState(apiConfiguration?.thinkingBudgetTokens || 0)

	const handleSliderChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
		const value = parseInt(event.target.value, 10)
		setLocalValue(value)
	}, [])

	const handleSliderComplete = () => {
		handleFieldChange("thinkingBudgetTokens", localValue)
	}

	const handleToggleChange = (event: any) => {
		const isChecked = (event.target as HTMLInputElement).checked
		const newValue = isChecked ? DEFAULT_MIN_VALID_TOKENS : 0
		setIsEnabled(isChecked)
		setLocalValue(newValue)

		handleFieldChange("thinkingBudgetTokens", newValue)
	}

	return (
		<Container>
			<VSCodeCheckbox checked={isEnabled} onChange={handleToggleChange}>
				Enable extended thinking
			</VSCodeCheckbox>

			{isEnabled && (
				<>
					<LabelContainer>
						<Label htmlFor="thinking-budget-slider">
							<strong>Budget:</strong> {localValue.toLocaleString()} tokens
						</Label>
					</LabelContainer>
					<RangeInput
						id="thinking-budget-slider"
						type="range"
						min={DEFAULT_MIN_VALID_TOKENS}
						max={maxSliderValue}
						step={1}
						value={localValue}
						onChange={handleSliderChange}
						onMouseUp={handleSliderComplete}
						onTouchEnd={handleSliderComplete}
						$value={localValue}
						$min={DEFAULT_MIN_VALID_TOKENS}
						$max={maxSliderValue}
						aria-label={`Thinking budget: ${localValue.toLocaleString()} tokens`}
						aria-valuemin={DEFAULT_MIN_VALID_TOKENS}
						aria-valuemax={maxSliderValue}
						aria-valuenow={localValue}
						aria-describedby="thinking-budget-description"
					/>

					<Description id="thinking-budget-description">
						Higher budgets may allow you to achieve more comprehensive and nuanced reasoning
					</Description>
				</>
			)}
		</Container>
	)
}

export default memo(ThinkingBudgetSlider)
