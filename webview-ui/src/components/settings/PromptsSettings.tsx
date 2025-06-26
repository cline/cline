import React, { useState, useEffect } from "react"
import { VSCodeTextArea } from "@vscode/webview-ui-toolkit/react"

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
}

const PromptsSettings = ({ customSupportPrompts, setCustomSupportPrompts }: PromptsSettingsProps) => {
	const { t } = useAppTranslation()
	const { listApiConfigMeta, enhancementApiConfigId, setEnhancementApiConfigId } = useExtensionState()

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
		const updatedPrompts = { ...customSupportPrompts, [type]: value }
		setCustomSupportPrompts(updatedPrompts)
	}

	const handleSupportReset = (type: SupportPromptType) => {
		const updatedPrompts = { ...customSupportPrompts }
		delete updatedPrompts[type]
		setCustomSupportPrompts(updatedPrompts)
	}

	const getSupportPromptValue = (type: SupportPromptType): string => {
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

					{activeSupportOption === "ENHANCE" && (
						<div className="mt-4 flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
							<div>
								<label className="block font-medium mb-1">
									{t("prompts:supportPrompts.enhance.apiConfiguration")}
								</label>
								<Select
									value={enhancementApiConfigId || "-"}
									onValueChange={(value) => {
										setEnhancementApiConfigId(value === "-" ? "" : value)
										vscode.postMessage({
											type: "enhancementApiConfigId",
											text: value,
										})
									}}>
									<SelectTrigger data-testid="api-config-select" className="w-full">
										<SelectValue
											placeholder={t("prompts:supportPrompts.enhance.useCurrentConfig")}
										/>
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="-">
											{t("prompts:supportPrompts.enhance.useCurrentConfig")}
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
									{t("prompts:supportPrompts.enhance.apiConfigDescription")}
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
									<Button variant="default" onClick={handleTestEnhancement} disabled={isEnhancing}>
										{t("prompts:supportPrompts.enhance.previewButton")}
									</Button>
								</div>
							</div>
						</div>
					)}
				</div>
			</Section>
		</div>
	)
}

export default PromptsSettings
