import { useEffect } from "react"
import { Checkbox } from "vscrui"

import { type ProviderSettings, type ModelInfo, type ReasoningEffort, reasoningEfforts } from "@roo-code/types"

import { DEFAULT_HYBRID_REASONING_MODEL_MAX_TOKENS, DEFAULT_HYBRID_REASONING_MODEL_THINKING_TOKENS } from "@roo/api"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Slider, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@src/components/ui"

interface ThinkingBudgetProps {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: <K extends keyof ProviderSettings>(field: K, value: ProviderSettings[K]) => void
	modelInfo?: ModelInfo
}

export const ThinkingBudget = ({ apiConfiguration, setApiConfigurationField, modelInfo }: ThinkingBudgetProps) => {
	const { t } = useAppTranslation()

	const isReasoningBudgetSupported = !!modelInfo && modelInfo.supportsReasoningBudget
	const isReasoningBudgetRequired = !!modelInfo && modelInfo.requiredReasoningBudget
	const isReasoningEffortSupported = !!modelInfo && modelInfo.supportsReasoningEffort

	const enableReasoningEffort = apiConfiguration.enableReasoningEffort
	const customMaxOutputTokens = apiConfiguration.modelMaxTokens || DEFAULT_HYBRID_REASONING_MODEL_MAX_TOKENS
	const customMaxThinkingTokens =
		apiConfiguration.modelMaxThinkingTokens || DEFAULT_HYBRID_REASONING_MODEL_THINKING_TOKENS

	// Dynamically expand or shrink the max thinking budget based on the custom
	// max output tokens so that there's always a 20% buffer.
	const modelMaxThinkingTokens = modelInfo?.maxThinkingTokens
		? Math.min(modelInfo.maxThinkingTokens, Math.floor(0.8 * customMaxOutputTokens))
		: Math.floor(0.8 * customMaxOutputTokens)

	// If the custom max thinking tokens are going to exceed it's limit due
	// to the custom max output tokens being reduced then we need to shrink it
	// appropriately.
	useEffect(() => {
		if (isReasoningBudgetSupported && customMaxThinkingTokens > modelMaxThinkingTokens) {
			setApiConfigurationField("modelMaxThinkingTokens", modelMaxThinkingTokens)
		}
	}, [isReasoningBudgetSupported, customMaxThinkingTokens, modelMaxThinkingTokens, setApiConfigurationField])

	if (!modelInfo) {
		return null
	}

	return isReasoningBudgetSupported && !!modelInfo.maxTokens ? (
		<>
			{!isReasoningBudgetRequired && (
				<div className="flex flex-col gap-1">
					<Checkbox
						checked={enableReasoningEffort}
						onChange={(checked: boolean) =>
							setApiConfigurationField("enableReasoningEffort", checked === true)
						}>
						{t("settings:providers.useReasoning")}
					</Checkbox>
				</div>
			)}
			{(isReasoningBudgetRequired || enableReasoningEffort) && (
				<>
					<div className="flex flex-col gap-1">
						<div className="font-medium">{t("settings:thinkingBudget.maxTokens")}</div>
						<div className="flex items-center gap-1">
							<Slider
								min={8192}
								max={modelInfo.maxTokens}
								step={1024}
								value={[customMaxOutputTokens]}
								onValueChange={([value]) => setApiConfigurationField("modelMaxTokens", value)}
							/>
							<div className="w-12 text-sm text-center">{customMaxOutputTokens}</div>
						</div>
					</div>
					<div className="flex flex-col gap-1">
						<div className="font-medium">{t("settings:thinkingBudget.maxThinkingTokens")}</div>
						<div className="flex items-center gap-1" data-testid="reasoning-budget">
							<Slider
								min={1024}
								max={modelMaxThinkingTokens}
								step={1024}
								value={[customMaxThinkingTokens]}
								onValueChange={([value]) => setApiConfigurationField("modelMaxThinkingTokens", value)}
							/>
							<div className="w-12 text-sm text-center">{customMaxThinkingTokens}</div>
						</div>
					</div>
				</>
			)}
		</>
	) : isReasoningEffortSupported ? (
		<div className="flex flex-col gap-1" data-testid="reasoning-effort">
			<div className="flex justify-between items-center">
				<label className="block font-medium mb-1">{t("settings:providers.reasoningEffort.label")}</label>
			</div>
			<Select
				value={apiConfiguration.reasoningEffort}
				onValueChange={(value) => setApiConfigurationField("reasoningEffort", value as ReasoningEffort)}>
				<SelectTrigger className="w-full">
					<SelectValue placeholder={t("settings:common.select")} />
				</SelectTrigger>
				<SelectContent>
					{reasoningEfforts.map((value) => (
						<SelectItem key={value} value={value}>
							{t(`settings:providers.reasoningEffort.${value}`)}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	) : null
}
