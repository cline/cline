import { liteLlmModelInfoSaneDefaults } from "@shared/api"
import { UpdateApiConfigurationRequestNew } from "@shared/proto/index.cline"
import { Mode } from "@shared/storage/types"
import { VSCodeCheckbox, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { getAsVar, VSC_DESCRIPTION_FOREGROUND } from "@/utils/vscStyles"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { getModeSpecificFields, normalizeApiConfiguration } from "../utils/providerUtils"

/**
 * Props for the LiteLlmProvider component
 */
interface LiteLlmProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The LiteLLM provider configuration component
 */
export const LiteLlmProvider = ({ showModelOptions, isPopup, currentMode }: LiteLlmProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { t } = useTranslation("common")

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	// Get mode-specific fields
	const { liteLlmModelId, liteLlmModelInfo } = getModeSpecificFields(apiConfiguration, currentMode)

	// Local state for collapsible model configuration section
	const [modelConfigurationSelected, setModelConfigurationSelected] = useState(false)

	return (
		<div>
			<DebouncedTextField
				initialValue={apiConfiguration?.liteLlmBaseUrl || ""}
				onChange={async (value) => {
					await ModelsServiceClient.updateApiConfiguration(
						UpdateApiConfigurationRequestNew.create({
							updates: {
								options: {
									liteLlmBaseUrl: value,
								},
							},
							updateMask: ["options.liteLlmBaseUrl"],
						}),
					)
				}}
				placeholder={t("api_provider.litellm.base_url_placeholder")}
				style={{ width: "100%" }}
				type="text">
				<span style={{ fontWeight: 500 }}>{t("api_provider.litellm.base_url_label")}</span>
			</DebouncedTextField>
			<DebouncedTextField
				initialValue={apiConfiguration?.liteLlmApiKey || ""}
				onChange={async (value) => {
					await ModelsServiceClient.updateApiConfiguration(
						UpdateApiConfigurationRequestNew.create({
							updates: {
								secrets: {
									liteLlmApiKey: value,
								},
							},
							updateMask: ["secrets.liteLlmApiKey"],
						}),
					)
				}}
				placeholder={t("api_provider.litellm.api_key_placeholder")}
				style={{ width: "100%" }}
				type="password">
				<span style={{ fontWeight: 500 }}>{t("api_provider.litellm.api_key_label")}</span>
			</DebouncedTextField>
			<DebouncedTextField
				initialValue={liteLlmModelId || ""}
				onChange={async (value) => {
					await ModelsServiceClient.updateApiConfiguration(
						UpdateApiConfigurationRequestNew.create(
							currentMode === "plan"
								? {
										updates: { options: { planModeLiteLlmModelId: value } },
										updateMask: ["options.planModeLiteLlmModelId"],
									}
								: {
										updates: { options: { actModeLiteLlmModelId: value } },
										updateMask: ["options.actModeLiteLlmModelId"],
									},
						),
					)
				}}
				placeholder={t("api_provider.litellm.model_id_placeholder")}
				style={{ width: "100%" }}>
				<span style={{ fontWeight: 500 }}>{t("api_provider.litellm.model_id_label")}</span>
			</DebouncedTextField>

			<div style={{ display: "flex", flexDirection: "column", marginTop: 10, marginBottom: 10 }}>
				{selectedModelInfo.supportsPromptCache && (
					<>
						<VSCodeCheckbox
							checked={apiConfiguration?.liteLlmUsePromptCache || false}
							onChange={async (e: any) => {
								const isChecked = e.target.checked === true

								await ModelsServiceClient.updateApiConfiguration(
									UpdateApiConfigurationRequestNew.create({
										updates: {
											options: {
												liteLlmUsePromptCache: isChecked,
											},
										},
										updateMask: ["options.liteLlmUsePromptCache"],
									}),
								)
							}}
							style={{ fontWeight: 500, color: "var(--vscode-charts-green)" }}>
							{t("api_provider.litellm.use_prompt_caching")}
						</VSCodeCheckbox>
						<p style={{ fontSize: "12px", marginTop: 3, color: "var(--vscode-charts-green)" }}>
							{t("api_provider.litellm.prompt_caching_info")}
						</p>
					</>
				)}
			</div>

			<ThinkingBudgetSlider currentMode={currentMode} />
			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				{t("api_provider.litellm.thinking_mode_info")}{" "}
				<VSCodeLink
					href="https://docs.litellm.ai/docs/reasoning_content"
					style={{ display: "inline", fontSize: "inherit" }}>
					{t("api_provider.litellm.thinking_mode_config")}
				</VSCodeLink>
			</p>

			<div
				onClick={() => setModelConfigurationSelected((val) => !val)}
				style={{
					color: getAsVar(VSC_DESCRIPTION_FOREGROUND),
					display: "flex",
					margin: "10px 0",
					cursor: "pointer",
					alignItems: "center",
				}}>
				<span
					className={`codicon ${modelConfigurationSelected ? "codicon-chevron-down" : "codicon-chevron-right"}`}
					style={{
						marginRight: "4px",
					}}></span>
				<span
					style={{
						fontWeight: 700,
						textTransform: "uppercase",
					}}>
					{t("api_provider.litellm.model_configuration_title")}
				</span>
			</div>
			{modelConfigurationSelected && (
				<>
					<VSCodeCheckbox
						checked={!!liteLlmModelInfo?.supportsImages}
						onChange={async (e: any) => {
							const isChecked = e.target.checked === true
							const modelInfo = liteLlmModelInfo ? liteLlmModelInfo : { ...liteLlmModelInfoSaneDefaults }
							modelInfo.supportsImages = isChecked

							await ModelsServiceClient.updateApiConfiguration(
								UpdateApiConfigurationRequestNew.create(
									currentMode === "plan"
										? {
												updates: { options: { planModeLiteLlmModelInfo: modelInfo } },
												updateMask: ["options.planModeLiteLlmModelInfo"],
											}
										: {
												updates: { options: { actModeLiteLlmModelInfo: modelInfo } },
												updateMask: ["options.actModeLiteLlmModelInfo"],
											},
								),
							)
						}}>
						{t("api_provider.litellm.supports_images")}
					</VSCodeCheckbox>
					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<DebouncedTextField
							initialValue={
								liteLlmModelInfo?.contextWindow
									? liteLlmModelInfo.contextWindow.toString()
									: (liteLlmModelInfoSaneDefaults.contextWindow?.toString() ?? "")
							}
							onChange={async (value) => {
								const modelInfo = liteLlmModelInfo ? liteLlmModelInfo : { ...liteLlmModelInfoSaneDefaults }
								modelInfo.contextWindow = Number(value)

								await ModelsServiceClient.updateApiConfiguration(
									UpdateApiConfigurationRequestNew.create(
										currentMode === "plan"
											? {
													updates: { options: { planModeLiteLlmModelInfo: modelInfo } },
													updateMask: ["options.planModeLiteLlmModelInfo"],
												}
											: {
													updates: { options: { actModeLiteLlmModelInfo: modelInfo } },
													updateMask: ["options.actModeLiteLlmModelInfo"],
												},
									),
								)
							}}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>{t("api_provider.litellm.context_window_size_label")}</span>
						</DebouncedTextField>
						<DebouncedTextField
							initialValue={
								liteLlmModelInfo?.maxTokens
									? liteLlmModelInfo.maxTokens.toString()
									: (liteLlmModelInfoSaneDefaults.maxTokens?.toString() ?? "")
							}
							onChange={async (value) => {
								const modelInfo = liteLlmModelInfo ? liteLlmModelInfo : { ...liteLlmModelInfoSaneDefaults }
								modelInfo.maxTokens = Number(value)

								await ModelsServiceClient.updateApiConfiguration(
									UpdateApiConfigurationRequestNew.create(
										currentMode === "plan"
											? {
													updates: { options: { planModeLiteLlmModelInfo: modelInfo } },
													updateMask: ["options.planModeLiteLlmModelInfo"],
												}
											: {
													updates: { options: { actModeLiteLlmModelInfo: modelInfo } },
													updateMask: ["options.actModeLiteLlmModelInfo"],
												},
									),
								)
							}}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>{t("api_provider.litellm.max_output_tokens_label")}</span>
						</DebouncedTextField>
					</div>
					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<DebouncedTextField
							initialValue={
								liteLlmModelInfo?.temperature !== undefined
									? liteLlmModelInfo.temperature.toString()
									: (liteLlmModelInfoSaneDefaults.temperature?.toString() ?? "")
							}
							onChange={async (value) => {
								const modelInfo = liteLlmModelInfo ? liteLlmModelInfo : { ...liteLlmModelInfoSaneDefaults }

								// Check if the input ends with a decimal point or has trailing zeros after decimal
								const _shouldPreserveFormat = value.endsWith(".") || (value.includes(".") && value.endsWith("0"))

								modelInfo.temperature =
									value === "" ? liteLlmModelInfoSaneDefaults.temperature : parseFloat(value)

								await ModelsServiceClient.updateApiConfiguration(
									UpdateApiConfigurationRequestNew.create(
										currentMode === "plan"
											? {
													updates: { options: { planModeLiteLlmModelInfo: modelInfo } },
													updateMask: ["options.planModeLiteLlmModelInfo"],
												}
											: {
													updates: { options: { actModeLiteLlmModelInfo: modelInfo } },
													updateMask: ["options.actModeLiteLlmModelInfo"],
												},
									),
								)
							}}>
							<span style={{ fontWeight: 500 }}>{t("api_provider.litellm.temperature_label")}</span>
						</DebouncedTextField>
					</div>
				</>
			)}
			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				{t("api_provider.litellm.description")}{" "}
				<VSCodeLink href="https://docs.litellm.ai/docs/" style={{ display: "inline", fontSize: "inherit" }}>
					{t("api_provider.litellm.quickstart_guide")}
				</VSCodeLink>{" "}
				{t("api_provider.litellm.more_info")}
			</p>

			{showModelOptions && (
				<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
			)}
		</div>
	)
}
