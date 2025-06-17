import { HTMLAttributes } from "react"
import { FlaskConical } from "lucide-react"

import type { Experiments, CodebaseIndexConfig, CodebaseIndexModels, ProviderSettings } from "@roo-code/types"

import { EXPERIMENT_IDS, experimentConfigsMap } from "@roo/experiments"

import { ExtensionStateContextType } from "@src/context/ExtensionStateContext"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { cn } from "@src/lib/utils"

import { SetCachedStateField, SetExperimentEnabled } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { ExperimentalFeature } from "./ExperimentalFeature"
import { CodeIndexSettings } from "./CodeIndexSettings"

type ExperimentalSettingsProps = HTMLAttributes<HTMLDivElement> & {
	experiments: Experiments
	setExperimentEnabled: SetExperimentEnabled
	setCachedStateField: SetCachedStateField<"codebaseIndexConfig">
	// CodeIndexSettings props
	codebaseIndexModels: CodebaseIndexModels | undefined
	codebaseIndexConfig: CodebaseIndexConfig | undefined
	apiConfiguration: ProviderSettings
	setApiConfigurationField: <K extends keyof ProviderSettings>(field: K, value: ProviderSettings[K]) => void
	areSettingsCommitted: boolean
}

export const ExperimentalSettings = ({
	experiments,
	setExperimentEnabled,
	setCachedStateField,
	codebaseIndexModels,
	codebaseIndexConfig,
	apiConfiguration,
	setApiConfigurationField,
	areSettingsCommitted,
	className,
	...props
}: ExperimentalSettingsProps) => {
	const { t } = useAppTranslation()

	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<FlaskConical className="w-4" />
					<div>{t("settings:sections.experimental")}</div>
				</div>
			</SectionHeader>

			<Section>
				{Object.entries(experimentConfigsMap)
					.filter(([key]) => key in EXPERIMENT_IDS)
					.map((config) => {
						if (config[0] === "MULTI_FILE_APPLY_DIFF") {
							return (
								<ExperimentalFeature
									key={config[0]}
									experimentKey={config[0]}
									enabled={experiments[EXPERIMENT_IDS.MULTI_FILE_APPLY_DIFF] ?? false}
									onChange={(enabled) =>
										setExperimentEnabled(EXPERIMENT_IDS.MULTI_FILE_APPLY_DIFF, enabled)
									}
								/>
							)
						}
						return (
							<ExperimentalFeature
								key={config[0]}
								experimentKey={config[0]}
								enabled={experiments[EXPERIMENT_IDS[config[0] as keyof typeof EXPERIMENT_IDS]] ?? false}
								onChange={(enabled) =>
									setExperimentEnabled(
										EXPERIMENT_IDS[config[0] as keyof typeof EXPERIMENT_IDS],
										enabled,
									)
								}
							/>
						)
					})}

				<CodeIndexSettings
					codebaseIndexModels={codebaseIndexModels}
					codebaseIndexConfig={codebaseIndexConfig}
					apiConfiguration={apiConfiguration}
					setCachedStateField={setCachedStateField as SetCachedStateField<keyof ExtensionStateContextType>}
					setApiConfigurationField={setApiConfigurationField}
					areSettingsCommitted={areSettingsCommitted}
				/>
			</Section>
		</div>
	)
}
