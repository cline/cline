import { Mode } from "@shared/storage/types"
import { VSCodeDropdown, VSCodeLink, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useMemo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useModelContext } from "@/context/ModelContext"
import { ContextWindowSwitcher } from "../common/ContextWindowSwitcher"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { DropdownContainer } from "../common/ModelSelector"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the VercelAIGatewayProvider component
 */
interface VercelAIGatewayProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Vercel AI Gateway provider configuration component
 */
export const VercelAIGatewayProvider = ({ showModelOptions, isPopup, currentMode }: VercelAIGatewayProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()
	const { handleModeFieldsChange } = useApiConfigurationHandlers()

	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	const { models } = useModelContext()

	const { vercelModels, vercelModelIds } = useMemo(() => {
		const vercelModels = models["vercel-ai-gateway"]
		return {
			vercelModels,
			vercelModelIds: Object.keys(vercelModels),
		}
	}, [models["vercel-ai-gateway"]])

	const handleModelChange = (newModelId: string) => {
		// could be setting invalid model id/undefined info but validation will catch it
		handleModeFieldsChange(
			{
				openRouterModelId: { plan: "planModeOpenRouterModelId", act: "actModeOpenRouterModelId" },
				openRouterModelInfo: { plan: "planModeOpenRouterModelInfo", act: "actModeOpenRouterModelInfo" },
			},
			{
				openRouterModelId: newModelId,
				openRouterModelInfo: vercelModels[newModelId],
			},
			currentMode,
		)
	}

	return (
		<div className="w-full h-full relative">
			<div className="w-full">
				<DebouncedTextField
					className="w-full"
					initialValue={apiConfiguration?.vercelAiGatewayApiKey || ""}
					onChange={(value) => handleFieldChange("vercelAiGatewayApiKey", value)}
					placeholder="Enter API Key..."
					type="password">
					<span style={{ fontWeight: 500 }}>Vercel AI Gateway API Key</span>
				</DebouncedTextField>
				<p className="mt-0 text-description text-sm">
					This key is stored locally and only used to make API requests from this extension.
					{!apiConfiguration?.vercelAiGatewayApiKey && (
						<span className="mx-0.5">
							You can get a Vercel AI Gateway API key by
							<VSCodeLink
								className="inline text-link text-sm mx-0.5"
								href="https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai">
								signing up here.
							</VSCodeLink>
						</span>
					)}
				</p>
			</div>

			{showModelOptions && (
				<div className="w-full dropdown-container">
					<div className="w-full flex flex-col z-[3000]">
						<span className="font-semibold">Model</span>
						<DropdownContainer className="dropdown-container" zIndex={2000}>
							<VSCodeDropdown
								className="w-full mt-2"
								onChange={(e: any) => {
									handleModelChange(e.target.value)
								}}
								value={selectedModelId}>
								{vercelModelIds.map((model) => (
									<VSCodeOption className="p-1 px-2" key={model} value={model}>
										{model}
									</VSCodeOption>
								))}
							</VSCodeDropdown>
						</DropdownContainer>

						{/* Context window switcher for Claude Sonnet 4.5 */}
						<ContextWindowSwitcher
							base1mModelId={"anthropic/claude-sonnet-4:1m"}
							base200kModelId="anthropic/claude-sonnet-4.5"
							onModelChange={handleModelChange}
							selectedModelId={selectedModelId}
						/>

						{/* Context window switcher for Claude Sonnet 4 */}
						<ContextWindowSwitcher
							base1mModelId={"anthropic/claude-sonnet-4:1m"}
							base200kModelId="anthropic/claude-sonnet-4"
							onModelChange={handleModelChange}
							selectedModelId={selectedModelId}
						/>
					</div>

					{selectedModelInfo?.thinkingConfig?.maxBudget && <ThinkingBudgetSlider currentMode={currentMode} />}
					{selectedModelId && selectedModelInfo ? (
						<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
					) : (
						<p className="mt-1 text-description text-sm">
							The extension automatically fetches the latest available models from
							<VSCodeLink className="inline mx-0.5 text-sm" href="https://vercel.com/ai-gateway/models">
								Vercel AI Gateway.
							</VSCodeLink>
							If you're unsure which model to choose, Cline works best with
							<VSCodeLink
								className="inline mx-0.5 text-sm"
								onClick={() => handleModelChange("anthropic/claude-sonnet-4.5")}>
								anthropic/claude-sonnet-4.5.
							</VSCodeLink>
						</p>
					)}
				</div>
			)}
		</div>
	)
}
