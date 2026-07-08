import type { ModelInfo } from "@shared/api"
import { openAiModelInfoSafeDefaults } from "@shared/api"
import { CLINE_RECOMMENDED_MODELS_FALLBACK } from "@shared/cline/recommended-models"
import { EmptyRequest } from "@shared/proto/cline/common"
import { type ClineRecommendedModel, ClineRecommendedModelsResponse } from "@shared/proto/cline/models"
import { Mode } from "@shared/storage/types"
import { useEffect, useMemo, useState } from "react"
import styled from "styled-components"
import { buildClinePassSubscriptionPageUrl } from "@/components/onboarding/clinePassSubscribe"
import { useClineAuth } from "@/context/ClineAuthContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModelSelection } from "@/hooks/useProviderModelSelection"
import { useProviderModels } from "@/hooks/useProviderModels"
import { ModelsServiceClient } from "@/services/grpc-client"
import { ClineAccountInfoCard } from "../ClineAccountInfoCard"
import { ModelInfoView } from "../common/ModelInfoView"
import FeaturedModelCard from "../FeaturedModelCard"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import { type ModelPickerSelection, ModelPickerWithManualEntry } from "./ModelPickerWithManualEntry"

interface ClinePassProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

const CLINE_PASS_PROVIDER_ID = "cline-pass"
const CLINE_PASS_MODEL_ID_PREFIX = "cline-pass/"
const FREE_TAB_DESCRIPTION = "Try with limited usage, separate from ClinePass quota."

interface FeaturedTabEntry {
	id: string
	displayName: string
	description: string
	label: string
}

function clinePassFallbackModelInfo(modelId: string): ModelInfo {
	return {
		...openAiModelInfoSafeDefaults,
		name: modelId,
		inputPrice: 0,
		outputPrice: 0,
		cacheReadsPrice: 0,
		cacheWritesPrice: 0,
	}
}

function toSubscribedEntry(model: Pick<ClineRecommendedModel, "id" | "description">): FeaturedTabEntry | null {
	if (!model.id) {
		return null
	}
	// The whole list is included with the plan, so no per-card label chip
	return {
		id: model.id,
		displayName: model.id.replace(CLINE_PASS_MODEL_ID_PREFIX, ""),
		description: model.description || "",
		label: "",
	}
}

function toFreeEntry(model: Pick<ClineRecommendedModel, "id" | "name" | "description" | "tags">): FeaturedTabEntry | null {
	if (!model.id) {
		return null
	}
	const firstTag = model.tags?.[0]
	return {
		id: model.id,
		// The FREE chip already says it, so drop OpenRouter's :free marker
		displayName: (model.name || model.id).replace(/:free$/i, ""),
		description: model.description || "",
		label: typeof firstTag === "string" && firstTag.length > 0 ? firstTag.toUpperCase() : "FREE",
	}
}

/**
 * ClinePass is a first-class SDK provider whose credentials are backed by the
 * user's Cline OAuth account. Keep the UX close to the Cline provider (account
 * card + model selection), but resolve and persist selections through the SDK
 * provider catalog under providerId="cline-pass".
 *
 * The featured section splits the catalog into Subscribed (the plan's models)
 * and Free (Cline free models, selectable here because both providers hit the
 * same Cline API — free models simply ride usage billing at $0).
 */
