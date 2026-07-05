import { openAiModelInfoSafeDefaults } from "@shared/api"
import { EmptyRequest } from "@shared/proto/cline/common"
import type { Mode } from "@shared/storage/types"
import { parseVsCodeLmModelSelector, stringifyVsCodeLmModelSelector } from "@shared/vsCodeSelectorUtils"
import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useState } from "react"
import { useInterval } from "react-use"
import type * as vscodemodels from "vscode"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { ModelsServiceClient } from "@/services/grpc-client"
import { DROPDOWN_Z_INDEX, DropdownContainer } from "../ApiOptions"
import { getModeSpecificFields } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface VSCodeLmProviderProps {
	currentMode: Mode
}

export const VSCodeLmProvider = ({ currentMode }: VSCodeLmProviderProps) => {
	const [vsCodeLmModels, setVsCodeLmModels] = useState<vscodemodels.LanguageModelChatSelector[]>([])
	const { apiConfiguration } = useExtensionState()
	const { handleModeFieldChange } = useApiConfigurationHandlers()
	const { config, commitSelection } = useProviderConfig("vscode-lm")

	const { vsCodeLmModelSelector } = getModeSpecificFields(apiConfiguration, currentMode)
	const committedSelection = currentMode === "plan" ? config?.planSelection : config?.actSelection
	const selectedModelId = vsCodeLmModelSelector
		? stringifyVsCodeLmModelSelector(vsCodeLmModelSelector)
		: (committedSelection?.modelId ?? "")

	// Poll VS Code LM models
	const requestVsCodeLmModels = useCallback(async () => {
		try {
			const response = await ModelsServiceClient.getVsCodeLmModels(EmptyRequest.create({}))
			if (response?.models) {
				setVsCodeLmModels(response.models)
			}
		} catch (error) {
			console.error("Failed to fetch VS Code LM models:", error)
			setVsCodeLmModels([])
		}
	}, [])

	useEffect(() => {
		requestVsCodeLmModels()
	}, [requestVsCodeLmModels])

	useInterval(requestVsCodeLmModels, 2000)

	const handleModelSelect = (modelId: string) => {
		if (!modelId) {
			return
		}

		const selector = parseVsCodeLmModelSelector(modelId)
		void handleModeFieldChange(
			{
				plan: "planModeVsCodeLmModelSelector",
				act: "actModeVsCodeLmModelSelector",
			},
			selector,
			currentMode,
		).catch((err) => console.error("Failed to update VS Code LM selector:", err))

		void commitSelection(currentMode, {
			providerId: "vscode-lm",
			modelId,
			modelInfo: {
				...openAiModelInfoSafeDefaults,
				name: [selector.vendor, selector.family].filter(Boolean).join(" - ") || modelId,
			},
		}).catch((err) => console.error("Failed to commit VS Code LM model selection:", err))
	}

	return (
		<div>
			<DropdownContainer className="dropdown-container" zIndex={DROPDOWN_Z_INDEX - 2}>
				<label htmlFor="vscode-lm-model">
					<span style={{ fontWeight: 500 }}>Language Model</span>
				</label>
				{vsCodeLmModels.length > 0 ? (
					<VSCodeDropdown
						id="vscode-lm-model"
						onChange={(e) => handleModelSelect((e.target as HTMLInputElement).value)}
						style={{ width: "100%" }}
						value={selectedModelId}>
						<VSCodeOption value="">Select a model...</VSCodeOption>
						{vsCodeLmModels.map((model) => {
							const value = stringifyVsCodeLmModelSelector(model)
							return (
								<VSCodeOption key={value} value={value}>
									{model.vendor} - {model.family}
								</VSCodeOption>
							)
						})}
					</VSCodeDropdown>
				) : (
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						Uses models contributed by other extensions through the VS Code Language Model API. The most common source
						is GitHub Copilot — install the{" "}
						<a href="https://marketplace.visualstudio.com/items?itemName=GitHub.copilot">Copilot extension</a> and
						enable models in Copilot settings — but any extension that registers a language model provider will appear
						here.
					</p>
				)}
			</DropdownContainer>
		</div>
	)
}
