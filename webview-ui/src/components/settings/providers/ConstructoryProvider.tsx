import { Mode } from "@shared/storage/types"
import { useEffect, useMemo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface ConstructoryProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export const ConstructoryProvider = ({ showModelOptions, isPopup, currentMode }: ConstructoryProviderProps) => {
	const baseURL = process.env.RESEARCH_API_SERVER ?? "https://stage-constructor.dev"
	const sessionToken = process.env.RESEARCH_SDK_TOKEN ?? "KL5ISS6O2R7B0SP9HU1CECUVZ5GMY746"

	const extensionState = useExtensionState()
	const {
		apiConfiguration,
		constructoryModels,
		refreshConstructoryModels,
		constructoryModelsError,
		getLicensedFeatures,
		licensedFeatures,
	} = extensionState
	const { handleModeFieldChange } = useApiConfigurationHandlers()

	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	const isVSCodeConfigReady = !!baseURL && !!sessionToken

	useEffect(() => {
		getLicensedFeatures?.()
		isVSCodeConfigReady && refreshConstructoryModels?.()
	}, [isVSCodeConfigReady])

	const hasConstructoryConfigured = useMemo(() => Object.keys(constructoryModels).length > 0, [constructoryModels])

	const hasResearchClineLicense = useMemo(() => {
		return extensionState.licensedFeatures?.includes("Research.Cline") ?? false
	}, [extensionState.licensedFeatures])

	if (constructoryModelsError) {
		return (
			<div
				style={{
					padding: "12px",
					backgroundColor: "var(--vscode-inputValidation-errorBackground)",
					border: "1px solid var(--vscode-inputValidation-errorBorder)",
					borderRadius: "4px",
					marginBottom: "10px",
				}}>
				<p
					style={{
						margin: 0,
						fontSize: "12px",
						color: "var(--vscode-foreground)",
					}}>
					{constructoryModelsError}
				</p>
			</div>
		)
	}

	if (!hasResearchClineLicense) {
		return (
			<div
				style={{
					padding: "12px",
					backgroundColor: "var(--vscode-inputValidation-errorBackground)",
					border: "1px solid var(--vscode-inputValidation-errorBorder)",
					borderRadius: "4px",
					marginBottom: "10px",
				}}>
				<p>You do not have a Research.Cline license.</p>
				<p>Please contact your administrator to get a license.</p>
			</div>
		)
	}

	if (!isVSCodeConfigReady) {
		return (
			<div
				style={{
					padding: "12px",
					backgroundColor: "var(--vscode-inputValidation-warningBackground)",
					border: "1px solid var(--vscode-inputValidation-warningBorder)",
					borderRadius: "4px",
					marginBottom: "10px",
				}}>
				<p
					style={{
						margin: 0,
						fontSize: "12px",
						color: "var(--vscode-foreground)",
					}}>
					<strong>Constructory not configured</strong>
				</p>
				<p
					style={{
						margin: "4px 0 0 0",
						fontSize: "12px",
						color: "var(--vscode-foreground)",
					}}>
					Please ensure <code>RESEARCH_API_SERVER</code> and <code>RESEARCH_SDK_TOKEN</code> environment variables are
					set in your VS Code launch configuration.
				</p>
			</div>
		)
	}

	return (
		<div>
			{hasConstructoryConfigured && showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={constructoryModels}
						onChange={(e) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
					/>

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
