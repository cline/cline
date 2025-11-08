import { StringRequest } from "@shared/proto/cline/common"
import type { Mode } from "@shared/storage/types"
import { VSCodeDropdown, VSCodeLink, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { StarIcon } from "lucide-react"
import { useMemo } from "react"
import { useMount } from "react-use"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelRefreshProvider, useModelContext } from "@/context/ModelContext"
import { cn } from "@/lib/utils"
import { StateServiceClient } from "@/services/grpc-client"
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

const PROVIDER_ID = ModelRefreshProvider.VercelAIGateway

/**
 * The Vercel AI Gateway provider configuration component
 */
export const VercelAIGatewayProvider = ({ showModelOptions, isPopup, currentMode }: VercelAIGatewayProviderProps) => {
	const { apiConfiguration, favoritedModelIds } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()
	const { handleModeFieldsChange } = useApiConfigurationHandlers()

	const { models, refreshModels } = useModelContext()

	const { vercelModelIds, userFavorites, selectedModelId, selectedModelInfo } = useMemo(() => {
		const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)
		// Filter out anything after the last colon for favorites comparison
		const userFavorites = favoritedModelIds.map((id) => id?.replace(/:.*$/, ""))

		const vercelModels = models[PROVIDER_ID]
		const rawModelIds = Object.keys(vercelModels)

		// Sort by selected then favorite models first
		const vercelModelIds = rawModelIds.sort((a, b) => {
			// Selected model first
			if (a === selectedModelId) {
				return -1
			}
			if (b === selectedModelId) {
				return 1
			}

			// Then favorited models
			const aIsFavorite = userFavorites.includes(a.replace(/:.*$/, ""))
			const bIsFavorite = userFavorites.includes(b.replace(/:.*$/, ""))
			if (aIsFavorite && !bIsFavorite) {
				return -1
			}
			if (!aIsFavorite && bIsFavorite) {
				return 1
			}

			// Otherwise, sort alphabetically
			return a.localeCompare(b)
		})

		return {
			apiConfiguration,
			vercelModels,
			vercelModelIds,
			// Remove anything after the last colon for favorites
			userFavorites,
			selectedModelInfo,
			selectedModelId,
		}
	}, [models, apiConfiguration, currentMode, favoritedModelIds])

	useMount(() => refreshModels(PROVIDER_ID))

	const handleModelChange = (newModelId: string) => {
		// could be setting invalid model id/undefined info but validation will catch it
		handleModeFieldsChange(
			{
				openRouterModelId: { plan: "planModeOpenRouterModelId", act: "actModeOpenRouterModelId" },
				openRouterModelInfo: { plan: "planModeOpenRouterModelInfo", act: "actModeOpenRouterModelInfo" },
			},
			{
				openRouterModelId: newModelId,
				openRouterModelInfo: models[PROVIDER_ID][newModelId],
			},
			currentMode,
		)
	}

	return (
		<div className="w-full h-full relative" id="vercel-ai-gateway-provider">
			<div className="w-full">
				<DebouncedTextField
					className="w-full"
					initialValue={apiConfiguration?.vercelAiGatewayApiKey || ""}
					onChange={(value) => handleFieldChange("vercelAiGatewayApiKey", value)}
					placeholder="Enter API Key..."
					type="password">
					<span className="font-semibold">Vercel AI Gateway API Key</span>
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
				<div className="w-full vercel-dropdown-container">
					<div className="w-full flex flex-col">
						<span className="font-semibold">Model</span>
						<DropdownContainer className="vercel-dropdown-container" zIndex={1000}>
							<VSCodeDropdown
								className="w-full mt-2"
								data-testid="vercel-model-selector"
								onChange={(e) => {
									const target = e.target as HTMLSelectElement
									if (target) {
										handleModelChange(target?.value)
									}
								}}
								value={selectedModelId}>
								{vercelModelIds.map((model) => (
									<VSCodeOption className="p-1 px-2 w-ful" key={"vercel" + model} value={model}>
										<div className="py-2 flex justify-between w-full items-center">
											<div className="break-words whitespace-normal max-w-full">{model}</div>
											<StarIcon
												className={cn(
													"cursor-pointer ml-2 size-2",
													userFavorites.includes(model)
														? "text-button-background fill-button-background"
														: "text-description hover:text-button-background",
												)}
												onClick={(e) => {
													e.stopPropagation()
													StateServiceClient.toggleFavoriteModel(
														StringRequest.create({ value: model }),
													).catch((error) => console.error("Failed to toggle favorite model:", error))
												}}
											/>
										</div>
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
