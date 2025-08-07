import { type ProviderSettings, type ModelInfo, type VerbosityLevel, verbosityLevels } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@src/components/ui"

interface VerbosityProps {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: <K extends keyof ProviderSettings>(field: K, value: ProviderSettings[K]) => void
	modelInfo?: ModelInfo
}

export const Verbosity = ({ apiConfiguration, setApiConfigurationField, modelInfo }: VerbosityProps) => {
	const { t } = useAppTranslation()

	// For now, we'll show verbosity for all models, but this can be restricted later
	// based on model capabilities (e.g., only for GPT-5 models)
	if (!modelInfo) {
		return null
	}

	return (
		<div className="flex flex-col gap-1" data-testid="verbosity">
			<div className="flex justify-between items-center">
				<label className="block font-medium mb-1">{t("settings:providers.verbosity.label")}</label>
			</div>
			<Select
				value={apiConfiguration.verbosity || "medium"}
				onValueChange={(value) => setApiConfigurationField("verbosity", value as VerbosityLevel)}>
				<SelectTrigger className="w-full">
					<SelectValue placeholder={t("settings:common.select")} />
				</SelectTrigger>
				<SelectContent>
					{verbosityLevels.map((value) => (
						<SelectItem key={value} value={value}>
							{t(`settings:providers.verbosity.${value}`)}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<div className="text-xs text-muted-foreground mt-1">{t("settings:providers.verbosity.description")}</div>
		</div>
	)
}
