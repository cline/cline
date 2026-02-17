import { CLAUDE_SONNET_1M_SUFFIX, openRouterDefaultModelId } from "@shared/api"
import { StringRequest } from "@shared/proto/cline/common"
import type { Mode } from "@shared/storage/types"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import Fuse from "fuse.js"
import type React from "react"
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import { useMount } from "react-use"
import styled from "styled-components"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import { highlight } from "../history/HistoryView"
import { ContextWindowSwitcher } from "./common/ContextWindowSwitcher"
import { ModelInfoView } from "./common/ModelInfoView"
import FeaturedModelCard from "./FeaturedModelCard"
import ReasoningEffortSelector from "./ReasoningEffortSelector"
import ThinkingBudgetSlider from "./ThinkingBudgetSlider"
import {
	filterOpenRouterModelIds,
	getModeSpecificFields,
	normalizeApiConfiguration,
	supportsReasoningEffortForModelId,
} from "./utils/providerUtils"
import { useApiConfigurationHandlers } from "./utils/useApiConfigurationHandlers"

// Star icon for favorites
const StarIcon = ({ isFavorite, onClick }: { isFavorite: boolean; onClick: (e: React.MouseEvent) => void }) => {
	return (
		<div
			onClick={onClick}
			style={{
				cursor: "pointer",
				color: isFavorite ? "var(--vscode-terminal-ansiBlue)" : "var(--vscode-descriptionForeground)",
				marginLeft: "8px",
				fontSize: "16px",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				userSelect: "none",
				WebkitUserSelect: "none",
			}}>
			{isFavorite ? "★" : "☆"}
		</div>
	)
}

export interface ClineModelPickerProps {
	isPopup?: boolean
	currentMode: Mode
	showProviderRouting?: boolean
	initialTab?: "recommended" | "free"
}

export const recommendedModels = [
	{
		id: "anthropic/claude-sonnet-4.6",
		description: "Best balance of speed, cost, and quality",
		label: "BEST",
	},
	{
		id: "anthropic/claude-opus-4.6",
		description: "Most intelligent model for agents and coding",
		label: "NEW",
	},
	{
		id: "openai/gpt-5.2-codex",
		description: "OpenAI's latest with strong coding abilities",
		label: "HOT",
	},
	{
		id: "google/gemini-3-pro-preview",
		description: "1M context window for large codebases",
		label: "1M CTX",
	},
]

export const freeModels = [
	{
		id: "anthropic/claude-sonnet-4.6",
		description: "Claude Sonnet 4.6 with strong coding and agent performance, now available free in Cline",
		label: "FREE",
	},
	{
		id: "z-ai/glm-5",
		description: "Z.AI's latest GLM 5 model with strong coding and agent performance",
		label: "FREE",
	},
	{
		id: "kwaipilot/kat-coder-pro",
		description: "KwaiKAT's most advanced agentic coding model in the KAT-Coder series",
		label: "FREE",
	},
	{
		id: "arcee-ai/trinity-large-preview:free",
		description: "Arcee AI's advanced large preview model in the Trinity series",
		label: "FREE",
	},
]

const FREE_CLINE_MODELS = freeModels.map((m) => m.id)

