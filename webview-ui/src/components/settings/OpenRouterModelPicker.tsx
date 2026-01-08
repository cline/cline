import { CLAUDE_SONNET_1M_SUFFIX, openRouterDefaultModelId } from "@shared/api"
import { StringRequest } from "@shared/proto/cline/common"
import type { Mode } from "@shared/storage/types"
import { VSCodeDropdown, VSCodeLink, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
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
import { DropdownContainer } from "./common/ModelSelector"
import FeaturedModelCard from "./FeaturedModelCard"
import ThinkingBudgetSlider from "./ThinkingBudgetSlider"
import { filterOpenRouterModelIds, getModeSpecificFields, normalizeApiConfiguration } from "./utils/providerUtils"
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

export interface OpenRouterModelPickerProps {
	isPopup?: boolean
	currentMode: Mode
	showProviderRouting?: boolean
}

// Featured models for Cline provider organized by tabs
export const recommendedModels = [
	{
		id: "anthropic/claude-sonnet-4.5",
		description: "Best balance of speed, cost, and quality",
		label: "BEST",
	},
	{
		id: "google/gemini-3-flash-preview",
		description: "Intelligent model built for speed and price efficiency",
		label: "NEW",
	},
	{
		id: "anthropic/claude-opus-4.5",
		description: "State-of-the-art for complex coding",
		label: "HOT",
	},
	{
		id: "openai/gpt-5.2",
		description: "OpenAI's latest with strong coding abilities",
		label: "NEW",
	},
	{
		id: "google/gemini-3-pro-preview",
		description: "1M context window for large codebases",
		label: "1M CTX",
	},
]

export const freeModels = [
	{
		id: "minimax/minimax-m2.1",
		description: "Open source model with solid performance",
		label: "FREE",
	},
	{
		id: "x-ai/grok-code-fast-1",
		description: "Fast inference with strong coding performance",
		label: "FREE",
	},
	{
		id: "mistralai/devstral-2512:free",
		description: "Mistral's latest model with strong coding abilities",
		label: "FREE",
	},
]

const FREE_CLINE_MODELS = freeModels.map((m) => m.id)

const OpenRouterModelPicker: React.FC<OpenRouterModelPickerProps> = ({ isPopup, currentMode, showProviderRouting }) => {
	const { handleModeFieldChange, handleModeFieldsChange, handleFieldChange } = useApiConfigurationHandlers()
	const { apiConfiguration, favoritedModelIds, openRouterModels, refreshOpenRouterModels } = useExtensionState()
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	const [searchTerm, setSearchTerm] = useState(modeFields.openRouterModelId || openRouterDefaultModelId)
	const [isDropdownVisible, setIsDropdownVisible] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(-1)
	const [activeTab, setActiveTab] = useState<"recommended" | "free">(() => {
		const currentModelId = modeFields.openRouterModelId || openRouterDefaultModelId
		return freeModels.some((m) => m.id === currentModelId) ? "free" : "recommended"
	})
	const dropdownRef = useRef<HTMLDivElement>(null)
	const itemRefs = useRef<(HTMLDivElement | null)[]>([])
	const dropdownListRef = useRef<HTMLDivElement>(null)

	const handleModelChange = (newModelId: string) => {
		// could be setting invalid model id/undefined info but validation will catch it

		setSearchTerm(newModelId)

		handleModeFieldsChange(
			{
				openRouterModelId: { plan: "planModeOpenRouterModelId", act: "actModeOpenRouterModelId" },
				openRouterModelInfo: { plan: "planModeOpenRouterModelInfo", act: "actModeOpenRouterModelInfo" },
			},
			{
				openRouterModelId: newModelId,
				openRouterModelInfo: openRouterModels[newModelId],
			},
			currentMode,
		)
	}

	const { selectedModelId, selectedModelInfo } = useMemo(() => {
		const selected = normalizeApiConfiguration(apiConfiguration, currentMode)
		const isCline = selected.selectedProvider === "cline"
		// Makes sure "Free" featured models have $0 pricing for Cline provider
		if (isCline && FREE_CLINE_MODELS.includes(selected.selectedModelId)) {
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

	useMount(refreshOpenRouterModels)

	// Sync external changes when the modelId changes
	useEffect(() => {
		const currentModelId = modeFields.openRouterModelId || openRouterDefaultModelId
		setSearchTerm(currentModelId)
	}, [modeFields.openRouterModelId])

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
		const unfilteredModelIds = Object.keys(openRouterModels).sort((a, b) => a.localeCompare(b))
		return filterOpenRouterModelIds(unfilteredModelIds, modeFields.apiProvider || "openrouter")
	}, [openRouterModels, modeFields.apiProvider])

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
		// IMPORTANT: highlightjs has a bug where if you use sort/localCompare - "// results.sort((a, b) => a.id.localeCompare(b.id)) ...sorting like this causes ids in objects to be reordered and mismatched"

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
					// User typed a custom model ID (e.g., @preset/something)
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
				return false // Disable model info for presets
			}
			return modelIds.some((id) => id.toLowerCase() === searchTerm.toLowerCase())
		} catch {
			return false
		}
	}, [modelIds, searchTerm])

	const isOpenRouterPreset = useMemo(() => {
		return searchTerm.startsWith("@preset/")
	}, [searchTerm])

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

	const showBudgetSlider = useMemo(() => {
		return (
			Object.entries(openRouterModels)?.some(([id, m]) => id === selectedModelId && m.thinkingConfig) ||
			selectedModelId?.toLowerCase().includes("claude-haiku-4.5") ||
			selectedModelId?.toLowerCase().includes("claude-4.5-haiku") ||
			selectedModelId?.toLowerCase().includes("claude-sonnet-4.5") ||
			selectedModelId?.toLowerCase().includes("claude-sonnet-4") ||
			selectedModelId?.toLowerCase().includes("claude-opus-4.1") ||
			selectedModelId?.toLowerCase().includes("claude-opus-4") ||
			selectedModelId?.toLowerCase().includes("claude-opus-4.5") ||
			selectedModelId?.toLowerCase().includes("claude-3-7-sonnet") ||
			selectedModelId?.toLowerCase().includes("claude-3.7-sonnet") ||
			selectedModelId?.toLowerCase().includes("claude-3.7-sonnet:thinking")
		)
	}, [selectedModelId])

	const showThinkingLevel = useMemo(() => {
		return selectedModelId?.toLowerCase().includes("gemini") && selectedModelId?.includes("3")
	}, [selectedModelId])

	const geminiThinkingLevel =
		currentMode === "plan" ? apiConfiguration?.geminiPlanModeThinkingLevel : apiConfiguration?.geminiActModeThinkingLevel

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

				{modeFields.apiProvider === "cline" && (
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
				)}

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
						style={{
							width: "100%",
							zIndex: OPENROUTER_MODEL_PICKER_Z_INDEX,
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
						<DropdownList ref={dropdownListRef}>
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
										ref={(el) => (itemRefs.current[index] = el)}>
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
					{showBudgetSlider && !showThinkingLevel && <ThinkingBudgetSlider currentMode={currentMode} />}

					{showThinkingLevel && (
						<DropdownContainer className="dropdown-container" zIndex={1}>
							<label htmlFor="thinking-level">
								<span className="font-medium">Thinking Level</span>
							</label>
							<VSCodeDropdown
								className="w-full"
								id="thinking-level"
								onChange={(e: any) =>
									handleModeFieldChange(
										{ plan: "geminiPlanModeThinkingLevel", act: "geminiActModeThinkingLevel" },
										e.target.value,
										currentMode,
									)
								}
								value={geminiThinkingLevel || "high"}>
								<VSCodeOption value="low">Low</VSCodeOption>
								<VSCodeOption value="high">High</VSCodeOption>
							</VSCodeDropdown>
						</DropdownContainer>
					)}

					<ModelInfoView
						isPopup={isPopup}
						modelInfo={selectedModelInfo}
						onProviderSortingChange={(value) => handleFieldChange("openRouterProviderSorting", value)}
						providerSorting={apiConfiguration?.openRouterProviderSorting}
						selectedModelId={selectedModelId}
						showProviderRouting={showProviderRouting}
					/>
				</>
			) : isOpenRouterPreset ? (
				<p
					style={{
						fontSize: "12px",
						marginTop: 3,
						color: "var(--vscode-descriptionForeground)",
					}}>
					Using OpenRouter preset: <strong>{searchTerm}</strong>. Preset models reference your configured model
					preferences on{" "}
					<VSCodeLink href="https://openrouter.ai/settings/presets" style={{ display: "inline", fontSize: "inherit" }}>
						OpenRouter.
					</VSCodeLink>
					Model info and pricing will depend on your preset configuration.
				</p>
			) : (
				<p
					style={{
						fontSize: "12px",
						marginTop: 0,
						color: "var(--vscode-descriptionForeground)",
					}}>
					The extension automatically fetches the latest list of models available on{" "}
					<VSCodeLink href="https://openrouter.ai/models" style={{ display: "inline", fontSize: "inherit" }}>
						OpenRouter.
					</VSCodeLink>
					If you're unsure which model to choose, Cline works best with{" "}
					<VSCodeLink
						onClick={() => handleModelChange("anthropic/claude-sonnet-4.5")}
						style={{ display: "inline", fontSize: "inherit" }}>
						anthropic/claude-sonnet-4.5.
					</VSCodeLink>
					You can also try searching "free" for no-cost options currently available. OpenRouter presets can be used by
					entering @preset/your-preset-name
				</p>
			)}
		</div>
	)
}

export default OpenRouterModelPicker

// Dropdown

const DropdownWrapper = styled.div`
	position: relative;
	width: 100%;
`

export const OPENROUTER_MODEL_PICKER_Z_INDEX = 1_000

const DropdownList = styled.div`
	position: absolute;
	top: calc(100% - 3px);
	left: 0;
	width: calc(100% - 2px);
	max-height: 200px;
	overflow-y: auto;
	background-color: var(--vscode-dropdown-background);
	border: 1px solid var(--vscode-list-activeSelectionBackground);
	z-index: ${OPENROUTER_MODEL_PICKER_Z_INDEX - 1};
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

// Tabs

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
