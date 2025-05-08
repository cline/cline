import { useState, useCallback } from "react"
import { useEvent } from "react-use"
import { Checkbox } from "vscrui"
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import { ModelInfo, ReasoningEffort as ReasoningEffortType } from "@roo/schemas"
import { ApiConfiguration, azureOpenAiDefaultApiVersion, openAiModelInfoSaneDefaults } from "@roo/shared/api"
import { ExtensionMessage } from "@roo/shared/ExtensionMessage"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Button } from "@src/components/ui"

import { inputEventTransform, noTransform } from "../transforms"
import { ModelPicker } from "../ModelPicker"
import { R1FormatSetting } from "../R1FormatSetting"
import { ReasoningEffort } from "../ReasoningEffort"

type OpenAICompatibleProps = {
	apiConfiguration: ApiConfiguration
	setApiConfigurationField: (field: keyof ApiConfiguration, value: ApiConfiguration[keyof ApiConfiguration]) => void
}

export const OpenAICompatible = ({ apiConfiguration, setApiConfigurationField }: OpenAICompatibleProps) => {
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

	const handleInputChange = useCallback(
		<K extends keyof ApiConfiguration, E>(
			field: K,
			transform: (event: E) => ApiConfiguration[K] = inputEventTransform,
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
				<label className="block font-medium mb-1">{t("settings:providers.openAiApiKey")}</label>
			</VSCodeTextField>
			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId="gpt-4o"
				models={openAiModels}
				modelIdKey="openAiModelId"
				serviceName="OpenAI"
				serviceUrl="https://platform.openai.com"
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
					<VSCodeButton appearance="icon" title={t("settings:common.add")} onClick={handleAddCustomHeader}>
						<span className="codicon codicon-add"></span>
					</VSCodeButton>
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
							<VSCodeButton
								appearance="icon"
								title={t("settings:common.remove")}
								onClick={() => handleRemoveCustomHeader(index)}>
								<span className="codicon codicon-trash"></span>
							</VSCodeButton>
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
					<ReasoningEffort
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
									reasoningEffort: value as ReasoningEffortType,
								})
							}
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
						title={t("settings:providers.customModel.maxTokens.description")}
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
						title={t("settings:providers.customModel.contextWindow.description")}
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
						<i
							className="codicon codicon-info text-vscode-descriptionForeground"
							title={t("settings:providers.customModel.imageSupport.description")}
							style={{ fontSize: "12px" }}
						/>
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
						<i
							className="codicon codicon-info text-vscode-descriptionForeground"
							title={t("settings:providers.customModel.computerUse.description")}
							style={{ fontSize: "12px" }}
						/>
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
						<i
							className="codicon codicon-info text-vscode-descriptionForeground"
							title={t("settings:providers.customModel.promptCache.description")}
							style={{ fontSize: "12px" }}
						/>
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
							<i
								className="codicon codicon-info text-vscode-descriptionForeground"
								title={t("settings:providers.customModel.pricing.input.description")}
								style={{ fontSize: "12px" }}
							/>
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
							<i
								className="codicon codicon-info text-vscode-descriptionForeground"
								title={t("settings:providers.customModel.pricing.output.description")}
								style={{ fontSize: "12px" }}
							/>
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
									<i
										className="codicon codicon-info text-vscode-descriptionForeground"
										title={t("settings:providers.customModel.pricing.cacheReads.description")}
										style={{ fontSize: "12px" }}
									/>
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
									<i
										className="codicon codicon-info text-vscode-descriptionForeground"
										title={t("settings:providers.customModel.pricing.cacheWrites.description")}
										style={{ fontSize: "12px" }}
									/>
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
