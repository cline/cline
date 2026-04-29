import { supportsHicapResponsesApi } from "@shared/clients/hicap"
import { EmptyRequest } from "@shared/proto/cline/common"
import { Mode } from "@shared/storage/types"
import { VSCodeButton, VSCodeRadio, VSCodeRadioGroup } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient } from "@/services/grpc-client"
import { getAsVar, VSC_DESCRIPTION_FOREGROUND } from "@/utils/vscStyles"
import { DebouncedTextField } from "../common/DebouncedTextField"
import HicapModelPicker from "../HicapModelPicker"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { getModeSpecificFields, normalizeApiConfiguration, supportsReasoningEffortForModelId } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the HicapProvider component
 */
interface HicapProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Hicap provider configuration component
 */
export const HicapProvider = ({ showModelOptions, isPopup, currentMode }: HicapProviderProps) => {
	const { apiConfiguration, refreshHicapModels } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()
	const [advancedOptionsSelected, setAdvancedOptionsSelected] = useState(false)
	const { selectedModelId } = normalizeApiConfiguration(apiConfiguration, currentMode)
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	const showReasoningEffort = supportsReasoningEffortForModelId(selectedModelId)
	const responsesApiSupported = supportsHicapResponsesApi(selectedModelId)
	const showAdvancedReasoningEffort = !responsesApiSupported && !showReasoningEffort
	const advancedReasoningEnabled = (modeFields.thinkingBudgetTokens ?? 0) > 0
	const handleOptionalNumberChange = async (field: "hicapMaxOutputTokens" | "hicapTemperature", value: string) => {
		const trimmedValue = value.trim()
		const numericValue = Number(trimmedValue)
		const parsedValue = trimmedValue && Number.isFinite(numericValue) ? numericValue : undefined
		await handleFieldChange(field, parsedValue)
	}

	useEffect(() => {
		if (apiConfiguration?.hicapApiKey && apiConfiguration?.hicapApiKey.length === 32) {
			refreshHicapModels()
		}
	}, [apiConfiguration?.hicapApiKey, refreshHicapModels])

	useEffect(() => {
		if (!responsesApiSupported && apiConfiguration?.hicapUseResponsesApi) {
			handleFieldChange("hicapUseResponsesApi", false)
		}
	}, [apiConfiguration?.hicapUseResponsesApi, handleFieldChange, responsesApiSupported])

	return (
		<div>
			<div>
				<DebouncedTextField
					initialValue={apiConfiguration?.hicapApiKey || ""}
					onChange={(value) => {
						handleFieldChange("hicapApiKey", value)
						if (value.length === 32) {
							refreshHicapModels()
						}
					}}
					placeholder="Enter API Key..."
					style={{ width: "100%" }}
					type="password">
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
							width: "100%",
							margin: "10px 0 0 0",
						}}>
						<span style={{ fontWeight: 500 }}>Hicap API Key</span>
					</div>
				</DebouncedTextField>

				{!apiConfiguration?.hicapApiKey && (
					<VSCodeButton
						appearance="secondary"
						onClick={async () => {
							try {
								await AccountServiceClient.hicapAuthClicked(EmptyRequest.create())
							} catch (error) {
								console.error("Failed to open Hicap auth:", error)
							}
						}}
						style={{ margin: "5px 0 0 0" }}>
						Generate API Key
					</VSCodeButton>
				)}
			</div>

			{showModelOptions && (
				<div style={{ margin: "10px 0 0 0" }}>
					<HicapModelPicker currentMode={currentMode} isPopup={isPopup} />
					{showReasoningEffort && <ReasoningEffortSelector currentMode={currentMode} />}
				</div>
			)}

			<button
				onClick={() => setAdvancedOptionsSelected((value) => !value)}
				style={{
					alignItems: "center",
					background: "transparent",
					border: 0,
					color: getAsVar(VSC_DESCRIPTION_FOREGROUND),
					cursor: "pointer",
					display: "flex",
					font: "inherit",
					margin: "10px 0",
					padding: 0,
				}}
				type="button">
				<span
					className={`codicon ${advancedOptionsSelected ? "codicon-chevron-down" : "codicon-chevron-right"}`}
					style={{ marginRight: "4px" }}
				/>
				<span style={{ fontWeight: 700, textTransform: "uppercase" }}>Advanced Options</span>
			</button>

			{advancedOptionsSelected && (
				<>
					<div style={{ margin: "10px 0 0 0" }}>
						<div style={{ fontWeight: 500, marginBottom: 4 }}>API Format</div>
						<VSCodeRadioGroup
							disabled={!responsesApiSupported}
							onChange={(event) => {
								const value = (event.target as HTMLInputElement).value
								handleFieldChange("hicapUseResponsesApi", value === "responses")
							}}
							orientation="horizontal"
							value={responsesApiSupported && apiConfiguration?.hicapUseResponsesApi ? "responses" : "completions"}>
							<VSCodeRadio value="completions">Chat Completions</VSCodeRadio>
							<VSCodeRadio value="responses">Responses</VSCodeRadio>
						</VSCodeRadioGroup>
					</div>

					<div style={{ margin: "10px 0 0 0" }}>
						<ThinkingBudgetSlider currentMode={currentMode} />
					</div>

					{showAdvancedReasoningEffort && advancedReasoningEnabled && (
						<div style={{ margin: "10px 0 0 0" }}>
							<ReasoningEffortSelector
								currentMode={currentMode}
								description="Higher effort improves depth, but may use more tokens."
							/>
						</div>
					)}

					<div style={{ display: "flex", gap: 10, margin: "10px 0 0 0" }}>
						<DebouncedTextField
							initialValue={apiConfiguration?.hicapMaxOutputTokens?.toString() || ""}
							onChange={(value) => handleOptionalNumberChange("hicapMaxOutputTokens", value)}
							placeholder="Default"
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Max Output Tokens</span>
						</DebouncedTextField>

						<DebouncedTextField
							initialValue={apiConfiguration?.hicapTemperature?.toString() || ""}
							onChange={(value) => handleOptionalNumberChange("hicapTemperature", value)}
							placeholder="Default"
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Temperature</span>
						</DebouncedTextField>
					</div>
				</>
			)}
		</div>
	)
}
