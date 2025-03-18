import { useEffect, useMemo } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"

import { Slider } from "@/components/ui"

import { ApiConfiguration, ModelInfo } from "../../../../src/shared/api"

interface ThinkingBudgetProps {
	apiConfiguration: ApiConfiguration
	setApiConfigurationField: <K extends keyof ApiConfiguration>(field: K, value: ApiConfiguration[K]) => void
	modelInfo?: ModelInfo
}

export const ThinkingBudget = ({ apiConfiguration, setApiConfigurationField, modelInfo }: ThinkingBudgetProps) => {
	const { t } = useAppTranslation()
	const tokens = apiConfiguration?.modelMaxTokens || 16_384
	const tokensMin = 8192
	const tokensMax = modelInfo?.maxTokens || 64_000

	// Get the appropriate thinking tokens based on provider
	const thinkingTokens = useMemo(() => {
		const value = apiConfiguration?.modelMaxThinkingTokens
		return value || Math.min(Math.floor(0.8 * tokens), 8192)
	}, [apiConfiguration, tokens])

	const thinkingTokensMin = 1024
	const thinkingTokensMax = Math.floor(0.8 * tokens)

	useEffect(() => {
		if (thinkingTokens > thinkingTokensMax) {
			setApiConfigurationField("modelMaxThinkingTokens", thinkingTokensMax)
		}
	}, [thinkingTokens, thinkingTokensMax, setApiConfigurationField])

	if (!modelInfo?.thinking) {
		return null
	}

	return (
		<>
			<div className="flex flex-col gap-1">
				<div className="font-medium">{t("settings:thinkingBudget.maxTokens")}</div>
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
			<div className="flex flex-col gap-1">
				<div className="font-medium">{t("settings:thinkingBudget.maxThinkingTokens")}</div>
				<div className="flex items-center gap-1">
					<Slider
						min={thinkingTokensMin}
						max={thinkingTokensMax}
						step={1024}
						value={[thinkingTokens]}
						onValueChange={([value]) => setApiConfigurationField("modelMaxThinkingTokens", value)}
					/>
					<div className="w-12 text-sm text-center">{thinkingTokens}</div>
				</div>
			</div>
		</>
	)
}