export const ClinePassProvider = ({ showModelOptions, isPopup, currentMode }: ClinePassProviderProps) => {
	const { models, defaultModelId, isLoading, isStale, error } = useProviderModels(CLINE_PASS_PROVIDER_ID)
	const { config, write, commitSelection } = useProviderConfig(CLINE_PASS_PROVIDER_ID)
	const { selectedModel, commitModelSelection } = useProviderModelSelection(CLINE_PASS_PROVIDER_ID, currentMode, {
		models,
		defaultModelId,
		config,
		commitSelection,
		customModelInfo: clinePassFallbackModelInfo,
	})
	const { clineUser } = useClineAuth()
	const [subscribedEntries, setSubscribedEntries] = useState<FeaturedTabEntry[]>([])
	const [freeEntries, setFreeEntries] = useState<FeaturedTabEntry[]>([])
	const [activeTab, setActiveTab] = useState<"subscribed" | "free">("subscribed")

	useEffect(() => {
		let cancelled = false
		const fetchRecommendedModels = async () => {
			try {
				const response = await ModelsServiceClient.makeUnaryRequest(
					"refreshClineRecommendedModelsRpc",
					EmptyRequest.create({}),
					EmptyRequest.toJSON,
					ClineRecommendedModelsResponse.fromJSON,
				)
				if (cancelled) {
					return
				}
				setSubscribedEntries(
					(response.clinePass ?? [])
						.map(toSubscribedEntry)
						.filter((entry): entry is FeaturedTabEntry => entry !== null),
				)
				setFreeEntries(
					(response.free ?? []).map(toFreeEntry).filter((entry): entry is FeaturedTabEntry => entry !== null),
				)
			} catch (err) {
				console.error("Failed to refresh ClinePass recommended models:", err)
			}
		}
		void fetchRecommendedModels()
		return () => {
			cancelled = true
		}
	}, [])

	// Fall back to the provider catalog (subscribed) and the bundled free list
	// until the endpoint responds
	const subscribedCards = useMemo(() => {
		if (subscribedEntries.length > 0) {
			return subscribedEntries
		}
		return Object.keys(models ?? {})
			.filter((id) => id.startsWith(CLINE_PASS_MODEL_ID_PREFIX))
			.map((id) => toSubscribedEntry({ id, description: models[id]?.description ?? "" }))
			.filter((entry): entry is FeaturedTabEntry => entry !== null)
	}, [subscribedEntries, models])

	const freeCards = useMemo(() => {
		if (freeEntries.length > 0) {
			return freeEntries
		}
		return CLINE_RECOMMENDED_MODELS_FALLBACK.free
			.map(toFreeEntry)
			.filter((entry): entry is FeaturedTabEntry => entry !== null)
	}, [freeEntries])

	// Land on the tab containing the configured model
	useEffect(() => {
		if (freeCards.some((entry) => entry.id === selectedModel.modelId)) {
			setActiveTab("free")
		} else if (subscribedCards.some((entry) => entry.id === selectedModel.modelId)) {
			setActiveTab("subscribed")
		}
	}, [selectedModel.modelId, freeCards, subscribedCards])

	const handleModelSelect = (selection: ModelPickerSelection) => {
		void commitModelSelection(selection).catch((err) => console.error("Failed to commit ClinePass model selection:", err))
	}

	const handleFeaturedModelSelect = (modelId: string) => {
		handleModelSelect({
			providerId: CLINE_PASS_PROVIDER_ID,
			modelId,
			modelInfo: models?.[modelId] ?? clinePassFallbackModelInfo(modelId),
		})
	}

	const activeCards = activeTab === "free" ? freeCards : subscribedCards

	return (
		<div>
			<div style={{ marginBottom: 14, marginTop: 4 }}>
				<ClineAccountInfoCard usageLink={buildClinePassSubscriptionPageUrl(clineUser?.appBaseUrl)} />
			</div>

			{showModelOptions && (
				<>
					{/* Tabs */}
					<TabsContainer style={{ marginTop: 4 }}>
						<Tab active={activeTab === "subscribed"} onClick={() => setActiveTab("subscribed")}>
							Subscribed
						</Tab>
						{freeCards.length > 0 && (
							<Tab active={activeTab === "free"} onClick={() => setActiveTab("free")}>
								Free
							</Tab>
						)}
					</TabsContainer>

					{/* Tab description */}
					{activeTab === "free" && <TabDescription>{FREE_TAB_DESCRIPTION}</TabDescription>}

					{/* Model Cards */}
					<div style={{ marginBottom: "6px" }}>
						{activeCards.map((entry) => (
							<FeaturedModelCard
								description={entry.description}
								isSelected={selectedModel.modelId === entry.id}
								key={entry.id}
								label={entry.label}
								modelId={entry.displayName}
								onClick={() => handleFeaturedModelSelect(entry.id)}
							/>
						))}
					</div>

					<ModelPickerWithManualEntry
						allowsCustomIds={false}
						error={error}
						isLoading={isLoading}
						isStale={isStale}
						models={models}
						onSelect={handleModelSelect}
						selectedModel={selectedModel}
					/>

					{selectedModel.modelInfo.supportsReasoning === true && (
						<ReasoningEffortSelector
							currentMode={currentMode}
							onEffortChange={(effort) => {
								void write({
									reasoning: {
										enabled: effort !== "none",
										effort: effort !== "none" ? effort : undefined,
									},
								}).catch((err) => console.error("Failed to update ClinePass reasoning effort:", err))
							}}
						/>
					)}

					<ModelInfoView
						hideUsageCost={true}
						isPopup={isPopup}
						modelInfo={selectedModel.modelInfo}
						selectedModelId={selectedModel.modelId}
					/>
				</>
			)}
		</div>
	)
}

const TabsContainer = styled.div`
	display: flex;
	gap: 0;
	margin-bottom: 12px;
	border-bottom: 1px solid var(--vscode-panel-border);
`

const Tab = styled.div<{ active: boolean }>`
	padding: 8px 16px;
	cursor: pointer;
	font-size: 12px;
	font-weight: 500;
	color: ${({ active }) => (active ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)")};
	border-bottom: 2px solid ${({ active }) => (active ? "var(--vscode-textLink-foreground)" : "transparent")};
	transition: all 0.15s ease;

	&:hover {
		color: var(--vscode-foreground);
	}
`

const TabDescription = styled.p`
	font-size: 11px;
	margin: -6px 0 6px 0;
	color: var(--vscode-descriptionForeground);
`
