import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { Cog } from "lucide-react"

import { EXPERIMENT_IDS, ExperimentId } from "../../../../src/shared/experiments"

import { cn } from "@/lib/utils"
import { Slider } from "@/components/ui"

import { SetCachedStateField, SetExperimentEnabled } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"

type AdvancedSettingsProps = HTMLAttributes<HTMLDivElement> & {
	rateLimitSeconds: number
	diffEnabled?: boolean
	fuzzyMatchThreshold?: number
	setCachedStateField: SetCachedStateField<"rateLimitSeconds" | "diffEnabled" | "fuzzyMatchThreshold">
	experiments: Record<ExperimentId, boolean>
	setExperimentEnabled: SetExperimentEnabled
}
export const AdvancedSettings = ({
	rateLimitSeconds,
	diffEnabled,
	fuzzyMatchThreshold,
	setCachedStateField,
	experiments,
	setExperimentEnabled,
	className,
	...props
}: AdvancedSettingsProps) => {
	const { t } = useAppTranslation()

	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<Cog className="w-4" />
					<div>{t("settings:sections.advanced")}</div>
				</div>
			</SectionHeader>

			<Section>
				<div>
					<div className="flex flex-col gap-2">
						<span className="font-medium">{t("settings:advanced.rateLimit.label")}</span>
						<div className="flex items-center gap-2">
							<Slider
								min={0}
								max={60}
								step={1}
								value={[rateLimitSeconds]}
								onValueChange={([value]) => setCachedStateField("rateLimitSeconds", value)}
							/>
							<span className="w-10">{rateLimitSeconds}s</span>
						</div>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:advanced.rateLimit.description")}
					</div>
				</div>

				<div>
					<VSCodeCheckbox
						checked={diffEnabled}
						onChange={(e: any) => {
							setCachedStateField("diffEnabled", e.target.checked)
							if (!e.target.checked) {
								// Reset experimental strategies when diffs are disabled.
								setExperimentEnabled(EXPERIMENT_IDS.DIFF_STRATEGY_UNIFIED, false)
							}
						}}>
						<span className="font-medium">{t("settings:advanced.diff.label")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm">
						{t("settings:advanced.diff.description")}
					</div>
				</div>

				{diffEnabled && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						<div>
							<label className="block font-medium mb-1">
								{t("settings:advanced.diff.matchPrecision.label")}
							</label>
							<div className="flex items-center gap-2">
								<Slider
									min={0.8}
									max={1}
									step={0.005}
									value={[fuzzyMatchThreshold ?? 1.0]}
									onValueChange={([value]) => setCachedStateField("fuzzyMatchThreshold", value)}
								/>
								<span className="w-10">{Math.round((fuzzyMatchThreshold || 1) * 100)}%</span>
							</div>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:advanced.diff.matchPrecision.description")}
							</div>
						</div>
					</div>
				)}
			</Section>
		</div>
	)
}
