import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox, VSCodeTextArea } from "@vscode/webview-ui-toolkit/react"
import { Database, FoldVertical } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Slider } from "@/components/ui"

import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { vscode } from "@/utils/vscode"

const SUMMARY_PROMPT = `\
Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing with the conversation and supporting any continuing tasks.

Your summary should be structured as follows:
Context: The context to continue the conversation with. If applicable based on the current task, this should include:
  1. Previous Conversation: High level details about what was discussed throughout the entire conversation with the user. This should be written to allow someone to be able to follow the general overarching conversation flow.
  2. Current Work: Describe in detail what was being worked on prior to this request to summarize the conversation. Pay special attention to the more recent messages in the conversation.
  3. Key Technical Concepts: List all important technical concepts, technologies, coding conventions, and frameworks discussed, which might be relevant for continuing with this work.
  4. Relevant Files and Code: If applicable, enumerate specific files and code sections examined, modified, or created for the task continuation. Pay special attention to the most recent messages and changes.
  5. Problem Solving: Document problems solved thus far and any ongoing troubleshooting efforts.
  6. Pending Tasks and Next Steps: Outline all pending tasks that you have explicitly been asked to work on, as well as list the next steps you will take for all outstanding work, if applicable. Include code snippets where they add clarity. For any next steps, include direct quotes from the most recent conversation showing exactly what task you were working on and where you left off. This should be verbatim to ensure there's no information loss in context between tasks.

Example summary structure:
1. Previous Conversation:
  [Detailed description]
2. Current Work:
  [Detailed description]
3. Key Technical Concepts:
  - [Concept 1]
  - [Concept 2]
  - [...]
4. Relevant Files and Code:
  - [File Name 1]
	- [Summary of why this file is important]
	- [Summary of the changes made to this file, if any]
	- [Important Code Snippet]
  - [File Name 2]
	- [Important Code Snippet]
  - [...]
5. Problem Solving:
  [Detailed description]
6. Pending Tasks and Next Steps:
  - [Task 1 details & next steps]
  - [Task 2 details & next steps]
  - [...]

Output only the summary of the conversation so far, without any additional commentary or explanation.
`

type ContextManagementSettingsProps = HTMLAttributes<HTMLDivElement> & {
	autoCondenseContext: boolean
	autoCondenseContextPercent: number
	condensingApiConfigId?: string
	customCondensingPrompt?: string
	listApiConfigMeta: any[]
	maxOpenTabsContext: number
	maxWorkspaceFiles: number
	showRooIgnoredFiles?: boolean
	maxReadFileLine?: number
	setCachedStateField: SetCachedStateField<
		| "autoCondenseContext"
		| "autoCondenseContextPercent"
		| "condensingApiConfigId"
		| "customCondensingPrompt"
		| "maxOpenTabsContext"
		| "maxWorkspaceFiles"
		| "showRooIgnoredFiles"
		| "maxReadFileLine"
	>
}

export const ContextManagementSettings = ({
	autoCondenseContext,
	autoCondenseContextPercent,
	condensingApiConfigId,
	customCondensingPrompt,
	listApiConfigMeta,
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

			<Section>
				<VSCodeCheckbox
					checked={autoCondenseContext}
					onChange={(e: any) => setCachedStateField("autoCondenseContext", e.target.checked)}
					data-testid="auto-condense-context-checkbox">
					<span className="font-medium">{t("settings:contextManagement.autoCondenseContext.name")}</span>
				</VSCodeCheckbox>
				{autoCondenseContext && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						<div className="flex items-center gap-4 font-bold">
							<FoldVertical size={16} />
							<div>{t("settings:contextManagement.autoCondenseContextPercent.label")}</div>
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
									data-testid="auto-condense-percent-slider"
								/>
								<span className="w-20">{autoCondenseContextPercent}%</span>
							</div>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:contextManagement.autoCondenseContextPercent.description")}
							</div>
						</div>

						{/* API Configuration Selection */}
						<div className="flex flex-col gap-3">
							<div className="flex items-center gap-4 font-bold">
								<span className="codicon codicon-settings-gear" />
								<div>{t("settings:contextManagement.condensingApiConfiguration.label")}</div>
							</div>
							<div>
								<div className="text-[13px] text-vscode-descriptionForeground mb-2">
									{t("settings:contextManagement.condensingApiConfiguration.description")}
								</div>
								<Select
									value={condensingApiConfigId || "-"}
									onValueChange={(value) => {
										const newConfigId = value === "-" ? "" : value
										setCachedStateField("condensingApiConfigId", newConfigId)
										vscode.postMessage({
											type: "condensingApiConfigId",
											text: newConfigId,
										})
									}}
									data-testid="condensing-api-config-select">
									<SelectTrigger className="w-full">
										<SelectValue
											placeholder={t(
												"settings:contextManagement.condensingApiConfiguration.useCurrentConfig",
											)}
										/>
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="-">
											{t(
												"settings:contextManagement.condensingApiConfiguration.useCurrentConfig",
											)}
										</SelectItem>
										{(listApiConfigMeta || []).map((config) => (
											<SelectItem key={config.id} value={config.id}>
												{config.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>

						{/* Custom Prompt Section */}
						<div className="flex flex-col gap-3">
							<div className="flex items-center gap-4 font-bold">
								<span className="codicon codicon-edit" />
								<div>{t("settings:contextManagement.customCondensingPrompt.label")}</div>
							</div>
							<div>
								<div className="text-[13px] text-vscode-descriptionForeground mb-2">
									{t("settings:contextManagement.customCondensingPrompt.description")}
								</div>
								<VSCodeTextArea
									resize="vertical"
									value={customCondensingPrompt || SUMMARY_PROMPT}
									onChange={(e) => {
										const value = (e.target as HTMLTextAreaElement).value
										setCachedStateField("customCondensingPrompt", value)
										vscode.postMessage({
											type: "updateCondensingPrompt",
											text: value,
										})
									}}
									rows={8}
									className="w-full font-mono text-sm"
								/>
								<div className="mt-2">
									<Button
										variant="secondary"
										size="sm"
										onClick={() => {
											setCachedStateField("customCondensingPrompt", SUMMARY_PROMPT)
											vscode.postMessage({
												type: "updateCondensingPrompt",
												text: SUMMARY_PROMPT,
											})
										}}>
										{t("settings:contextManagement.customCondensingPrompt.reset")}
									</Button>
								</div>
							</div>
						</div>
					</div>
				)}
			</Section>
		</div>
	)
}
