import { useState, useCallback, useEffect } from "react"
import { useEvent } from "react-use"
import { Checkbox } from "vscrui"
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import {
	type ProviderSettings,
	type ModelInfo,
	type ReasoningEffort,
	type OrganizationAllowList,
	azureOpenAiDefaultApiVersion,
	openAiModelInfoSaneDefaults,
} from "@roo-code/types"

import { ExtensionMessage } from "@roo/ExtensionMessage"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Button, StandardTooltip } from "@src/components/ui"

import { convertHeadersToObject } from "../utils/headers"
import { inputEventTransform, noTransform } from "../transforms"
import { ModelPicker } from "../ModelPicker"
import { R1FormatSetting } from "../R1FormatSetting"
import { ThinkingBudget } from "../ThinkingBudget"

type OpenAICompatibleProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
}

export const OpenAICompatible = ({
	apiConfiguration,
	setApiConfigurationField,
	organizationAllowList,
	modelValidationError,
}: OpenAICompatibleProps) => {
	const { t } = useAppTranslation()

	const [azureApiVersionSelected, setAzureApiVersionSelected] = useState(!!apiConfiguration?.azureApiVersion)
	const [openAiLegacyFormatSelected, setOpenAiLegacyFormatSelected] = useState(!!apiConfiguration?.openAiLegacyFormat)

	const [openAiModels, setOpenAiModels] = useState<Record<string, ModelInfo> | null>(null)

	const [customHeaders, setCustomHeaders] = useState<[string, string][]>(() => {
		const headers = apiConfiguration?.openAiHeaders || {}
		return Object.entries(headers)
	})

	const handleAddCustomHeader = useCallback(() => {
		// Only update the local state to show the new row in the UI.
		setCustomHeaders((prev) => [...prev, ["", ""]])
		// Do not update the main configuration yet, wait for user input.
	}, [])

	const handleUpdateHeaderKey = useCallback((index: number, newKey: string) => {
		setCustomHeaders((prev) => {
			const updated = [...prev]

			if (updated[index]) {
				updated[index] = [newKey, updated[index][1]]
			}

			return updated
		})
	}, [])

	const handleUpdateHeaderValue = useCallback((index: number, newValue: string) => {
		setCustomHeaders((prev) => {
			const updated = [...prev]

			if (updated[index]) {
				updated[index] = [updated[index][0], newValue]
			}

			return updated
		})
	}, [])

	const handleRemoveCustomHeader = useCallback((index: number) => {
		setCustomHeaders((prev) => prev.filter((_, i) => i !== index))
	}, [])

	// Helper to convert array of tuples to object

	// Add effect to update the parent component's state when local headers change
	useEffect(() => {
		const timer = setTimeout(() => {
			const headerObject = convertHeadersToObject(customHeaders)
			setApiConfigurationField("openAiHeaders", headerObject)
		}, 300)

		return () => clearTimeout(timer)
	}, [customHeaders, setApiConfigurationField])

	const handleInputChange = useCallback(
		<K extends keyof ProviderSettings, E>(
			field: K,
			transform: (event: E) => ProviderSettings[K] = inputEventTransform,
		) =>
			(event: E | Event) => {
				setApiConfigurationField(field, transform(event as E))
			},
		[setApiConfigurationField],
	)

	const onMessage = useCallback((event: MessageEvent) => {
		const message: ExtensionMessage = event.data

		switch (message.type) {
			case "openAiModels": {
				const updatedModels = message.openAiModels ?? []
				setOpenAiModels(Object.fromEntries(updatedModels.map((item) => [item, openAiModelInfoSaneDefaults])))
				break
			}
		}
	}, [])

	useEvent("message", onMessage)

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.openAiBaseUrl || ""}
				type="url"
				onInput={handleInputChange("openAiBaseUrl")}
				placeholder={t("settings:placeholders.baseUrl")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.openAiBaseUrl")}</label>
			</VSCodeTextField>
			<VSCodeTextField
				value={apiConfiguration?.openAiApiKey || ""}
				type="password"
				onInput={handleInputChange("openAiApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.apiKey")}</label>
			</VSCodeTextField>
			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId="gpt-4o"
				models={openAiModels}
				modelIdKey="openAiModelId"
				serviceName="OpenAI"
				serviceUrl="https://platform.openai.com"
				organizationAllowList={organizationAllowList}
				errorMessage={modelValidationError}
			/>
			<R1FormatSetting
				onChange={handleInputChange("openAiR1FormatEnabled", noTransform)}
				openAiR1FormatEnabled={apiConfiguration?.openAiR1FormatEnabled ?? false}
			/>
			<div>
				<Checkbox
					checked={openAiLegacyFormatSelected}
					onChange={(checked: boolean) => {
						setOpenAiLegacyFormatSelected(checked)
						setApiConfigurationField("openAiLegacyFormat", checked)
					}}>
					{t("settings:providers.useLegacyFormat")}
				</Checkbox>
			</div>
			<Checkbox
				checked={apiConfiguration?.openAiStreamingEnabled ?? true}
				onChange={handleInputChange("openAiStreamingEnabled", noTransform)}>
				{t("settings:modelInfo.enableStreaming")}
			</Checkbox>
			<div>
				<Checkbox
					checked={apiConfiguration?.includeMaxTokens ?? true}
					onChange={handleInputChange("includeMaxTokens", noTransform)}>
					{t("settings:includeMaxOutputTokens")}
				</Checkbox>
				<div className="text-sm text-vscode-descriptionForeground ml-6">
					{t("settings:includeMaxOutputTokensDescription")}
				</div>
			</div>
			<Checkbox
				checked={apiConfiguration?.openAiUseAzure ?? false}
				onChange={handleInputChange("openAiUseAzure", noTransform)}>
				{t("settings:modelInfo.useAzure")}
			</Checkbox>
			<div>
				<Checkbox
					checked={azureApiVersionSelected}
					onChange={(checked: boolean) => {
						setAzureApiVersionSelected(checked)

						if (!checked) {
							setApiConfigurationField("azureApiVersion", "")
						}
					}}>
					{t("settings:modelInfo.azureApiVersion")}
				</Checkbox>
				{azureApiVersionSelected && (
					<VSCodeTextField
						value={apiConfiguration?.azureApiVersion || ""}
						onInput={handleInputChange("azureApiVersion")}
						placeholder={`Default: ${azureOpenAiDefaultApiVersion}`}
						className="w-full mt-1"
					/>
				)}
			</div>

			{/* Custom Headers UI */}
			<div className="mb-4">
				<div className="flex justify-between items-center mb-2">
					<label className="block font-medium">{t("settings:providers.customHeaders")}</label>
					<StandardTooltip content={t("settings:common.add")}>
						<VSCodeButton appearance="icon" onClick={handleAddCustomHeader}>
							<span className="codicon codicon-add"></span>
						</VSCodeButton>
					</StandardTooltip>
				</div>
				{!customHeaders.length ? (
					<div className="text-sm text-vscode-descriptionForeground">
						{t("settings:providers.noCustomHeaders")}
					</div>
				) : (
					customHeaders.map(([key, value], index) => (
						<div key={index} className="flex items-center mb-2">
							<VSCodeTextField
								value={key}
								className="flex-1 mr-2"
								placeholder={t("settings:providers.headerName")}
								onInput={(e: any) => handleUpdateHeaderKey(index, e.target.value)}
							/>
							<VSCodeTextField
								value={value}
								className="flex-1 mr-2"
								placeholder={t("settings:providers.headerValue")}
								onInput={(e: any) => handleUpdateHeaderValue(index, e.target.value)}
							/>
							<StandardTooltip content={t("settings:common.remove")}>
								<VSCodeButton appearance="icon" onClick={() => handleRemoveCustomHeader(index)}>
									<span className="codicon codicon-trash"></span>
								</VSCodeButton>
							</StandardTooltip>
						</div>
					))
				)}
			</div>

			<div className="flex flex-col gap-1">
				<Checkbox
					checked={apiConfiguration.enableReasoningEffort ?? false}
					onChange={(checked: boolean) => {
						setApiConfigurationField("enableReasoningEffort", checked)

						if (!checked) {
							const { reasoningEffort: _, ...openAiCustomModelInfo } =
								apiConfiguration.openAiCustomModelInfo || openAiModelInfoSaneDefaults

							setApiConfigurationField("openAiCustomModelInfo", openAiCustomModelInfo)
						}
					}}>
					{t("settings:providers.setReasoningLevel")}
				</Checkbox>
				{!!apiConfiguration.enableReasoningEffort && (
					<ThinkingBudget
						apiConfiguration={{
							...apiConfiguration,
							reasoningEffort: apiConfiguration.openAiCustomModelInfo?.reasoningEffort,
						}}
						setApiConfigurationField={(field, value) => {
							if (field === "reasoningEffort") {
								const openAiCustomModelInfo =
									apiConfiguration.openAiCustomModelInfo || openAiModelInfoSaneDefaults

								setApiConfigurationField("openAiCustomModelInfo", {
									...openAiCustomModelInfo,
									reasoningEffort: value as ReasoningEffort,
								})
							}
						}}
						modelInfo={{
							...(apiConfiguration.openAiCustomModelInfo || openAiModelInfoSaneDefaults),
							supportsReasoningEffort: true,
						}}
					/>
				)}
			</div>
			<div className="flex flex-col gap-3">
				<div className="text-sm text-vscode-descriptionForeground whitespace-pre-line">
					{t("settings:providers.customModel.capabilities")}
				</div>

				<div>
					<VSCodeTextField
						value={
							apiConfiguration?.openAiCustomModelInfo?.maxTokens?.toString() ||
							openAiModelInfoSaneDefaults.maxTokens?.toString() ||
							""
						}
						type="text"
						style={{
							borderColor: (() => {
								const value = apiConfiguration?.openAiCustomModelInfo?.maxTokens

								if (!value) {
									return "var(--vscode-input-border)"
								}

								return value > 0 ? "var(--vscode-charts-green)" : "var(--vscode-errorForeground)"
							})(),
						}}
						onInput={handleInputChange("openAiCustomModelInfo", (e) => {
							const value = parseInt((e.target as HTMLInputElement).value)

							return {
								...(apiConfiguration?.openAiCustomModelInfo || openAiModelInfoSaneDefaults),
								maxTokens: isNaN(value) ? undefined : value,
							}
						})}
						placeholder={t("settings:placeholders.numbers.maxTokens")}
						className="w-full">
						<label className="block font-medium mb-1">
							{t("settings:providers.customModel.maxTokens.label")}
						</label>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground">
						{t("settings:providers.customModel.maxTokens.description")}
					</div>
				</div>

				<div>
					<VSCodeTextField
						value={
							apiConfiguration?.openAiCustomModelInfo?.contextWindow?.toString() ||
							openAiModelInfoSaneDefaults.contextWindow?.toString() ||
							""
						}
						type="text"
						style={{
							borderColor: (() => {
								const value = apiConfiguration?.openAiCustomModelInfo?.contextWindow

								if (!value) {
									return "var(--vscode-input-border)"
								}

								return value > 0 ? "var(--vscode-charts-green)" : "var(--vscode-errorForeground)"
							})(),
						}}
						onInput={handleInputChange("openAiCustomModelInfo", (e) => {
							const value = (e.target as HTMLInputElement).value
							const parsed = parseInt(value)

							return {
								...(apiConfiguration?.openAiCustomModelInfo || openAiModelInfoSaneDefaults),
								contextWindow: isNaN(parsed) ? openAiModelInfoSaneDefaults.contextWindow : parsed,
							}
						})}
						placeholder={t("settings:placeholders.numbers.contextWindow")}
						className="w-full">
						<label className="block font-medium mb-1">
							{t("settings:providers.customModel.contextWindow.label")}
						</label>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground">
						{t("settings:providers.customModel.contextWindow.description")}
					</div>
				</div>

				<div>
					<div className="flex items-center gap-1">
						<Checkbox
							checked={
								apiConfiguration?.openAiCustomModelInfo?.supportsImages ??
								openAiModelInfoSaneDefaults.supportsImages
							}
							onChange={handleInputChange("openAiCustomModelInfo", (checked) => {
								return {
									...(apiConfiguration?.openAiCustomModelInfo || openAiModelInfoSaneDefaults),
									supportsImages: checked,
								}
							})}>
							<span className="font-medium">
								{t("settings:providers.customModel.imageSupport.label")}
							</span>
						</Checkbox>
						<StandardTooltip content={t("settings:providers.customModel.imageSupport.description")}>
							<i
								className="codicon codicon-info text-vscode-descriptionForeground"
								style={{ fontSize: "12px" }}
							/>
						</StandardTooltip>
					</div>
					<div className="text-sm text-vscode-descriptionForeground pt-1">
						{t("settings:providers.customModel.imageSupport.description")}
					</div>
				</div>

				<div>
					<div className="flex items-center gap-1">
						<Checkbox
							checked={apiConfiguration?.openAiCustomModelInfo?.supportsComputerUse ?? false}
							onChange={handleInputChange("openAiCustomModelInfo", (checked) => {
								return {
									...(apiConfiguration?.openAiCustomModelInfo || openAiModelInfoSaneDefaults),
									supportsComputerUse: checked,
								}
							})}>
							<span className="font-medium">{t("settings:providers.customModel.computerUse.label")}</span>
						</Checkbox>
						<StandardTooltip content={t("settings:providers.customModel.computerUse.description")}>
							<i
								className="codicon codicon-info text-vscode-descriptionForeground"
								style={{ fontSize: "12px" }}
							/>
						</StandardTooltip>
					</div>
					<div className="text-sm text-vscode-descriptionForeground pt-1">
						{t("settings:providers.customModel.computerUse.description")}
					</div>
				</div>

				<div>
					<div className="flex items-center gap-1">
						<Checkbox
							checked={apiConfiguration?.openAiCustomModelInfo?.supportsPromptCache ?? false}
							onChange={handleInputChange("openAiCustomModelInfo", (checked) => {
								return {
									...(apiConfiguration?.openAiCustomModelInfo || openAiModelInfoSaneDefaults),
									supportsPromptCache: checked,
								}
							})}>
							<span className="font-medium">{t("settings:providers.customModel.promptCache.label")}</span>
						</Checkbox>
						<StandardTooltip content={t("settings:providers.customModel.promptCache.description")}>
							<i
								className="codicon codicon-info text-vscode-descriptionForeground"
								style={{ fontSize: "12px" }}
							/>
						</StandardTooltip>
					</div>
					<div className="text-sm text-vscode-descriptionForeground pt-1">
						{t("settings:providers.customModel.promptCache.description")}
					</div>
				</div>

				<div>
					<VSCodeTextField
						value={
							apiConfiguration?.openAiCustomModelInfo?.inputPrice?.toString() ??
							openAiModelInfoSaneDefaults.inputPrice?.toString() ??
							""
						}
						type="text"
						style={{
							borderColor: (() => {
								const value = apiConfiguration?.openAiCustomModelInfo?.inputPrice

								if (!value && value !== 0) {
									return "var(--vscode-input-border)"
								}

								return value >= 0 ? "var(--vscode-charts-green)" : "var(--vscode-errorForeground)"
							})(),
						}}
						onChange={handleInputChange("openAiCustomModelInfo", (e) => {
							const value = (e.target as HTMLInputElement).value
							const parsed = parseFloat(value)

							return {
								...(apiConfiguration?.openAiCustomModelInfo ?? openAiModelInfoSaneDefaults),
								inputPrice: isNaN(parsed) ? openAiModelInfoSaneDefaults.inputPrice : parsed,
							}
						})}
						placeholder={t("settings:placeholders.numbers.inputPrice")}
						className="w-full">
						<div className="flex items-center gap-1">
							<label className="block font-medium mb-1">
								{t("settings:providers.customModel.pricing.input.label")}
							</label>
							<StandardTooltip content={t("settings:providers.customModel.pricing.input.description")}>
								<i
									className="codicon codicon-info text-vscode-descriptionForeground"
									style={{ fontSize: "12px" }}
								/>
							</StandardTooltip>
						</div>
					</VSCodeTextField>
				</div>

				<div>
					<VSCodeTextField
						value={
							apiConfiguration?.openAiCustomModelInfo?.outputPrice?.toString() ||
							openAiModelInfoSaneDefaults.outputPrice?.toString() ||
							""
						}
						type="text"
						style={{
							borderColor: (() => {
								const value = apiConfiguration?.openAiCustomModelInfo?.outputPrice

								if (!value && value !== 0) {
									return "var(--vscode-input-border)"
								}

								return value >= 0 ? "var(--vscode-charts-green)" : "var(--vscode-errorForeground)"
							})(),
						}}
						onChange={handleInputChange("openAiCustomModelInfo", (e) => {
							const value = (e.target as HTMLInputElement).value
							const parsed = parseFloat(value)

							return {
								...(apiConfiguration?.openAiCustomModelInfo || openAiModelInfoSaneDefaults),
								outputPrice: isNaN(parsed) ? openAiModelInfoSaneDefaults.outputPrice : parsed,
							}
						})}
						placeholder={t("settings:placeholders.numbers.outputPrice")}
						className="w-full">
						<div className="flex items-center gap-1">
							<label className="block font-medium mb-1">
								{t("settings:providers.customModel.pricing.output.label")}
							</label>
							<StandardTooltip content={t("settings:providers.customModel.pricing.output.description")}>
								<i
									className="codicon codicon-info text-vscode-descriptionForeground"
									style={{ fontSize: "12px" }}
								/>
							</StandardTooltip>
						</div>
					</VSCodeTextField>
				</div>

				{apiConfiguration?.openAiCustomModelInfo?.supportsPromptCache && (
					<>
						<div>
							<VSCodeTextField
								value={apiConfiguration?.openAiCustomModelInfo?.cacheReadsPrice?.toString() ?? "0"}
								type="text"
								style={{
									borderColor: (() => {
										const value = apiConfiguration?.openAiCustomModelInfo?.cacheReadsPrice

										if (!value && value !== 0) {
											return "var(--vscode-input-border)"
										}

										return value >= 0
											? "var(--vscode-charts-green)"
											: "var(--vscode-errorForeground)"
									})(),
								}}
								onChange={handleInputChange("openAiCustomModelInfo", (e) => {
									const value = (e.target as HTMLInputElement).value
									const parsed = parseFloat(value)

									return {
										...(apiConfiguration?.openAiCustomModelInfo ?? openAiModelInfoSaneDefaults),
										cacheReadsPrice: isNaN(parsed) ? 0 : parsed,
									}
								})}
								placeholder={t("settings:placeholders.numbers.inputPrice")}
								className="w-full">
								<div className="flex items-center gap-1">
									<span className="font-medium">
										{t("settings:providers.customModel.pricing.cacheReads.label")}
									</span>
									<StandardTooltip
										content={t("settings:providers.customModel.pricing.cacheReads.description")}>
										<i
											className="codicon codicon-info text-vscode-descriptionForeground"
											style={{ fontSize: "12px" }}
										/>
									</StandardTooltip>
								</div>
							</VSCodeTextField>
						</div>
						<div>
							<VSCodeTextField
								value={apiConfiguration?.openAiCustomModelInfo?.cacheWritesPrice?.toString() ?? "0"}
								type="text"
								style={{
									borderColor: (() => {
										const value = apiConfiguration?.openAiCustomModelInfo?.cacheWritesPrice

										if (!value && value !== 0) {
											return "var(--vscode-input-border)"
										}

										return value >= 0
											? "var(--vscode-charts-green)"
											: "var(--vscode-errorForeground)"
									})(),
								}}
								onChange={handleInputChange("openAiCustomModelInfo", (e) => {
									const value = (e.target as HTMLInputElement).value
									const parsed = parseFloat(value)

									return {
										...(apiConfiguration?.openAiCustomModelInfo ?? openAiModelInfoSaneDefaults),
										cacheWritesPrice: isNaN(parsed) ? 0 : parsed,
									}
								})}
								placeholder={t("settings:placeholders.numbers.cacheWritePrice")}
								className="w-full">
								<div className="flex items-center gap-1">
									<label className="block font-medium mb-1">
										{t("settings:providers.customModel.pricing.cacheWrites.label")}
									</label>
									<StandardTooltip
										content={t("settings:providers.customModel.pricing.cacheWrites.description")}>
										<i
											className="codicon codicon-info text-vscode-descriptionForeground"
											style={{ fontSize: "12px" }}
										/>
									</StandardTooltip>
								</div>
							</VSCodeTextField>
						</div>
					</>
				)}

				<Button
					variant="secondary"
					onClick={() => setApiConfigurationField("openAiCustomModelInfo", openAiModelInfoSaneDefaults)}>
					{t("settings:providers.customModel.resetDefaults")}
				</Button>
			</div>
		</>
	)
}
