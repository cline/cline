import { HTMLAttributes } from "react"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { Database } from "lucide-react"

import { cn } from "@/lib/utils"

import { SetCachedStateField } from "./types"
import { sliderLabelStyle } from "./styles"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"

type ContextManagementSettingsProps = HTMLAttributes<HTMLDivElement> & {
	terminalOutputLineLimit?: number
	maxOpenTabsContext: number
	maxWorkspaceFiles: number
	showRooIgnoredFiles?: boolean
	setCachedStateField: SetCachedStateField<
		"terminalOutputLineLimit" | "maxOpenTabsContext" | "maxWorkspaceFiles" | "showRooIgnoredFiles"
	>
}

export const ContextManagementSettings = ({
	terminalOutputLineLimit,
	maxOpenTabsContext,
	maxWorkspaceFiles,
	showRooIgnoredFiles,
	setCachedStateField,
	className,
	...props
}: ContextManagementSettingsProps) => {
	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			<SectionHeader description="Control what information is included in the AI's context window, affecting token usage and response quality">
				<div className="flex items-center gap-2">
					<Database className="w-4" />
					<div>Context Management</div>
				</div>
			</SectionHeader>

			<Section>
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
								data-testid="terminal-output-limit-slider"
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
								data-testid="open-tabs-limit-slider"
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
					<div className="flex flex-col gap-2">
						<span className="font-medium">Workspace files context limit</span>
						<div className="flex items-center gap-2">
							<input
								type="range"
								min="0"
								max="500"
								step="1"
								value={maxWorkspaceFiles ?? 200}
								onChange={(e) => setCachedStateField("maxWorkspaceFiles", parseInt(e.target.value))}
								className="h-2 focus:outline-0 w-4/5 accent-vscode-button-background"
								data-testid="workspace-files-limit-slider"
							/>
							<span style={{ ...sliderLabelStyle }}>{maxWorkspaceFiles ?? 200}</span>
						</div>
					</div>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						Maximum number of files to include in current working directory details. Higher values provide
						more context but increase token usage.
					</p>
				</div>

				<div>
					<VSCodeCheckbox
						checked={showRooIgnoredFiles}
						onChange={(e: any) => {
							setCachedStateField("showRooIgnoredFiles", e.target.checked)
						}}
						data-testid="show-rooignored-files-checkbox">
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