const ClineModelPicker: React.FC<ClineModelPickerProps> = ({ isPopup, currentMode, showProviderRouting, initialTab }) => {
	const { handleModeFieldsChange, handleFieldChange } = useApiConfigurationHandlers()
	const { apiConfiguration, favoritedModelIds, clineModels, refreshClineModels } = useExtensionState()
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	const [searchTerm, setSearchTerm] = useState(modeFields.clineModelId || openRouterDefaultModelId)
	const [isDropdownVisible, setIsDropdownVisible] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(-1)
	const [activeTab, setActiveTab] = useState<"recommended" | "free">(() => {
		if (initialTab) {
			return initialTab
		}
		const currentModelId = modeFields.clineModelId || openRouterDefaultModelId
		return freeModels.some((m) => m.id === currentModelId) ? "free" : "recommended"
	})

	useEffect(() => {
		if (initialTab) {
			setActiveTab(initialTab)
		}
	}, [initialTab])
	const dropdownRef = useRef<HTMLDivElement>(null)
	const itemRefs = useRef<(HTMLDivElement | null)[]>([])
	const dropdownListRef = useRef<HTMLDivElement>(null)

	const handleModelChange = (newModelId: string) => {
		setSearchTerm(newModelId)

		handleModeFieldsChange(
			{
				clineModelId: { plan: "planModeClineModelId", act: "actModeClineModelId" },
				clineModelInfo: { plan: "planModeClineModelInfo", act: "actModeClineModelInfo" },
			},
			{
				clineModelId: newModelId,
				clineModelInfo: clineModels?.[newModelId],
			},
			currentMode,
		)
	}

	const { selectedModelId, selectedModelInfo } = useMemo(() => {
		const selected = normalizeApiConfiguration(apiConfiguration, currentMode)
		if (FREE_CLINE_MODELS.includes(selected.selectedModelId)) {
			return {
				...selected,
				selectedModelInfo: {
					...selected.selectedModelInfo,
					inputPrice: 0,
					outputPrice: 0,
					cacheReadsPrice: 0,
					cacheWritesPrice: 0,
				},
			}
		}
		return selected
	}, [apiConfiguration, currentMode])

	useMount(refreshClineModels)

	// Sync external changes when the modelId changes
	useEffect(() => {
		const currentModelId = modeFields.clineModelId || openRouterDefaultModelId
		setSearchTerm(currentModelId)
	}, [modeFields.clineModelId])

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
				setIsDropdownVisible(false)
			}
		}

		document.addEventListener("mousedown", handleClickOutside)
		return () => {
			document.removeEventListener("mousedown", handleClickOutside)
		}
	}, [])

	const modelIds = useMemo(() => {
		const unfilteredModelIds = Object.keys(clineModels ?? {}).sort((a, b) => a.localeCompare(b))
		return filterOpenRouterModelIds(unfilteredModelIds, "cline")
	}, [clineModels])

	const searchableItems = useMemo(() => {
		return modelIds.map((id) => ({
			id,
			html: id,
		}))
	}, [modelIds])

	const fuse = useMemo(() => {
		return new Fuse(searchableItems, {
			keys: ["html"], // highlight function will update this
			threshold: 0.6,
			shouldSort: true,
			isCaseSensitive: false,
			ignoreLocation: false,
			includeMatches: true,
			minMatchCharLength: 1,
		})
	}, [searchableItems])

	const modelSearchResults = useMemo(() => {
		// First, get all favorited models
		const favoritedModels = searchableItems.filter((item) => favoritedModelIds.includes(item.id))

		// Then get search results for non-favorited models
		const searchResults = searchTerm
			? highlight(fuse.search(searchTerm), "model-item-highlight").filter((item) => !favoritedModelIds.includes(item.id))
			: searchableItems.filter((item) => !favoritedModelIds.includes(item.id))

		// Combine favorited models with search results
		return [...favoritedModels, ...searchResults]
	}, [searchableItems, searchTerm, fuse, favoritedModelIds])

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (!isDropdownVisible) {
			return
		}

		switch (event.key) {
			case "ArrowDown":
				event.preventDefault()
				setSelectedIndex((prev) => (prev < modelSearchResults.length - 1 ? prev + 1 : prev))
				break
			case "ArrowUp":
				event.preventDefault()
				setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev))
				break
			case "Enter":
				event.preventDefault()
				if (selectedIndex >= 0 && selectedIndex < modelSearchResults.length) {
					handleModelChange(modelSearchResults[selectedIndex].id)
					setIsDropdownVisible(false)
				} else {
					handleModelChange(searchTerm)
					setIsDropdownVisible(false)
				}
				break
			case "Escape":
				setIsDropdownVisible(false)
				setSelectedIndex(-1)
				break
		}
	}

	const hasInfo = useMemo(() => {
		try {
			if (searchTerm.startsWith("@preset/")) {
				return false
			}
			return modelIds.some((id) => id.toLowerCase() === searchTerm.toLowerCase())
		} catch {
			return false
		}
	}, [modelIds, searchTerm])

	useEffect(() => {
		setSelectedIndex(-1)
		if (dropdownListRef.current) {
			dropdownListRef.current.scrollTop = 0
		}
	}, [searchTerm])

	useEffect(() => {
		if (selectedIndex >= 0 && itemRefs.current[selectedIndex]) {
			itemRefs.current[selectedIndex]?.scrollIntoView({
				block: "nearest",
				behavior: "smooth",
			})
		}
	}, [selectedIndex])

	const selectedModelIdLower = selectedModelId?.toLowerCase() || ""
	const showReasoningEffort = useMemo(() => supportsReasoningEffortForModelId(selectedModelId), [selectedModelId])

	const showBudgetSlider = useMemo(() => {
		if (showReasoningEffort) {
			return false
		}
		return (
			Object.entries(clineModels ?? {})?.some(([id, m]) => id === selectedModelId && m.thinkingConfig) ||
			selectedModelIdLower.includes("claude-opus-4.6") ||
			selectedModelIdLower.includes("claude-haiku-4.5") ||
			selectedModelIdLower.includes("claude-4.5-haiku") ||
			selectedModelIdLower.includes("claude-sonnet-4.5") ||
			selectedModelIdLower.includes("claude-sonnet-4") ||
			selectedModelIdLower.includes("claude-opus-4.1") ||
			selectedModelIdLower.includes("claude-opus-4") ||
			selectedModelIdLower.includes("claude-opus-4.5") ||
			selectedModelIdLower.includes("claude-3-7-sonnet") ||
			selectedModelIdLower.includes("claude-3.7-sonnet") ||
			selectedModelIdLower.includes("claude-3.7-sonnet:thinking")
		)
	}, [clineModels, selectedModelId, selectedModelIdLower, showReasoningEffort])

	return (
		<div style={{ width: "100%", paddingBottom: 2 }}>
			<style>
				{`
				.model-item-highlight {
					background-color: var(--vscode-editor-findMatchHighlightBackground);
					color: inherit;
				}
				`}
			</style>
			<div style={{ display: "flex", flexDirection: "column" }}>
				<label htmlFor="model-search">
					<span style={{ fontWeight: 500 }}>Model</span>
				</label>

				<>
					{/* Tabs */}
					<TabsContainer style={{ marginTop: 4 }}>
						<Tab active={activeTab === "recommended"} onClick={() => setActiveTab("recommended")}>
							Recommended
						</Tab>
						<Tab active={activeTab === "free"} onClick={() => setActiveTab("free")}>
							Free
						</Tab>
					</TabsContainer>

					{/* Model Cards */}
					<div style={{ marginBottom: "6px" }}>
						{activeTab === "recommended" &&
							recommendedModels.map((model) => (
								<FeaturedModelCard
									description={model.description}
									isSelected={selectedModelId === model.id}
									key={model.id}
									label={model.label}
									modelId={model.id}
									onClick={() => {
										handleModelChange(model.id)
										setIsDropdownVisible(false)
									}}
								/>
							))}
						{activeTab === "free" &&
							freeModels.map((model) => (
								<FeaturedModelCard
									description={model.description}
									isSelected={selectedModelId === model.id}
									key={model.id}
									label={model.label}
									modelId={model.id}
									onClick={() => {
										handleModelChange(model.id)
										setIsDropdownVisible(false)
									}}
								/>
							))}
					</div>
				</>

				<DropdownWrapper ref={dropdownRef}>
					<VSCodeTextField
						id="model-search"
						onBlur={() => {
							if (searchTerm !== selectedModelId) {
								handleModelChange(searchTerm)
							}
						}}
						onFocus={() => setIsDropdownVisible(true)}
						onInput={(e) => {
							setSearchTerm((e.target as HTMLInputElement)?.value.toLowerCase() || "")
							setIsDropdownVisible(true)
						}}
						onKeyDown={handleKeyDown}
						placeholder="Search and select a model..."
						role="combobox"
						style={{
							width: "100%",
							zIndex: CLINE_MODEL_PICKER_Z_INDEX,
							position: "relative",
						}}
						value={searchTerm}>
						{searchTerm && (
							<div
								aria-label="Clear search"
								className="input-icon-button codicon codicon-close"
								onClick={() => {
									setSearchTerm("")
									setIsDropdownVisible(true)
								}}
								slot="end"
								style={{
									display: "flex",
									justifyContent: "center",
									alignItems: "center",
									height: "100%",
								}}
							/>
						)}
					</VSCodeTextField>
					{isDropdownVisible && (
						<DropdownList ref={dropdownListRef} role="listbox">
							{modelSearchResults.map((item, index) => {
								const isFavorite = (favoritedModelIds || []).includes(item.id)
								return (
									<DropdownItem
										isSelected={index === selectedIndex}
										key={item.id}
										onClick={() => {
											handleModelChange(item.id)
											setIsDropdownVisible(false)
										}}
										onMouseEnter={() => setSelectedIndex(index)}
										ref={(el) => (itemRefs.current[index] = el)}
										role="option">
										<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
											<span dangerouslySetInnerHTML={{ __html: item.html }} />
											<StarIcon
												isFavorite={isFavorite}
												onClick={(e) => {
													e.stopPropagation()
													StateServiceClient.toggleFavoriteModel(
														StringRequest.create({ value: item.id }),
													).catch((error) => console.error("Failed to toggle favorite model:", error))
												}}
											/>
										</div>
									</DropdownItem>
								)
							})}
						</DropdownList>
					)}
				</DropdownWrapper>

				{/* Context window switcher for Claude Opus 4.6 */}
				<ContextWindowSwitcher
					base1mModelId={`anthropic/claude-opus-4.6${CLAUDE_SONNET_1M_SUFFIX}`}
					base200kModelId="anthropic/claude-opus-4.6"
					onModelChange={handleModelChange}
					selectedModelId={selectedModelId}
				/>

				{/* Context window switcher for Claude Sonnet 4.5 */}
				<ContextWindowSwitcher
					base1mModelId={`anthropic/claude-sonnet-4.5${CLAUDE_SONNET_1M_SUFFIX}`}
					base200kModelId="anthropic/claude-sonnet-4.5"
					onModelChange={handleModelChange}
					selectedModelId={selectedModelId}
				/>

				{/* Context window switcher for Claude Sonnet 4 */}
				<ContextWindowSwitcher
					base1mModelId={`anthropic/claude-sonnet-4${CLAUDE_SONNET_1M_SUFFIX}`}
					base200kModelId="anthropic/claude-sonnet-4"
					onModelChange={handleModelChange}
					selectedModelId={selectedModelId}
				/>
			</div>

			{hasInfo ? (
				<>
					{showBudgetSlider && <ThinkingBudgetSlider currentMode={currentMode} />}
					{showReasoningEffort && <ReasoningEffortSelector currentMode={currentMode} />}

					<ModelInfoView
						isPopup={isPopup}
						modelInfo={selectedModelInfo}
						onProviderSortingChange={(value) => handleFieldChange("openRouterProviderSorting", value)}
						providerSorting={apiConfiguration?.openRouterProviderSorting}
						selectedModelId={selectedModelId}
						showProviderRouting={showProviderRouting}
					/>
				</>
			) : (
				<p
					style={{
						fontSize: "12px",
						marginTop: 0,
						color: "var(--vscode-descriptionForeground)",
					}}>
					The extension automatically fetches the latest Cline model list. If you're unsure which model to choose, Cline
					works best with <strong>anthropic/claude-sonnet-4.5</strong>.
				</p>
			)}
		</div>
	)
}

export default ClineModelPicker

const DropdownWrapper = styled.div`
	position: relative;
	width: 100%;
`

const CLINE_MODEL_PICKER_Z_INDEX = 1_000

const DropdownList = styled.div`
	position: absolute;
	top: calc(100% - 3px);
	left: 0;
	width: calc(100% - 2px);
	max-height: 200px;
	overflow-y: auto;
	background-color: var(--vscode-dropdown-background);
	border: 1px solid var(--vscode-list-activeSelectionBackground);
	z-index: ${CLINE_MODEL_PICKER_Z_INDEX - 1};
	border-bottom-left-radius: 3px;
	border-bottom-right-radius: 3px;
`

const DropdownItem = styled.div<{ isSelected: boolean }>`
	padding: 5px 10px;
	cursor: pointer;
	word-break: break-all;
	white-space: normal;

	background-color: ${({ isSelected }) => (isSelected ? "var(--vscode-list-activeSelectionBackground)" : "inherit")};

	&:hover {
		background-color: var(--vscode-list-activeSelectionBackground);
	}
`

const TabsContainer = styled.div`
	display: flex;
	gap: 0;
	margin-bottom: 12px;
	border-bottom: 1px solid #333;
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
