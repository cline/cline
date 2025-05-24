import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { Database } from "lucide-react"

import { cn } from "@/lib/utils"
import { Input, Slider } from "@/components/ui"

import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"

type ContextManagementSettingsProps = HTMLAttributes<HTMLDivElement> & {
	maxOpenTabsContext: number
	maxWorkspaceFiles: number
	showRooIgnoredFiles?: boolean
	maxReadFileLine?: number
	setCachedStateField: SetCachedStateField<
		"maxOpenTabsContext" | "maxWorkspaceFiles" | "showRooIgnoredFiles" | "maxReadFileLine"
	>
}

export const ContextManagementSettings = ({
	maxOpenTabsContext,
	maxWorkspaceFiles,
	showRooIgnoredFiles,
	setCachedStateField,
	maxReadFileLine,
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
					<span className="block font-medium mb-1">{t("settings:contextManagement.openTabs.label")}</span>
					<div className="flex items-center gap-2">
						<Slider
							min={0}
							max={500}
							step={1}
							value={[maxOpenTabsContext ?? 20]}
							onValueChange={([value]) => setCachedStateField("maxOpenTabsContext", value)}
							data-testid="open-tabs-limit-slider"
						/>
						<span className="w-10">{maxOpenTabsContext ?? 20}</span>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:contextManagement.openTabs.description")}
					</div>
				</div>

				<div>
					<span className="block font-medium mb-1">
						{t("settings:contextManagement.workspaceFiles.label")}
					</span>
					<div className="flex items-center gap-2">
						<Slider
							min={0}
							max={500}
							step={1}
							value={[maxWorkspaceFiles ?? 200]}
							onValueChange={([value]) => setCachedStateField("maxWorkspaceFiles", value)}
							data-testid="workspace-files-limit-slider"
						/>
						<span className="w-10">{maxWorkspaceFiles ?? 200}</span>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:contextManagement.workspaceFiles.description")}
					</div>
				</div>

				<div>
					<VSCodeCheckbox
						checked={showRooIgnoredFiles}
						onChange={(e: any) => setCachedStateField("showRooIgnoredFiles", e.target.checked)}
						data-testid="show-rooignored-files-checkbox">
						<label className="block font-medium mb-1">
							{t("settings:contextManagement.rooignore.label")}
						</label>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:contextManagement.rooignore.description")}
					</div>
				</div>

				<div>
					<div className="flex flex-col gap-2">
						<span className="font-medium">{t("settings:contextManagement.maxReadFile.label")}</span>
						<div className="flex items-center gap-4">
							<Input
								type="number"
								pattern="-?[0-9]*"
								className="w-24 bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border px-2 py-1 rounded text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none disabled:opacity-50"
								value={maxReadFileLine ?? -1}
								min={-1}
								onChange={(e) => {
									const newValue = parseInt(e.target.value, 10)
									if (!isNaN(newValue) && newValue >= -1) {
										setCachedStateField("maxReadFileLine", newValue)
									}
								}}
								onClick={(e) => e.currentTarget.select()}
								data-testid="max-read-file-line-input"
								disabled={maxReadFileLine === -1}
							/>
							<span>{t("settings:contextManagement.maxReadFile.lines")}</span>
							<VSCodeCheckbox
								checked={maxReadFileLine === -1}
								onChange={(e: any) =>
									setCachedStateField("maxReadFileLine", e.target.checked ? -1 : 500)
								}
								data-testid="max-read-file-always-full-checkbox">
								{t("settings:contextManagement.maxReadFile.always_full_read")}
							</VSCodeCheckbox>
						</div>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-2">
						{t("settings:contextManagement.maxReadFile.description")}
					</div>
				</div>
			</Section>
		</div>
	)
}
