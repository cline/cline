import { HTMLAttributes } from "react"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { Cog } from "lucide-react"

import { EXPERIMENT_IDS, experimentConfigsMap, ExperimentId } from "../../../../src/shared/experiments"

import { cn } from "@/lib/utils"

import { SetCachedStateField, SetExperimentEnabled } from "./types"
import { sliderLabelStyle } from "./styles"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { ExperimentalFeature } from "./ExperimentalFeature"

type AdvancedSettingsProps = HTMLAttributes<HTMLDivElement> & {
	rateLimitSeconds: number
	terminalOutputLineLimit?: number
	maxOpenTabsContext: number
	diffEnabled?: boolean
	fuzzyMatchThreshold?: number
	setCachedStateField: SetCachedStateField<
		"rateLimitSeconds" | "terminalOutputLineLimit" | "maxOpenTabsContext" | "diffEnabled" | "fuzzyMatchThreshold"
	>
	experiments: Record<ExperimentId, boolean>
	setExperimentEnabled: SetExperimentEnabled
}

export const AdvancedSettings = ({
	rateLimitSeconds,
	terminalOutputLineLimit,
	maxOpenTabsContext,
	diffEnabled,
	fuzzyMatchThreshold,
	setCachedStateField,
	experiments,
	setExperimentEnabled,
	className,
	...props
}: AdvancedSettingsProps) => {
	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<Cog className="w-4" />
					<div>Advanced</div>
				</div>
			</SectionHeader>

			<Section>
				<div>
					<div className="flex flex-col gap-2">
						<span className="font-medium">Rate limit</span>
						<div className="flex items-center gap-2">
							<input
								type="range"
								min="0"
								max="60"
								step="1"
								value={rateLimitSeconds}
								onChange={(e) => setCachedStateField("rateLimitSeconds", parseInt(e.target.value))}
								className="h-2 focus:outline-0 w-4/5 accent-vscode-button-background"
							/>
							<span style={{ ...sliderLabelStyle }}>{rateLimitSeconds}s</span>
						</div>
					</div>
					<p className="text-vscode-descriptionForeground text-sm mt-0">Minimum time between API requests.</p>
				</div>

				<div>
					<div className="flex flex-col gap-2">
						<span className="font-medium">Terminal output limit</span>
						<div className="flex items-center gap-2">
							<input
								type="range"
								min="100"
								max="5000"
								step="100"
								value={terminalOutputLineLimit ?? 500}
								onChange={(e) =>
									setCachedStateField("terminalOutputLineLimit", parseInt(e.target.value))
								}
								className="h-2 focus:outline-0 w-4/5 accent-vscode-button-background"
							/>
							<span style={{ ...sliderLabelStyle }}>{terminalOutputLineLimit ?? 500}</span>
						</div>
					</div>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						Maximum number of lines to include in terminal output when executing commands. When exceeded
						lines will be removed from the middle, saving tokens.
					</p>
				</div>

				<div>
					<div className="flex flex-col gap-2">
						<span className="font-medium">Open tabs context limit</span>
						<div className="flex items-center gap-2">
							<input
								type="range"
								min="0"
								max="500"
								step="1"
								value={maxOpenTabsContext ?? 20}
								onChange={(e) => setCachedStateField("maxOpenTabsContext", parseInt(e.target.value))}
								className="h-2 focus:outline-0 w-4/5 accent-vscode-button-background"
							/>
							<span style={{ ...sliderLabelStyle }}>{maxOpenTabsContext ?? 20}</span>
						</div>
					</div>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						Maximum number of VSCode open tabs to include in context. Higher values provide more context but
						increase token usage.
					</p>
				</div>

				<div>
					<VSCodeCheckbox
						checked={diffEnabled}
						onChange={(e: any) => {
							setCachedStateField("diffEnabled", e.target.checked)
							if (!e.target.checked) {
								// Reset experimental strategy when diffs are disabled.
								setExperimentEnabled(EXPERIMENT_IDS.DIFF_STRATEGY, false)
							}
						}}>
						<span className="font-medium">Enable editing through diffs</span>
					</VSCodeCheckbox>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						When enabled, Roo will be able to edit files more quickly and will automatically reject
						truncated full-file writes. Works best with the latest Claude 3.7 Sonnet model.
					</p>
					{diffEnabled && (
						<div
							style={{
								display: "flex",
								flexDirection: "column",
								gap: "5px",
								marginTop: "10px",
								marginBottom: "10px",
								paddingLeft: "10px",
								borderLeft: "2px solid var(--vscode-button-background)",
							}}>
							<span className="font-medium">Match precision</span>
							<div className="flex items-center gap-2">
								<input
									type="range"
									min="0.8"
									max="1"
									step="0.005"
									value={fuzzyMatchThreshold ?? 1.0}
									onChange={(e) => {
										setCachedStateField("fuzzyMatchThreshold", parseFloat(e.target.value))
									}}
									className="h-2 focus:outline-0 w-4/5 accent-vscode-button-background"
								/>
								<span style={{ ...sliderLabelStyle }}>
									{Math.round((fuzzyMatchThreshold || 1) * 100)}%
								</span>
							</div>
							<p className="text-vscode-descriptionForeground text-sm mt-0">
								This slider controls how precisely code sections must match when applying diffs. Lower
								values allow more flexible matching but increase the risk of incorrect replacements. Use
								values below 100% with extreme caution.
							</p>
							<ExperimentalFeature
								key={EXPERIMENT_IDS.DIFF_STRATEGY}
								{...experimentConfigsMap.DIFF_STRATEGY}
								enabled={experiments[EXPERIMENT_IDS.DIFF_STRATEGY] ?? false}
								onChange={(enabled) => setExperimentEnabled(EXPERIMENT_IDS.DIFF_STRATEGY, enabled)}
							/>
						</div>
					)}
				</div>
			</Section>
		</div>
	)
}
