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
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()
	const { t } = useTranslation("common")

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
				label={t("api_provider.ollama.custom_base_url_label")}
				onChange={(value) => handleFieldChange("ollamaBaseUrl", value)}
				placeholder={t("api_provider.ollama.custom_base_url_placeholder")}
			/>

			{apiConfiguration?.ollamaBaseUrl && (
				<ApiKeyField
					helpText={t("api_provider.ollama.api_key_help_text")}
					initialValue={apiConfiguration?.ollamaApiKey || ""}
					onChange={(value) => handleFieldChange("ollamaApiKey", value)}
					placeholder={t("api_provider.ollama.api_key_placeholder")}
					providerName="Ollama"
				/>
			)}

			{/* Model selection - use filterable picker */}
			<label htmlFor="ollama-model-selection">
				<span className="font-semibold">{t("api_provider.ollama.model_label")}</span>
			</label>
			<OllamaModelPicker
				ollamaModels={ollamaModels}
				onModelChange={(modelId) => {
					handleModeFieldChange({ plan: "planModeOllamaModelId", act: "actModeOllamaModelId" }, modelId, currentMode)
				}}
				placeholder={
					ollamaModels.length > 0
						? t("api_provider.ollama.model_search_placeholder")
						: t("api_provider.ollama.model_manual_placeholder")
				}
				selectedModelId={ollamaModelId || ""}
			/>

			{/* Show status message based on model availability */}
			{ollamaModels.length === 0 && (
				<p className="text-sm mt-1 text-description italic">{t("api_provider.ollama.unable_to_fetch_models")}</p>
			)}

			<DebouncedTextField
				initialValue={apiConfiguration?.ollamaApiOptionsCtxNum || "32768"}
				onChange={(v) => handleFieldChange("ollamaApiOptionsCtxNum", v || undefined)}
				placeholder={"e.g. 32768"}
				style={{ width: "100%" }}>
				<span className="font-semibold">{t("api_provider.ollama.model_context_window_label")}</span>
			</DebouncedTextField>

			{showModelOptions && (
				<>
					<DebouncedTextField
						initialValue={apiConfiguration?.requestTimeoutMs ? apiConfiguration.requestTimeoutMs.toString() : "30000"}
						onChange={(value) => {
							// Convert to number, with validation
							const numValue = parseInt(value, 10)
							if (!Number.isNaN(numValue) && numValue > 0) {
								handleFieldChange("requestTimeoutMs", numValue)
							}
						}}
						placeholder={t("api_provider.ollama.request_timeout_placeholder")}
						style={{ width: "100%" }}>
						<span className="font-semibold">{t("api_provider.ollama.request_timeout_label")}</span>
					</DebouncedTextField>
					<p className="text-xs mt-0 text-description">{t("api_provider.ollama.request_timeout_description")}</p>
				</>
			)}

			<UseCustomPromptCheckbox providerId="ollama" />

			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				Ollama allows you to run models locally on your computer. For instructions on how to get started, see their{" "}
				<VSCodeLink
					href="https://github.com/ollama/ollama/blob/main/README.md"
					style={{ display: "inline", fontSize: "inherit" }}>
					{t("api_provider.ollama.quickstart_guide")}.
				</VSCodeLink>{" "}
				<span style={{ color: "var(--vscode-errorForeground)" }}>
					(<span style={{ fontWeight: 500 }}>{t("api_provider.ollama.note_text")}:</span>{" "}
					{t("api_provider.ollama.note_content")})
				</span>
			</p>
		</div>
	)
}
