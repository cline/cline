import { useEffect } from "react"

import { Slider } from "@/components/ui"

import { ApiConfiguration, ModelInfo } from "../../../../src/shared/api"

interface ThinkingBudgetProps {
	apiConfiguration: ApiConfiguration
	setApiConfigurationField: <K extends keyof ApiConfiguration>(field: K, value: ApiConfiguration[K]) => void
	modelInfo?: ModelInfo
}

export const ThinkingBudget = ({ apiConfiguration, setApiConfigurationField, modelInfo }: ThinkingBudgetProps) => {
	const tokens = apiConfiguration?.modelMaxTokens || modelInfo?.maxTokens || 64_000
	const tokensMin = 8192
	const tokensMax = modelInfo?.maxTokens || 64_000

	const thinkingTokens = apiConfiguration?.anthropicThinking || 8192
	const thinkingTokensMin = 1024
	const thinkingTokensMax = Math.floor(0.8 * tokens)

	useEffect(() => {
		if (thinkingTokens > thinkingTokensMax) {
			setApiConfigurationField("anthropicThinking", thinkingTokensMax)
		}
	}, [thinkingTokens, thinkingTokensMax, setApiConfigurationField])

	if (!modelInfo || !modelInfo.thinking) {
		return null
	}

	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-col gap-1 mt-2">
				<div className="font-medium">Max Tokens</div>
				<div className="flex items-center gap-1">
					<Slider
						min={tokensMin}
						max={tokensMax}
						step={1024}
						value={[tokens]}
						onValueChange={([value]) => setApiConfigurationField("modelMaxTokens", value)}
					/>
					<div className="w-12 text-sm text-center">{tokens}</div>
				</div>
			</div>
			<div className="flex flex-col gap-1 mt-2">
				<div className="font-medium">Max Thinking Tokens</div>
				<div className="flex items-center gap-1">
					<Slider
						min={thinkingTokensMin}
						max={thinkingTokensMax}
						step={1024}
						value={[thinkingTokens]}
						onValueChange={([value]) => setApiConfigurationField("anthropicThinking", value)}
					/>
					<div className="w-12 text-sm text-center">{thinkingTokens}</div>
				</div>
			</div>
		</div>
	)
}
