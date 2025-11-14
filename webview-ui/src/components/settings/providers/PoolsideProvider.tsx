import { poolsideModelInfoSaneDefaults } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { getAsVar, VSC_DESCRIPTION_FOREGROUND } from "@/utils/vscStyles"
import { ApiKeyField } from "../common/ApiKeyField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { getModeSpecificFields, normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the PoolsideProvider component
 */
interface PoolsideProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Poolside provider configuration component
 */
export const PoolsideProvider = ({ showModelOptions, isPopup, currentMode }: PoolsideProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	const [modelConfigurationSelected, setModelConfigurationSelected] = useState(false)

	const { poolsideModelId, poolsideModelInfo } = getModeSpecificFields(apiConfiguration, currentMode)
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.poolsideApiKey || ""}
				onChange={(value) => handleFieldChange("poolsideApiKey", value)}
				providerName="Poolside"
			/>
			<DebouncedTextField
				initialValue={apiConfiguration?.poolsideBaseUrl || ""}
				onChange={(value) => handleFieldChange("poolsideBaseUrl", value)}
				placeholder={"Enter Base URL..."}
				style={{ width: "100%" }}>
				<span style={{ fontWeight: 500 }}>Base URL</span>
			</DebouncedTextField>
			<DebouncedTextField
				initialValue={poolsideModelId || ""}
				onChange={(value) =>
					handleModeFieldChange({ plan: "planModePoolsideModelId", act: "actModePoolsideModelId" }, value, currentMode)
				}
				placeholder={"Enter Model ID..."}
				style={{ width: "100%" }}>
				<span style={{ fontWeight: 500 }}>Model ID</span>
			</DebouncedTextField>
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
					Model Configuration
				</span>
			</div>

			{modelConfigurationSelected && (
				<>
					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<DebouncedTextField
							initialValue={
								poolsideModelInfo?.contextWindow
									? poolsideModelInfo.contextWindow.toString()
									: (poolsideModelInfoSaneDefaults.contextWindow?.toString() ?? "")
							}
							onChange={(value) => {
								const modelInfo = poolsideModelInfo ? poolsideModelInfo : { ...poolsideModelInfoSaneDefaults }
								modelInfo.contextWindow = Number(value)
								handleModeFieldChange(
									{ plan: "planModePoolsideModelInfo", act: "actModePoolsideModelInfo" },
									modelInfo,
									currentMode,
								)
							}}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Context Window Size</span>
						</DebouncedTextField>

						<DebouncedTextField
							initialValue={
								poolsideModelInfo?.maxTokens
									? poolsideModelInfo.maxTokens.toString()
									: (poolsideModelInfoSaneDefaults.maxTokens?.toString() ?? "")
							}
							onChange={(value) => {
								const modelInfo = poolsideModelInfo ? poolsideModelInfo : { ...poolsideModelInfoSaneDefaults }
								modelInfo.maxTokens = Number(value)
								handleModeFieldChange(
									{ plan: "planModePoolsideModelInfo", act: "actModePoolsideModelInfo" },
									modelInfo,
									currentMode,
								)
							}}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Max Output Tokens</span>
						</DebouncedTextField>
					</div>

					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<DebouncedTextField
							initialValue={
								poolsideModelInfo?.inputPrice
									? poolsideModelInfo.inputPrice.toString()
									: (poolsideModelInfoSaneDefaults.inputPrice?.toString() ?? "")
							}
							onChange={(value) => {
								const modelInfo = poolsideModelInfo ? poolsideModelInfo : { ...poolsideModelInfoSaneDefaults }
								modelInfo.inputPrice = Number(value)
								handleModeFieldChange(
									{ plan: "planModePoolsideModelInfo", act: "actModePoolsideModelInfo" },
									modelInfo,
									currentMode,
								)
							}}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Input Price / 1M tokens</span>
						</DebouncedTextField>

						<DebouncedTextField
							initialValue={
								poolsideModelInfo?.outputPrice
									? poolsideModelInfo.outputPrice.toString()
									: (poolsideModelInfoSaneDefaults.outputPrice?.toString() ?? "")
							}
							onChange={(value) => {
								const modelInfo = poolsideModelInfo ? poolsideModelInfo : { ...poolsideModelInfoSaneDefaults }
								modelInfo.outputPrice = Number(value)
								handleModeFieldChange(
									{ plan: "planModePoolsideModelInfo", act: "actModePoolsideModelInfo" },
									modelInfo,
									currentMode,
								)
							}}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Output Price / 1M tokens</span>
						</DebouncedTextField>
					</div>

					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<DebouncedTextField
							initialValue={
								poolsideModelInfo?.temperature
									? poolsideModelInfo.temperature.toString()
									: (poolsideModelInfoSaneDefaults.temperature?.toString() ?? "")
							}
							onChange={(value) => {
								const modelInfo = poolsideModelInfo
									? { ...poolsideModelInfo }
									: { ...poolsideModelInfoSaneDefaults }

								const shouldPreserveFormat = value.endsWith(".") || (value.includes(".") && value.endsWith("0"))

								modelInfo.temperature =
									value === ""
										? poolsideModelInfoSaneDefaults.temperature
										: shouldPreserveFormat
											? (value as any)
											: parseFloat(value)

								handleModeFieldChange(
									{ plan: "planModePoolsideModelInfo", act: "actModePoolsideModelInfo" },
									modelInfo,
									currentMode,
								)
							}}>
							<span style={{ fontWeight: 500 }}>Temperature</span>
						</DebouncedTextField>
					</div>
				</>
			)}

			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}></p>

			{showModelOptions && (
				<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
			)}
		</div>
	)
}
