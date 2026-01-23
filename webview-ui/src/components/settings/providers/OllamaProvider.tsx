import { StringRequest } from "@shared/proto/cline/common"
import { Mode } from "@shared/storage/types"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useInterval } from "react-use"
import UseCustomPromptCheckbox from "@/components/settings/UseCustomPromptCheckbox"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import OllamaModelPicker from "../OllamaModelPicker"
import { getModeSpecificFields } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the OllamaProvider component
 */
interface OllamaProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Ollama provider configuration component
 */
export const OllamaProvider = ({ showModelOptions, isPopup, currentMode }: OllamaProviderProps) => {
	const { t } = useTranslation()
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	const { ollamaModelId } = getModeSpecificFields(apiConfiguration, currentMode)

	const [ollamaModels, setOllamaModels] = useState<string[]>([])

	// Poll ollama models
	const requestOllamaModels = useCallback(async () => {
		try {
			const response = await ModelsServiceClient.getOllamaModels(
				StringRequest.create({
					value: apiConfiguration?.ollamaBaseUrl || "",
				}),
			)
			if (response && response.values) {
				setOllamaModels(response.values)
			}
		} catch (error) {
			console.error("Failed to fetch Ollama models:", error)
			setOllamaModels([])
		}
	}, [apiConfiguration?.ollamaBaseUrl])

	useEffect(() => {
		requestOllamaModels()
	}, [requestOllamaModels])

	useInterval(requestOllamaModels, 2000)

	return (
		<div className="flex flex-col gap-2">
			<BaseUrlField
				initialValue={apiConfiguration?.ollamaBaseUrl}
				label={t("providers.useCustomBaseUrl")}
				onChange={(value) => handleFieldChange("ollamaBaseUrl", value)}
				placeholder="Default: http://localhost:11434"
			/>

			{apiConfiguration?.ollamaBaseUrl && (
				<ApiKeyField
					helpText={t("providers.ollamaApiKeyHelp")}
					initialValue={apiConfiguration?.ollamaApiKey || ""}
					onChange={(value) => handleFieldChange("ollamaApiKey", value)}
					placeholder={t("providers.ollamaApiKeyPlaceholder")}
					providerName="Ollama"
				/>
			)}

			<label htmlFor="ollama-model-selection">
				<span className="font-semibold">{t("providers.model")}</span>
			</label>
			<OllamaModelPicker
				ollamaModels={ollamaModels}
				onModelChange={(modelId) => {
					handleModeFieldChange({ plan: "planModeOllamaModelId", act: "actModeOllamaModelId" }, modelId, currentMode)
				}}
				placeholder={
					ollamaModels.length > 0
						? t("providers.ollamaModelSearchPlaceholder")
						: t("providers.ollamaModelExamplePlaceholder")
				}
				selectedModelId={ollamaModelId || ""}
			/>

			{ollamaModels.length === 0 && (
				<p className="text-sm mt-1 text-description italic">{t("providers.unableToFetchModels")}</p>
			)}

			<DebouncedTextField
				initialValue={apiConfiguration?.ollamaApiOptionsCtxNum || "32768"}
				onChange={(v) => handleFieldChange("ollamaApiOptionsCtxNum", v || undefined)}
				placeholder={t("providers.ollamaContextPlaceholder")}
				style={{ width: "100%" }}>
				<span className="font-semibold">{t("providers.contextWindow")}</span>
			</DebouncedTextField>

			{showModelOptions && (
				<>
					<DebouncedTextField
						initialValue={apiConfiguration?.requestTimeoutMs ? apiConfiguration.requestTimeoutMs.toString() : "30000"}
						onChange={(value) => {
							const numValue = parseInt(value, 10)
							if (!Number.isNaN(numValue) && numValue > 0) {
								handleFieldChange("requestTimeoutMs", numValue)
							}
						}}
						placeholder={t("providers.ollamaTimeoutPlaceholder")}
						style={{ width: "100%" }}>
						<span className="font-semibold">{t("providers.requestTimeout")}</span>
					</DebouncedTextField>
					<p className="text-xs mt-0 text-description">{t("providers.maxTimeoutDescription")}</p>
				</>
			)}

			<UseCustomPromptCheckbox providerId="ollama" />

			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				{t("providers.ollamaDescription")}{" "}
				<VSCodeLink
					href="https://github.com/ollama/ollama/blob/main/README.md"
					style={{ display: "inline", fontSize: "inherit" }}>
					{t("providers.quickstartGuide")}
				</VSCodeLink>
				. <span style={{ color: "var(--vscode-errorForeground)" }}>({t("providers.noteComplexPrompts")})</span>
			</p>
		</div>
	)
}
