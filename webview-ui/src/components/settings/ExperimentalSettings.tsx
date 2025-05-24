import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { FlaskConical } from "lucide-react"

import { EXPERIMENT_IDS, experimentConfigsMap, ExperimentId } from "@roo/shared/experiments"

import { cn } from "@/lib/utils"
import { vscode } from "@/utils/vscode"

import { SetCachedStateField, SetExperimentEnabled } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { ExperimentalFeature } from "./ExperimentalFeature"
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Slider } from "@/components/ui/"
import { VSCodeTextArea } from "@vscode/webview-ui-toolkit/react"
import { CodebaseIndexConfig, CodebaseIndexModels, ProviderSettings } from "../../../../src/schemas"
import { CodeIndexSettings } from "./CodeIndexSettings"
import { ExtensionStateContextType } from "../../context/ExtensionStateContext"

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

type ExperimentalSettingsProps = HTMLAttributes<HTMLDivElement> & {
	experiments: Record<ExperimentId, boolean>
	setExperimentEnabled: SetExperimentEnabled
	autoCondenseContextPercent: number
	setCachedStateField: SetCachedStateField<"autoCondenseContextPercent" | "codebaseIndexConfig">
	condensingApiConfigId?: string
	setCondensingApiConfigId: (value: string) => void
	customCondensingPrompt?: string
	setCustomCondensingPrompt: (value: string) => void
	listApiConfigMeta: any[]
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
	autoCondenseContextPercent,
	setCachedStateField,
	condensingApiConfigId,
	setCondensingApiConfigId,
	customCondensingPrompt,
	setCustomCondensingPrompt,
	listApiConfigMeta,
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

						{/* API Configuration Selection */}
						<div className="flex flex-col gap-3">
							<div className="flex items-center gap-4 font-bold">
								<span className="codicon codicon-settings-gear" />
								<div>{t("settings:experimental.condensingApiConfiguration.label")}</div>
							</div>
							<div>
								<div className="text-[13px] text-vscode-descriptionForeground mb-2">
									{t("settings:experimental.condensingApiConfiguration.description")}
								</div>
								<Select
									value={condensingApiConfigId || "-"}
									onValueChange={(value) => {
										const newConfigId = value === "-" ? "" : value
										setCondensingApiConfigId(newConfigId)
										vscode.postMessage({
											type: "condensingApiConfigId",
											text: newConfigId,
										})
									}}>
									<SelectTrigger className="w-full">
										<SelectValue
											placeholder={t(
												"settings:experimental.condensingApiConfiguration.useCurrentConfig",
											)}
										/>
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="-">
											{t("settings:experimental.condensingApiConfiguration.useCurrentConfig")}
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
								<div>{t("settings:experimental.customCondensingPrompt.label")}</div>
							</div>
							<div>
								<div className="text-[13px] text-vscode-descriptionForeground mb-2">
									{t("settings:experimental.customCondensingPrompt.description")}
								</div>
								<VSCodeTextArea
									resize="vertical"
									value={customCondensingPrompt || SUMMARY_PROMPT}
									onChange={(e) => {
										const value = (e.target as HTMLTextAreaElement).value
										setCustomCondensingPrompt(value)
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
											setCustomCondensingPrompt(SUMMARY_PROMPT)
											vscode.postMessage({
												type: "updateCondensingPrompt",
												text: SUMMARY_PROMPT,
											})
										}}>
										{t("settings:experimental.customCondensingPrompt.reset")}
									</Button>
								</div>
							</div>
						</div>
					</div>
				)}

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
