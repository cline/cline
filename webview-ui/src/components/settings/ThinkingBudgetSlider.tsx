import { memo, useCallback, useState } from "react"
import { anthropicModels, ApiConfiguration, bedrockModels, geminiDefaultModelId, geminiModels, vertexModels } from "@shared/api"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import styled from "styled-components"

// Constants
const DEFAULT_MIN_VALID_TOKENS = 1024
const DEFAULT_MAX_PERCENTAGE = 0.8
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
	apiConfiguration: ApiConfiguration | undefined
	setApiConfiguration: (apiConfiguration: ApiConfiguration) => void
	maxBudget?: number
}

const ThinkingBudgetSlider = ({ apiConfiguration, setApiConfiguration, maxBudget }: ThinkingBudgetSliderProps) => {
	const maxTokens = (): number => {
		if (apiConfiguration?.apiProvider === "gemini") {
			if (apiConfiguration.apiModelId === "claude-3-7-sonnet@20250219") {
				return vertexModels["claude-3-7-sonnet@20250219"].thinkingConfig.maxBudget
			}
			return geminiModels[geminiDefaultModelId].maxTokens
		}
		if (apiConfiguration?.apiProvider === "anthropic") {
			return anthropicModels["claude-3-7-sonnet-20250219"].thinkingConfig.maxBudget
		}
		if (apiConfiguration?.apiProvider === "bedrock") {
			return bedrockModels["anthropic.claude-3-7-sonnet-20250219-v1:0"].thinkingConfig.maxBudget
		}
		return 0
	}
	// use maxBudget prop if provided, otherwise apply the percentage cap to maxTokens

	const getThinkingBudgetPercentage = (): number => {
		if (apiConfiguration?.apiProvider === "gemini" && apiConfiguration.apiModelId === "gemini-2-5-flash") {
			return 1.0 // Gemini2.5 Flash is 100%
		} else if (
			(apiConfiguration?.apiProvider === "anthropic" && apiConfiguration.apiModelId === "claude-3-7-sonnet-20250219") ||
			(apiConfiguration?.apiProvider === "bedrock" && apiConfiguration.apiModelId === "anthropic.claude-3-7-sonnet-20250219-v1:0") ||
			(apiConfiguration?.apiProvider === "gemini" && apiConfiguration.apiModelId === "claude-3-7-sonnet@20250219")
		) {
			return 0.5 // Claude3.7 is 50%(32K Token)
		}
		
		return DEFAULT_MAX_PERCENTAGE
	}

	const maxSliderValue = (() => {
		if (maxBudget !== undefined) {
			return maxBudget
		}
		return Math.floor(maxTokens() * getThinkingBudgetPercentage())
	})()

	const isEnabled = (apiConfiguration?.thinkingBudgetTokens || 0) > 0

	// Add local state for the slider value
	const [localValue, setLocalValue] = useState(apiConfiguration?.thinkingBudgetTokens || 0)

	const handleSliderChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
		const value = parseInt(event.target.value, 10)
		setLocalValue(value)
	}, [])

	const handleSliderComplete = () => {
		setApiConfiguration({
			...apiConfiguration,
			thinkingBudgetTokens: localValue,
		})
	}

	const handleToggleChange = (event: any) => {
		const isChecked = (event.target as HTMLInputElement).checked
		const newValue = isChecked ? DEFAULT_MIN_VALID_TOKENS : 0
		setLocalValue(newValue)
		setApiConfiguration({
			...apiConfiguration,
			thinkingBudgetTokens: newValue,
		})
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
