import { HTMLAttributes } from "react"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { Cog } from "lucide-react"

import { EXPERIMENT_IDS, ExperimentId } from "../../../../src/shared/experiments"

import { cn } from "@/lib/utils"

import { SetCachedStateField, SetExperimentEnabled } from "./types"
import { sliderLabelStyle } from "./styles"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"

type AdvancedSettingsProps = HTMLAttributes<HTMLDivElement> & {
	rateLimitSeconds: number
	terminalOutputLineLimit?: number
	terminalShellIntegrationTimeout?: number
	maxOpenTabsContext: number
	diffEnabled?: boolean
	fuzzyMatchThreshold?: number
	showRooIgnoredFiles?: boolean
	setCachedStateField: SetCachedStateField<
		| "rateLimitSeconds"
		| "terminalOutputLineLimit"
		| "terminalShellIntegrationTimeout"
		| "maxOpenTabsContext"
		| "diffEnabled"
		| "fuzzyMatchThreshold"
		| "showRooIgnoredFiles"
	>
	experiments: Record<ExperimentId, boolean>
	setExperimentEnabled: SetExperimentEnabled
}
export const AdvancedSettings = ({
	rateLimitSeconds,
	terminalOutputLineLimit,
	terminalShellIntegrationTimeout,
	maxOpenTabsContext,
	diffEnabled,
	fuzzyMatchThreshold,
	showRooIgnoredFiles,
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
						<span className="font-medium">Terminal shell integration timeout</span>
						<div className="flex items-center gap-2">
							<input
								type="range"
								min="1000"
								max="60000"
								step="1000"
								value={terminalShellIntegrationTimeout}
								onChange={(e) =>
									setCachedStateField("terminalShellIntegrationTimeout", parseInt(e.target.value))
								}
								className="h-2 focus:outline-0 w-4/5 accent-vscode-button-background"
							/>
							<span style={{ ...sliderLabelStyle }}>
								{(terminalShellIntegrationTimeout ?? 4000) / 1000}s
							</span>
						</div>
						<p className="text-vscode-descriptionForeground text-sm mt-0">
							Maximum time to wait for shell integration to initialize before executing commands. For
							users with long shell startup times, this value may need to be increased if you see "Shell
							Integration Unavailable" errors in the terminal.
						</p>
					</div>
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
								// Reset both experimental strategies when diffs are disabled.
								setExperimentEnabled(EXPERIMENT_IDS.DIFF_STRATEGY, false)
								setExperimentEnabled(EXPERIMENT_IDS.MULTI_SEARCH_AND_REPLACE, false)
							}
						}}>
						<span className="font-medium">Enable editing through diffs</span>
					</VSCodeCheckbox>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						When enabled, Roo will be able to edit files more quickly and will automatically reject
						truncated full-file writes. Works best with the latest Claude 3.7 Sonnet model.
					</p>
					{diffEnabled && (
						<div className="flex flex-col gap-2 mt-3 mb-2 pl-3 border-l-2 border-vscode-button-background">
							<div className="flex flex-col gap-2">
								<span className="font-medium">Diff strategy</span>
								<select
									value={
										experiments[EXPERIMENT_IDS.DIFF_STRATEGY]
											? "unified"
											: experiments[EXPERIMENT_IDS.MULTI_SEARCH_AND_REPLACE]
												? "multiBlock"
												: "standard"
									}
									onChange={(e) => {
										const value = e.target.value
										if (value === "standard") {
											setExperimentEnabled(EXPERIMENT_IDS.DIFF_STRATEGY, false)
											setExperimentEnabled(EXPERIMENT_IDS.MULTI_SEARCH_AND_REPLACE, false)
										} else if (value === "unified") {
											setExperimentEnabled(EXPERIMENT_IDS.DIFF_STRATEGY, true)
											setExperimentEnabled(EXPERIMENT_IDS.MULTI_SEARCH_AND_REPLACE, false)
										} else if (value === "multiBlock") {
											setExperimentEnabled(EXPERIMENT_IDS.DIFF_STRATEGY, false)
											setExperimentEnabled(EXPERIMENT_IDS.MULTI_SEARCH_AND_REPLACE, true)
										}
									}}
									className="p-2 rounded w-full bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border outline-none focus:border-vscode-focusBorder">
									<option value="standard">Standard (Single block)</option>
									<option value="multiBlock">Experimental: Multi-block diff</option>
									<option value="unified">Experimental: Unified diff</option>
								</select>
							</div>

							{/* Description for selected strategy */}
							<p className="text-vscode-descriptionForeground text-sm mt-1">
								{!experiments[EXPERIMENT_IDS.DIFF_STRATEGY] &&
									!experiments[EXPERIMENT_IDS.MULTI_SEARCH_AND_REPLACE] &&
									"Standard diff strategy applies changes to a single code block at a time."}
								{experiments[EXPERIMENT_IDS.DIFF_STRATEGY] &&
									"Unified diff strategy takes multiple approaches to applying diffs and chooses the best approach."}
								{experiments[EXPERIMENT_IDS.MULTI_SEARCH_AND_REPLACE] &&
									"Multi-block diff strategy allows updating multiple code blocks in a file in one request."}
							</p>

							{/* Match precision slider */}
							<span className="font-medium mt-3">Match precision</span>
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
						</div>
					)}
				</div>

				<div>
					<VSCodeCheckbox
						checked={showRooIgnoredFiles}
						onChange={(e: any) => {
							setCachedStateField("showRooIgnoredFiles", e.target.checked)
						}}>
						<span className="font-medium">Show .rooignore'd files in lists and searches</span>
					</VSCodeCheckbox>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						When enabled, files matching patterns in .rooignore will be shown in lists with a lock symbol.
						When disabled, these files will be completely hidden from file lists and searches.
					</p>
				</div>
			</Section>
		</div>
	)
}
