import React, { useState, useEffect } from "react"
import { VSCodeTextArea, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"

import { supportPrompt, SupportPromptType } from "@roo/support-prompt"

import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import {
	Button,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	StandardTooltip,
} from "@src/components/ui"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { MessageSquare } from "lucide-react"

interface PromptsSettingsProps {
	customSupportPrompts: Record<string, string | undefined>
	setCustomSupportPrompts: (prompts: Record<string, string | undefined>) => void
	includeTaskHistoryInEnhance?: boolean
	setIncludeTaskHistoryInEnhance?: (value: boolean) => void
}

const PromptsSettings = ({
	customSupportPrompts,
	setCustomSupportPrompts,
	includeTaskHistoryInEnhance: propsIncludeTaskHistoryInEnhance,
	setIncludeTaskHistoryInEnhance: propsSetIncludeTaskHistoryInEnhance,
}: PromptsSettingsProps) => {
	const { t } = useAppTranslation()
	const {
		listApiConfigMeta,
		enhancementApiConfigId,
		setEnhancementApiConfigId,
		condensingApiConfigId,
		setCondensingApiConfigId,
		customCondensingPrompt,
		setCustomCondensingPrompt,
		includeTaskHistoryInEnhance: contextIncludeTaskHistoryInEnhance,
		setIncludeTaskHistoryInEnhance: contextSetIncludeTaskHistoryInEnhance,
	} = useExtensionState()

	// Use props if provided, otherwise fall back to context
	const includeTaskHistoryInEnhance = propsIncludeTaskHistoryInEnhance ?? contextIncludeTaskHistoryInEnhance
	const setIncludeTaskHistoryInEnhance = propsSetIncludeTaskHistoryInEnhance ?? contextSetIncludeTaskHistoryInEnhance

	const [testPrompt, setTestPrompt] = useState("")
	const [isEnhancing, setIsEnhancing] = useState(false)
	const [activeSupportOption, setActiveSupportOption] = useState<SupportPromptType>("ENHANCE")

	useEffect(() => {
		const handler = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "enhancedPrompt") {
				if (message.text) {
					setTestPrompt(message.text)
				}
				setIsEnhancing(false)
			}
		}

		window.addEventListener("message", handler)
		return () => window.removeEventListener("message", handler)
	}, [])

	const updateSupportPrompt = (type: SupportPromptType, value: string | undefined) => {
		if (type === "CONDENSE") {
			setCustomCondensingPrompt(value || supportPrompt.default.CONDENSE)
			vscode.postMessage({
				type: "updateCondensingPrompt",
				text: value || supportPrompt.default.CONDENSE,
			})
		} else {
			const updatedPrompts = { ...customSupportPrompts, [type]: value }
			setCustomSupportPrompts(updatedPrompts)
		}
	}

	const handleSupportReset = (type: SupportPromptType) => {
		if (type === "CONDENSE") {
			setCustomCondensingPrompt(supportPrompt.default.CONDENSE)
			vscode.postMessage({
				type: "updateCondensingPrompt",
				text: supportPrompt.default.CONDENSE,
			})
		} else {
			const updatedPrompts = { ...customSupportPrompts }
			delete updatedPrompts[type]
			setCustomSupportPrompts(updatedPrompts)
		}
	}

	const getSupportPromptValue = (type: SupportPromptType): string => {
		if (type === "CONDENSE") {
			return customCondensingPrompt || supportPrompt.default.CONDENSE
		}
		return supportPrompt.get(customSupportPrompts, type)
	}

	const handleTestEnhancement = () => {
		if (!testPrompt.trim()) return

		setIsEnhancing(true)
		vscode.postMessage({
			type: "enhancePrompt",
			text: testPrompt,
		})
	}

	return (
		<div>
			<SectionHeader description={t("settings:prompts.description")}>
				<div className="flex items-center gap-2">
					<MessageSquare className="w-4" />
					<div>{t("settings:sections.prompts")}</div>
				</div>
			</SectionHeader>

			<Section>
				<div>
					<Select
						value={activeSupportOption}
						onValueChange={(type) => setActiveSupportOption(type as SupportPromptType)}>
						<SelectTrigger className="w-full" data-testid="support-prompt-select-trigger">
							<SelectValue placeholder={t("settings:common.select")} />
						</SelectTrigger>
						<SelectContent>
							{Object.keys(supportPrompt.default).map((type) => (
								<SelectItem key={type} value={type} data-testid={`${type}-option`}>
									{t(`prompts:supportPrompts.types.${type}.label`)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<div className="text-sm text-vscode-descriptionForeground mt-1">
						{t(`prompts:supportPrompts.types.${activeSupportOption}.description`)}
					</div>
				</div>

				<div key={activeSupportOption} className="mt-4">
					<div className="flex justify-between items-center mb-1">
						<label className="block font-medium">{t("prompts:supportPrompts.prompt")}</label>
						<StandardTooltip
							content={t("prompts:supportPrompts.resetPrompt", {
								promptType: activeSupportOption,
							})}>
							<Button variant="ghost" size="icon" onClick={() => handleSupportReset(activeSupportOption)}>
								<span className="codicon codicon-discard"></span>
							</Button>
						</StandardTooltip>
					</div>

					<VSCodeTextArea
						resize="vertical"
						value={getSupportPromptValue(activeSupportOption)}
						onChange={(e) => {
							const value =
								(e as unknown as CustomEvent)?.detail?.target?.value ||
								((e as any).target as HTMLTextAreaElement).value
							const trimmedValue = value.trim()
							updateSupportPrompt(activeSupportOption, trimmedValue || undefined)
						}}
						rows={6}
						className="w-full"
					/>

					{(activeSupportOption === "ENHANCE" || activeSupportOption === "CONDENSE") && (
						<div className="mt-4 flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
							<div>
								<label className="block font-medium mb-1">
									{activeSupportOption === "ENHANCE"
										? t("prompts:supportPrompts.enhance.apiConfiguration")
										: t("prompts:supportPrompts.condense.apiConfiguration")}
								</label>
								<Select
									value={
										activeSupportOption === "ENHANCE"
											? enhancementApiConfigId || "-"
											: condensingApiConfigId || "-"
									}
									onValueChange={(value) => {
										const newConfigId = value === "-" ? "" : value
										if (activeSupportOption === "ENHANCE") {
											setEnhancementApiConfigId(newConfigId)
											vscode.postMessage({
												type: "enhancementApiConfigId",
												text: value,
											})
										} else {
											setCondensingApiConfigId(newConfigId)
											vscode.postMessage({
												type: "condensingApiConfigId",
												text: newConfigId,
											})
										}
									}}>
									<SelectTrigger data-testid="api-config-select" className="w-full">
										<SelectValue
											placeholder={
												activeSupportOption === "ENHANCE"
													? t("prompts:supportPrompts.enhance.useCurrentConfig")
													: t("prompts:supportPrompts.condense.useCurrentConfig")
											}
										/>
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="-">
											{activeSupportOption === "ENHANCE"
												? t("prompts:supportPrompts.enhance.useCurrentConfig")
												: t("prompts:supportPrompts.condense.useCurrentConfig")}
										</SelectItem>
										{(listApiConfigMeta || []).map((config) => (
											<SelectItem
												key={config.id}
												value={config.id}
												data-testid={`${config.id}-option`}>
												{config.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<div className="text-sm text-vscode-descriptionForeground mt-1">
									{activeSupportOption === "ENHANCE"
										? t("prompts:supportPrompts.enhance.apiConfigDescription")
										: t("prompts:supportPrompts.condense.apiConfigDescription")}
								</div>
							</div>

							{activeSupportOption === "ENHANCE" && (
								<>
									<div>
										<VSCodeCheckbox
											checked={includeTaskHistoryInEnhance || false}
											onChange={(e: any) => {
												const value = e.target.checked
												setIncludeTaskHistoryInEnhance(value)
												vscode.postMessage({
													type: "includeTaskHistoryInEnhance",
													bool: value,
												})
											}}>
											<span className="font-medium">
												{t("prompts:supportPrompts.enhance.includeTaskHistory")}
											</span>
										</VSCodeCheckbox>
										<div className="text-vscode-descriptionForeground text-sm mt-1 mb-3">
											{t("prompts:supportPrompts.enhance.includeTaskHistoryDescription")}
										</div>
									</div>

									<div>
										<label className="block font-medium mb-1">
											{t("prompts:supportPrompts.enhance.testEnhancement")}
										</label>
										<VSCodeTextArea
											resize="vertical"
											value={testPrompt}
											onChange={(e) => setTestPrompt((e.target as HTMLTextAreaElement).value)}
											placeholder={t("prompts:supportPrompts.enhance.testPromptPlaceholder")}
											rows={3}
											className="w-full"
											data-testid="test-prompt-textarea"
										/>
										<div className="mt-2 flex justify-start items-center gap-2">
											<Button
												variant="default"
												onClick={handleTestEnhancement}
												disabled={isEnhancing}>
												{t("prompts:supportPrompts.enhance.previewButton")}
											</Button>
										</div>
									</div>
								</>
							)}
						</div>
					)}
				</div>
			</Section>
		</div>
	)
}

export default PromptsSettings
