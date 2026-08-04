import { openAiModelInfoSafeDefaults, openRouterDefaultModelId, openRouterDefaultModelInfo } from "@shared/api"
import { StringRequest } from "@shared/proto/cline/common"
import type { Mode } from "@shared/storage/types"
import { isClaudeOpusAdaptiveThinkingModel, resolveClaudeOpusAdaptiveThinking } from "@shared/utils/reasoning-support"
import { VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import Fuse from "fuse.js"
import type React from "react"
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import { useMount } from "react-use"
import styled from "styled-components"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useNormalizedApiConfiguration } from "@/hooks/useNormalizedApiConfiguration"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { StateServiceClient } from "@/services/grpc-client"
import { highlight } from "../history/HistoryView"
import { ModelInfoView } from "./common/ModelInfoView"
import ReasoningEffortSelector from "./ReasoningEffortSelector"
import { filterOpenRouterModelIds, getModeSpecificFields } from "./utils/providerUtils"
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

interface OpenRouterModelPickerProps {
	isPopup?: boolean
	currentMode: Mode
	showProviderRouting?: boolean
}

const OpenRouterModelPicker: React.FC<OpenRouterModelPickerProps> = ({ isPopup, currentMode, showProviderRouting }) => {
	const { handleModeFieldsChange, handleFieldChange } = useApiConfigurationHandlers()
	const { commitSelection, write } = useProviderConfig("openrouter")
	const { apiConfiguration, favoritedModelIds, openRouterModels, refreshOpenRouterModels } = useExtensionState()
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	const [searchTerm, setSearchTerm] = useState(modeFields.openRouterModelId || openRouterDefaultModelId)
	const [isDropdownVisible, setIsDropdownVisible] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(-1)
	const dropdownRef = useRef<HTMLDivElement>(null)
	const itemRefs = useRef<(HTMLDivElement | null)[]>([])
	const dropdownListRef = useRef<HTMLDivElement>(null)

	const handleModelChange = (newModelId: string) => {
		// could be setting invalid model id/undefined info but validation will catch it

		setSearchTerm(newModelId)

		const modelInfo = openRouterModels[newModelId] ?? { ...openAiModelInfoSafeDefaults, name: newModelId }

		handleModeFieldsChange(
			{
				openRouterModelId: { plan: "planModeOpenRouterModelId", act: "actModeOpenRouterModelId" },
				openRouterModelInfo: { plan: "planModeOpenRouterModelInfo", act: "actModeOpenRouterModelInfo" },
			},
			{
				openRouterModelId: newModelId,
				openRouterModelInfo: modelInfo,
			},
			currentMode,
		)

		void commitSelection(currentMode, { providerId: "openrouter", modelId: newModelId }).catch((err) =>
			console.error("Failed to commit OpenRouter model selection:", err),
		)
	}

	// The mode-specific fields are the primary source, but they can be empty
	// even when a model is committed — e.g. right after the SDK provider
	// migration, which records the model in providers.json but not in the
	// openRouterModelId/Info state this picker reads. In that case fall back to
	// the authoritative resolver (which reads the committed providers.json
	// selection) instead of the hardcoded openRouterDefaultModelId, so the
	// picker shows the model that will actually run. Committed-field users are
	// unaffected: their field wins and the resolver is never consulted for id.
	const { selectedModelId: resolvedModelId, selectedModelInfo: resolvedModelInfo } = useNormalizedApiConfiguration(currentMode)
	const selectedModelId = modeFields.openRouterModelId || resolvedModelId || openRouterDefaultModelId
	// The resolver substitutes its provider default for ids it cannot resolve,
	// so its info is only trustworthy when it answered for the id actually
	// shown. Prefer the live catalog entry for the displayed id (synchronous
	// once fetched), then the matching resolver answer; never render another
	// model's metadata under the displayed model's name.
	const selectedModelInfo =
		modeFields.openRouterModelInfo ??
		openRouterModels[selectedModelId] ??
		(resolvedModelId === selectedModelId ? resolvedModelInfo : openRouterDefaultModelInfo)

	useMount(() => {
		refreshOpenRouterModels()
	})

	// Sync external changes when the modelId changes
	useEffect(() => {
		const currentModelId = modeFields.openRouterModelId || resolvedModelId || openRouterDefaultModelId
		setSearchTerm(currentModelId)
	}, [modeFields.openRouterModelId, resolvedModelId])

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
		return filterOpenRouterModelIds(unfilteredModelIds, "openrouter")
	}, [openRouterModels])

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
					// User typed a custom model ID
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

	const showAdaptiveThinkingEffort = useMemo(() => isClaudeOpusAdaptiveThinkingModel(selectedModelId), [selectedModelId])
	const adaptiveThinkingDefaultEffort = useMemo(
		() => resolveClaudeOpusAdaptiveThinking(modeFields.reasoningEffort, modeFields.thinkingBudgetTokens).effort ?? "none",
		[modeFields.reasoningEffort, modeFields.thinkingBudgetTokens],
	)
	// Reasoning support comes from the SDK catalog (models.dev), not model-id
	// heuristics: any reasoning-capable model gets the effort selector. Prefer
	// the live catalog entry over the committed legacy snapshot — the snapshot
	// can be cleared by provider-config writes (fallback-source resolutions).
	// Read the raw snapshot field (not the hook's default-info fallback) so an
	// id that is absent from the catalog never inherits reasoning support from
	// placeholder metadata.
	const showReasoningEffort =
		showAdaptiveThinkingEffort ||
		(openRouterModels[selectedModelId] ?? modeFields.openRouterModelInfo)?.supportsReasoning === true
	const handleReasoningEffortChange = (effort: string) => {
		void write({
			reasoning: { enabled: effort !== "none", effort: effort !== "none" ? effort : undefined },
		}).catch((err) => console.error("Failed to update OpenRouter reasoning effort:", err))
	}

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
			</div>

			{hasInfo ? (
				<>
					{showReasoningEffort && (
						<ReasoningEffortSelector
							currentMode={currentMode}
							defaultEffort={showAdaptiveThinkingEffort ? adaptiveThinkingDefaultEffort : "none"}
							description={
								showAdaptiveThinkingEffort
									? "Use None to disable adaptive thinking. Higher effort increases response detail and token usage."
									: "Use None to disable extended thinking. Higher effort improves depth, but uses more tokens."
							}
							label={showAdaptiveThinkingEffort ? "Adaptive Thinking" : undefined}
							onEffortChange={handleReasoningEffortChange}
						/>
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
					If you're unsure which model to choose, compare available models by context window, pricing, and capabilities.
					You can also try searching "free" for no-cost options currently available.
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
	color: ${({ isSelected }) => (isSelected ? "var(--vscode-list-activeSelectionForeground, inherit)" : "inherit")};

	&:hover {
		background-color: var(--vscode-list-activeSelectionBackground);
		color: var(--vscode-list-activeSelectionForeground, inherit);
	}
`
