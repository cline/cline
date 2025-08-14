import { useEffect } from "react"
import { Checkbox } from "vscrui"

import {
	type ProviderSettings,
	type ModelInfo,
	type ReasoningEffortWithMinimal,
	reasoningEfforts,
} from "@roo-code/types"

import {
	DEFAULT_HYBRID_REASONING_MODEL_MAX_TOKENS,
	DEFAULT_HYBRID_REASONING_MODEL_THINKING_TOKENS,
	GEMINI_25_PRO_MIN_THINKING_TOKENS,
} from "@roo/api"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Slider, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@src/components/ui"
import { useSelectedModel } from "@src/components/ui/hooks/useSelectedModel"

interface ThinkingBudgetProps {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: <K extends keyof ProviderSettings>(
		field: K,
		value: ProviderSettings[K],
		isUserAction?: boolean,
	) => void
	modelInfo?: ModelInfo
}

// Helper function to determine if minimal option should be shown
const shouldShowMinimalOption = (
	provider: string | undefined,
	modelId: string | undefined,
	supportsEffort: boolean | undefined,
): boolean => {
	const isGpt5Model = provider === "openai-native" && modelId?.startsWith("gpt-5")
	const isOpenRouterWithEffort = provider === "openrouter" && supportsEffort === true
	return !!(isGpt5Model || isOpenRouterWithEffort)
}

export const ThinkingBudget = ({ apiConfiguration, setApiConfigurationField, modelInfo }: ThinkingBudgetProps) => {
	const { t } = useAppTranslation()
	const { id: selectedModelId } = useSelectedModel(apiConfiguration)

	// Check if this is a Gemini 2.5 Pro model
	const isGemini25Pro = selectedModelId && selectedModelId.includes("gemini-2.5-pro")
	const minThinkingTokens = isGemini25Pro ? GEMINI_25_PRO_MIN_THINKING_TOKENS : 1024

	// Check model capabilities
	const isReasoningBudgetSupported = !!modelInfo && modelInfo.supportsReasoningBudget
	const isReasoningBudgetRequired = !!modelInfo && modelInfo.requiredReasoningBudget
	const isReasoningEffortSupported = !!modelInfo && modelInfo.supportsReasoningEffort

	// Determine if minimal option should be shown
	const showMinimalOption = shouldShowMinimalOption(
		apiConfiguration.apiProvider,
		selectedModelId,
		isReasoningEffortSupported,
	)

	// Build available reasoning efforts list
	const baseEfforts = [...reasoningEfforts] as ReasoningEffortWithMinimal[]
	const availableReasoningEfforts: ReadonlyArray<ReasoningEffortWithMinimal> = showMinimalOption
		? (["minimal", ...baseEfforts] as ReasoningEffortWithMinimal[])
		: baseEfforts

	// Default reasoning effort - use model's default if available
	// GPT-5 models have "medium" as their default in the model configuration
	const modelDefaultReasoningEffort = modelInfo?.reasoningEffort as ReasoningEffortWithMinimal | undefined
	const defaultReasoningEffort: ReasoningEffortWithMinimal = modelDefaultReasoningEffort || "medium"
	const currentReasoningEffort: ReasoningEffortWithMinimal =
		(apiConfiguration.reasoningEffort as ReasoningEffortWithMinimal | undefined) || defaultReasoningEffort

	// Set default reasoning effort when model supports it and no value is set
	useEffect(() => {
		if (isReasoningEffortSupported && !apiConfiguration.reasoningEffort && defaultReasoningEffort) {
			setApiConfigurationField("reasoningEffort", defaultReasoningEffort, false)
		}
	}, [isReasoningEffortSupported, apiConfiguration.reasoningEffort, defaultReasoningEffort, setApiConfigurationField])

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
			setApiConfigurationField("modelMaxThinkingTokens", modelMaxThinkingTokens, false)
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
								max={Math.max(
									modelInfo.maxTokens || 8192,
									customMaxOutputTokens,
									DEFAULT_HYBRID_REASONING_MODEL_MAX_TOKENS,
								)}
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
								min={minThinkingTokens}
								max={modelMaxThinkingTokens}
								step={minThinkingTokens === 128 ? 128 : 1024}
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
				value={currentReasoningEffort}
				onValueChange={(value: ReasoningEffortWithMinimal) => {
					setApiConfigurationField("reasoningEffort", value)
				}}>
				<SelectTrigger className="w-full">
					<SelectValue
						placeholder={
							currentReasoningEffort
								? t(`settings:providers.reasoningEffort.${currentReasoningEffort}`)
								: t("settings:common.select")
						}
					/>
				</SelectTrigger>
				<SelectContent>
					{availableReasoningEfforts.map((value) => (
						<SelectItem key={value} value={value}>
							{t(`settings:providers.reasoningEffort.${value}`)}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	) : null
}
