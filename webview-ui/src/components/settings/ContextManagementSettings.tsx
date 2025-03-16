import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
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
	const { t } = useAppTranslation()
	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			<SectionHeader description={t("settings:contextManagement.description")}>
				<div className="flex items-center gap-2">
					<Database className="w-4" />
					<div>{t("settings:sections.contextManagement")}</div>
				</div>
			</SectionHeader>

			<Section>
				<div>
					<div className="flex flex-col gap-2">
						<span className="font-medium">{t("settings:contextManagement.terminal.label")}</span>
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
						{t("settings:contextManagement.terminal.description")}
					</p>
				</div>

				<div>
					<div className="flex flex-col gap-2">
						<span className="font-medium">{t("settings:contextManagement.openTabs.label")}</span>
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
						{t("settings:contextManagement.openTabs.description")}
					</p>
				</div>

				<div>
					<div className="flex flex-col gap-2">
						<span className="font-medium">{t("settings:contextManagement.workspaceFiles.label")}</span>
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
						{t("settings:contextManagement.workspaceFiles.description")}
					</p>
				</div>

				<div>
					<VSCodeCheckbox
						checked={showRooIgnoredFiles}
						onChange={(e: any) => {
							setCachedStateField("showRooIgnoredFiles", e.target.checked)
						}}
						data-testid="show-rooignored-files-checkbox">
						<span className="font-medium">{t("settings:contextManagement.rooignore.label")}</span>
					</VSCodeCheckbox>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						{t("settings:contextManagement.rooignore.description")}
					</p>
				</div>
			</Section>
		</div>
	)
}
