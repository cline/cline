import { sapAiCoreModels } from "@shared/api"
import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import React, { memo, useMemo } from "react"
import { DropdownContainer } from "./common/ModelSelector"

export const SAP_AI_CORE_MODEL_PICKER_Z_INDEX = 1_000

export interface SapAiCoreModelPickerProps {
	sapAiCoreDeployedModels: string[]
	selectedModelId: string
	onModelChange: (modelId: string) => void
	placeholder?: string
	useOrchestrationMode?: boolean
}

interface CategorizedModel {
	id: string
	isDeployed: boolean
	section: "deployed" | "supported"
}

const SapAiCoreModelPicker: React.FC<SapAiCoreModelPickerProps> = ({
	sapAiCoreDeployedModels,
	selectedModelId,
	onModelChange,
	placeholder = "Select a model...",
	useOrchestrationMode = false,
}) => {
	const handleModelChange = (event: any) => {
		const newModelId = event.target.value
		onModelChange(newModelId)
	}

	const categorizedModels = useMemo(() => {
		const allSupportedModels = Object.keys(sapAiCoreModels)

		// Models that are both deployed AND supported in Cline
		const deployedAndSupported = sapAiCoreDeployedModels.filter((deployedModel: string) =>
			allSupportedModels.includes(deployedModel),
		)

		// Models that are supported in Cline but NOT deployed
		const supportedButNotDeployed = allSupportedModels.filter(
			(supportedModel: string) => !sapAiCoreDeployedModels.includes(supportedModel),
		)

		const deployed: CategorizedModel[] = deployedAndSupported.map((id: string) => ({
			id,
			isDeployed: true,
			section: "deployed" as const,
		}))

		const supported: CategorizedModel[] = supportedButNotDeployed.map((id: string) => ({
			id,
			isDeployed: false,
			section: "supported" as const,
		}))

		return { deployed, supported }
	}, [sapAiCoreDeployedModels])

	const renderOptions = () => {
		const options: React.ReactNode[] = []

		// Add placeholder option
		options.push(
			<VSCodeOption key="placeholder" value="">
				{placeholder}
			</VSCodeOption>,
		)

		if (useOrchestrationMode) {
			// Orchestration mode: Show all supported models in one flat list (no separators)
			const allSupportedModels = Object.keys(sapAiCoreModels)
			allSupportedModels.forEach((modelId) => {
				options.push(
					<VSCodeOption key={modelId} value={modelId}>
						{modelId}
					</VSCodeOption>,
				)
			})
		} else {
			// Non-orchestration mode: Show sectioned layout with separators
			// Add deployed models section
			if (categorizedModels.deployed.length > 0) {
				// Add section separator (disabled option)
				options.push(
					<VSCodeOption disabled key="deployed-header" value="">
						── Deployed Models ──
					</VSCodeOption>,
				)

				categorizedModels.deployed.forEach((model) => {
					options.push(
						<VSCodeOption key={model.id} value={model.id}>
							{model.id}
						</VSCodeOption>,
					)
				})
			}

			// Add supported but not deployed models section
			if (categorizedModels.supported.length > 0) {
				// Add section separator (disabled option)
				options.push(
					<VSCodeOption disabled key="supported-header" value="">
						── Not Deployed Models ──
					</VSCodeOption>,
				)

				categorizedModels.supported.forEach((model) => {
					options.push(
						<VSCodeOption key={model.id} style={{ opacity: 0.6 }} value={model.id}>
							{model.id}
						</VSCodeOption>,
					)
				})
			}
		}

		return options
	}

	return (
		<DropdownContainer className="dropdown-container" zIndex={SAP_AI_CORE_MODEL_PICKER_Z_INDEX}>
			<label htmlFor="sap-ai-core-model-dropdown">
				<span className="font-medium">Model</span>
			</label>
			<VSCodeDropdown
				id="sap-ai-core-model-dropdown"
				key={`sap-ai-core-dropdown-${useOrchestrationMode}`}
				onChange={handleModelChange}
				style={{ width: "100%" }}
				value={selectedModelId}>
				{renderOptions()}
			</VSCodeDropdown>
		</DropdownContainer>
	)
}

export default memo(SapAiCoreModelPicker)
