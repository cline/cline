import { sapAiCoreModels } from "@shared/api"
import { SapAiCoreModelDeployment } from "@shared/proto/index.cline"
import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import React, { memo, useEffect, useMemo } from "react"
import { DropdownContainer } from "./common/ModelSelector"

export const SAP_AI_CORE_MODEL_PICKER_Z_INDEX = 1_000

export interface SapAiCoreModelPickerProps {
	sapAiCoreModelDeployments: SapAiCoreModelDeployment[]
	selectedModelId: string
	selectedDeploymentId?: string
	onModelChange: (modelId: string, deploymentId: string) => void
	placeholder?: string
	useOrchestrationMode?: boolean
}

interface CategorizedModel {
	id: string
	isDeployed: boolean
	section: "deployed" | "supported"
}

const SapAiCoreModelPicker: React.FC<SapAiCoreModelPickerProps> = ({
	sapAiCoreModelDeployments,
	selectedModelId,
	selectedDeploymentId,
	onModelChange,
	placeholder = "Select a model...",
	useOrchestrationMode = false,
}) => {
	// Auto-fix deployment ID mismatch or missing deployment ID when deployments change (when ai core creds changes)
	useEffect(() => {
		if (!selectedModelId) {
			return
		}

		const matchingDeployment = sapAiCoreModelDeployments.find((d) => d.modelName === selectedModelId)

		if (matchingDeployment) {
			// deployment found - update if different
			if (!selectedDeploymentId || matchingDeployment.deploymentId !== selectedDeploymentId) {
				onModelChange(selectedModelId, matchingDeployment.deploymentId)
			}
		} else if (sapAiCoreModelDeployments.length > 0 && selectedDeploymentId) {
			// deployments loaded, but none match the selected model, which means the model is not deployed
			onModelChange(selectedModelId, "")
		}
	}, [sapAiCoreModelDeployments, selectedModelId, selectedDeploymentId, onModelChange])

	const handleModelChange = (e: any) => {
		const newModelId = e.target.value

		if (!newModelId) {
			return
		}

		// Find the deployment that matches the selected model
		const deployment = sapAiCoreModelDeployments.find((d) => d.modelName === newModelId)

		if (deployment) {
			// Deployed model: use the deployment ID
			onModelChange(deployment.modelName, deployment.deploymentId)
		} else {
			// Undeployed model: use empty deployment ID
			onModelChange(newModelId, "")
		}
	}

	const categorizedModels = useMemo(() => {
		const allSupportedModels = Object.keys(sapAiCoreModels)

		// Models that are both deployed AND supported in Cline
		const deployedModelNames = sapAiCoreModelDeployments.map((d) => d.modelName)
		const deployedAndSupported = deployedModelNames.filter((deployedModel: string) =>
			allSupportedModels.includes(deployedModel),
		)

		// Models that are supported in Cline but NOT deployed
		const supportedButNotDeployed = allSupportedModels.filter(
			(supportedModel: string) => !deployedModelNames.includes(supportedModel),
		)

		const deployed: CategorizedModel[] = deployedAndSupported.map((modelName: string) => ({
			id: modelName,
			isDeployed: true,
			section: "deployed" as const,
		}))

		const supported: CategorizedModel[] = supportedButNotDeployed.map((id: string) => ({
			id,
			isDeployed: false,
			section: "supported" as const,
		}))

		return { deployed, supported }
	}, [sapAiCoreModelDeployments])

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
