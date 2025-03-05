import { HTMLAttributes } from "react"
import { FlaskConical } from "lucide-react"

import { EXPERIMENT_IDS, experimentConfigsMap, ExperimentId } from "../../../../src/shared/experiments"

import { cn } from "@/lib/utils"

import { SetCachedStateField, SetExperimentEnabled } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { ExperimentalFeature } from "./ExperimentalFeature"

type ExperimentalSettingsProps = HTMLAttributes<HTMLDivElement> & {
	setCachedStateField: SetCachedStateField<
		"rateLimitSeconds" | "terminalOutputLineLimit" | "maxOpenTabsContext" | "diffEnabled" | "fuzzyMatchThreshold"
	>
	experiments: Record<ExperimentId, boolean>
	setExperimentEnabled: SetExperimentEnabled
}

export const ExperimentalSettings = ({
	setCachedStateField,
	experiments,
	setExperimentEnabled,
	className,
	...props
}: ExperimentalSettingsProps) => {
	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<FlaskConical className="w-4" />
					<div>Experimental Features</div>
				</div>
			</SectionHeader>

			<Section>
				{Object.entries(experimentConfigsMap)
					.filter((config) => config[0] !== "DIFF_STRATEGY" && config[0] !== "MULTI_SEARCH_AND_REPLACE")
					.map((config) => (
						<ExperimentalFeature
							key={config[0]}
							{...config[1]}
							enabled={experiments[EXPERIMENT_IDS[config[0] as keyof typeof EXPERIMENT_IDS]] ?? false}
							onChange={(enabled) =>
								setExperimentEnabled(EXPERIMENT_IDS[config[0] as keyof typeof EXPERIMENT_IDS], enabled)
							}
						/>
					))}
			</Section>
		</div>
	)
}
