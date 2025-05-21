import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { FlaskConical } from "lucide-react"

import { EXPERIMENT_IDS, experimentConfigsMap, ExperimentId } from "@roo/shared/experiments"

import { cn } from "@/lib/utils"

import { SetCachedStateField, SetExperimentEnabled } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { ExperimentalFeature } from "./ExperimentalFeature"
import { Slider } from "@/components/ui/"

type ExperimentalSettingsProps = HTMLAttributes<HTMLDivElement> & {
	experiments: Record<ExperimentId, boolean>
	setExperimentEnabled: SetExperimentEnabled
	autoCondenseContextPercent: number
	setCachedStateField: SetCachedStateField<"autoCondenseContextPercent">
}

export const ExperimentalSettings = ({
	experiments,
	setExperimentEnabled,
	autoCondenseContextPercent,
	setCachedStateField,
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
					.filter((config) => config[0] !== "DIFF_STRATEGY" && config[0] !== "MULTI_SEARCH_AND_REPLACE")
					.map((config) => (
						<ExperimentalFeature
							key={config[0]}
							experimentKey={config[0]}
							enabled={experiments[EXPERIMENT_IDS[config[0] as keyof typeof EXPERIMENT_IDS]] ?? false}
							onChange={(enabled) =>
								setExperimentEnabled(EXPERIMENT_IDS[config[0] as keyof typeof EXPERIMENT_IDS], enabled)
							}
						/>
					))}
				{experiments[EXPERIMENT_IDS.AUTO_CONDENSE_CONTEXT] && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						<div className="flex items-center gap-4 font-bold">
							<span className="codicon codicon-fold" />
							<div>{t("settings:experimental.autoCondenseContextPercent.label")}</div>
						</div>
						<div>
							<div className="flex items-center gap-2">
								<Slider
									min={10}
									max={100}
									step={1}
									value={[autoCondenseContextPercent]}
									onValueChange={([value]) =>
										setCachedStateField("autoCondenseContextPercent", value)
									}
								/>
								<span className="w-20">{autoCondenseContextPercent}%</span>
							</div>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:experimental.autoCondenseContextPercent.description")}
							</div>
						</div>
					</div>
				)}
			</Section>
		</div>
	)
}
