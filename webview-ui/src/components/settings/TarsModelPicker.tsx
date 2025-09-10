import { tarsDefaultModelId, tarsDefaultModelInfo } from "@shared/api"
import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import { Mode } from "@shared/storage/types"
import { VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import Fuse from "fuse.js"
import React, { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import { useMount } from "react-use"
import styled from "styled-components"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { ModelsServiceClient, StateServiceClient } from "../../services/grpc-client"
import { highlight } from "../history/HistoryView"
import { ModelInfoView } from "./common/ModelInfoView"
import { getModeSpecificFields, normalizeApiConfiguration } from "./utils/providerUtils"
import { useApiConfigurationHandlers } from "./utils/useApiConfigurationHandlers"

// TARS-specific constants.
const TARS_MODEL_PICKER_Z_INDEX = 1_000

export interface TarsModelPickerProps {
	isPopup?: boolean
	currentMode: Mode
}

const TarsModelPicker: React.FC<TarsModelPickerProps> = ({ isPopup, currentMode }) => {
	const { apiConfiguration, tarsModels, setTarsModels } = useExtensionState()
	const { handleModeFieldsChange } = useApiConfigurationHandlers()
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	const [searchTerm, setSearchTerm] = useState(modeFields.tarsModelId || tarsDefaultModelId)
	const [isDropdownVisible, setIsDropdownVisible] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(-1)
	const dropdownRef = useRef<HTMLDivElement>(null)
	const itemRefs = useRef<(HTMLDivElement | null)[]>([])
	const dropdownListRef = useRef<HTMLDivElement>(null)

	const handleModelChange = (newModelId: string) => {
		handleModeFieldsChange(
			{
				tarsModelId: { plan: "planModeTarsModelId", act: "actModeTarsModelId" },
				tarsModelInfo: { plan: "planModeTarsModelInfo", act: "actModeTarsModelInfo" },
			},
			{
				tarsModelId: newModelId,
				tarsModelInfo: tarsModels[newModelId],
			},
			currentMode,
		)
		setSearchTerm(newModelId)
	}

	const { selectedModelId, selectedModelInfo } = useMemo(() => {
		return normalizeApiConfiguration(apiConfiguration, currentMode)
	}, [apiConfiguration, currentMode])

	useMount(() => {
		ModelsServiceClient.refreshTarsModels(EmptyRequest.create({}))
			.then((response) => {
				setTarsModels({
					[tarsDefaultModelId]: tarsDefaultModelInfo,
					...response.models,
				})
			})
			.catch((err) => {
				console.error("Failed to refresh TARS models:", err)
			})
	})

	// Sync external changes when the modelId changes.
	useEffect(() => {
		const currentModelId = modeFields.tarsModelId !== undefined ? modeFields.tarsModelId : tarsDefaultModelId
		setSearchTerm(currentModelId)
	}, [modeFields.tarsModelId])

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
				setIsDropdownVisible(false)
			}
		}
		document.addEventListener("mousedown", handleClickOutside)
		return () => document.removeEventListener("mousedown", handleClickOutside)
	}, [])

	const modelIds = useMemo(() => Object.keys(tarsModels).sort((a, b) => a.localeCompare(b)), [tarsModels])

	const searchableItems = useMemo(() => modelIds.map((id) => ({ id, html: id })), [modelIds])

	const fuse = useMemo(
		() =>
			new Fuse(searchableItems, {
				keys: ["html"],
				threshold: 0.6,
				shouldSort: true,
				isCaseSensitive: false,
				ignoreLocation: false,
				includeMatches: true,
				minMatchCharLength: 1,
			}),
		[searchableItems],
	)

	const modelSearchResults = useMemo(() => {
		const favoritedModelIds = apiConfiguration?.favoritedModelIds || []
		const favoritedModels = searchableItems.filter((item) => favoritedModelIds.includes(item.id))
		const searchResults = searchTerm
			? highlight(fuse.search(searchTerm), "model-item-highlight").filter((item) => !favoritedModelIds.includes(item.id))
			: searchableItems.filter((item) => !favoritedModelIds.includes(item.id))
		return [...favoritedModels, ...searchResults]
	}, [searchableItems, searchTerm, fuse, apiConfiguration?.favoritedModelIds])

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
				}
				break
			case "Escape":
				setIsDropdownVisible(false)
				setSelectedIndex(-1)
				break
		}
	}

	useEffect(() => {
		setSelectedIndex(-1)
		if (dropdownListRef.current) {
			dropdownListRef.current.scrollTop = 0
		}
	}, [searchTerm])

	useEffect(() => {
		if (selectedIndex >= 0 && itemRefs.current[selectedIndex]) {
			itemRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest", behavior: "smooth" })
		}
	}, [selectedIndex])

	return (
		<div style={{ width: "100%" }}>
			<style>{`.model-item-highlight { background-color: var(--vscode-editor-findMatchHighlightBackground); color: inherit; }`}</style>
			<div style={{ display: "flex", flexDirection: "column" }}>
				<label htmlFor="model-search">
					<span style={{ fontWeight: 500 }}>Model</span>
				</label>
				<DropdownWrapper ref={dropdownRef}>
					<VSCodeTextField
						id="model-search"
						onFocus={() => setIsDropdownVisible(true)}
						onInput={(e) => {
							const value = (e.target as HTMLInputElement)?.value?.toLowerCase()
							setSearchTerm(value)
							setIsDropdownVisible(true)
						}}
						onKeyDown={handleKeyDown}
						placeholder="Search and select a model..."
						style={{ width: "100%", zIndex: TARS_MODEL_PICKER_Z_INDEX, position: "relative" }}
						value={searchTerm}>
						{searchTerm && (
							<div
								aria-label="Clear search"
								className="input-icon-button codicon codicon-close"
								onClick={() => {
									handleModelChange("")
									setIsDropdownVisible(true)
								}}
								slot="end"
								style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%" }}
							/>
						)}
					</VSCodeTextField>
					{isDropdownVisible && (
						<DropdownList ref={dropdownListRef}>
							{modelSearchResults.map((item, index) => {
								const isFavorite = (apiConfiguration?.favoritedModelIds || []).includes(item.id)
								return (
									<DropdownItem
										isSelected={index === selectedIndex}
										key={item.id}
										onClick={() => {
											handleModelChange(item.id)
											setIsDropdownVisible(false)
										}}
										onMouseEnter={() => setSelectedIndex(index)}
										ref={(el) => {
											itemRefs.current[index] = el
										}}>
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

			{selectedModelInfo ? (
				<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
			) : (
				<p style={{ fontSize: "12px", marginTop: 0, color: "var(--vscode-descriptionForeground)" }}>
					The extension automatically fetches the latest list of models available on{" "}
					<VSCodeLink href="https://api.router.tetrate.ai/v1/models" style={{ display: "inline", fontSize: "inherit" }}>
						Tetrate Agent Router Service.
					</VSCodeLink>{" "}
					If you're unsure which model to choose, Cline works best with{" "}
					<VSCodeLink
						onClick={() => handleModelChange("claude-3-7-sonnet-latest")}
						style={{ display: "inline", fontSize: "inherit" }}>
						claude-3-7-sonnet-latest.
					</VSCodeLink>
				</p>
			)}
		</div>
	)
}

export default TarsModelPicker

const DropdownWrapper = styled.div`
	position: relative;
	width: 100%;
`

const DropdownList = styled.div`
	position: absolute;
	top: calc(100% - 3px);
	left: 0;
	width: calc(100% - 2px);
	max-height: 200px;
	overflow-y: auto;
	background-color: var(--vscode-dropdown-background);
	border: 1px solid var(--vscode-list-activeSelectionBackground);
	z-index: ${TARS_MODEL_PICKER_Z_INDEX - 1};
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

// Star icon for favorites - imported from OpenRouterModelPicker.
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
