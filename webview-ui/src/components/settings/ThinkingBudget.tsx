import { Slider } from "@/components/ui"

import { ApiConfiguration, ModelInfo, THINKING_BUDGET } from "../../../../src/shared/api"

interface ThinkingBudgetProps {
	apiConfiguration: ApiConfiguration
	setApiConfigurationField: <K extends keyof ApiConfiguration>(field: K, value: ApiConfiguration[K]) => void
	modelInfo?: ModelInfo
}

export const ThinkingBudget = ({ apiConfiguration, setApiConfigurationField, modelInfo }: ThinkingBudgetProps) => {
	const budget = apiConfiguration?.anthropicThinking ?? THINKING_BUDGET.default

	return modelInfo && modelInfo.thinking ? (
		<div className="flex flex-col gap-1 mt-2">
			<div className="font-medium">Thinking Budget</div>
			<div className="flex items-center gap-1">
				<Slider
					min={THINKING_BUDGET.min}
					max={(modelInfo.maxTokens ?? THINKING_BUDGET.default) - 1}
					step={THINKING_BUDGET.step}
					value={[budget]}
					onValueChange={(value) => setApiConfigurationField("anthropicThinking", value[0])}
				/>
				<div className="w-12 text-sm text-center">{budget}</div>
			</div>
		</div>
	) : null
}
