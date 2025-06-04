import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import Fuse from "fuse.js"
import React, { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import { useMount } from "react-use"
import styled from "styled-components"
import { makehubDefaultModelId } from "@shared/api"
import { StringRequest } from "@shared/proto/common"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import { vscode } from "@/utils/vscode"
import { ModelInfoView, normalizeApiConfiguration } from "./ApiOptions"

export const MAKEHUB_MODEL_PICKER_Z_INDEX = 1_000

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

// Custom component for the search bar
const CustomSearchInput = styled.input`
	width: 100%;
	padding: 4px 8px;
	background-color: var(--vscode-input-background);
	color: var(--vscode-input-foreground);
	border: 1px solid var(--vscode-input-border, transparent);
	outline: none;
	font-family: var(--vscode-font-family);
	font-size: var(--vscode-font-size);
	line-height: 1.4;
	box-sizing: border-box;

	&:focus {
		border-color: var(--vscode-focusBorder);
	}

	&::placeholder {
		color: var(--vscode-input-placeholderForeground);
	}
`

const ClearButton = styled.div`
	position: absolute;
	right: 8px;
	top: 50%;
	transform: translateY(-50%);
	cursor: pointer;
	display: flex;
	align-items: center;
	justify-content: center;
	color: var(--vscode-descriptionForeground);

	&:hover {
		color: var(--vscode-foreground);
	}
`

// Utility function to highlight text - simplified
const highlightText = (text: string, query: string): string => {
	if (!query) return text

	const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi")
	return text.replace(regex, '<span class="model-item-highlight">$1</span>')
}

export interface MakehubModelPickerProps {
	isPopup?: boolean
}

const MakehubModelPicker: React.FC<MakehubModelPickerProps> = ({ isPopup }) => {
	const { apiConfiguration, setApiConfiguration, makehubModels } = useExtensionState()

	// Initial state based on the currently selected model
	const initialModelId = apiConfiguration?.makehubModelId || makehubDefaultModelId
	const initialDisplayName = makehubModels[initialModelId]?.displayName || initialModelId

	// State for input field and dropdown
	const [inputValue, setInputValue] = useState(initialDisplayName)
	const [isDropdownVisible, setIsDropdownVisible] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(-1)

	// States for model descriptions and information
	const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false)

	// References for accessibility and scrolling
	const dropdownRef = useRef<HTMLDivElement>(null)
	const inputRef = useRef<HTMLInputElement>(null)
	const itemRefs = useRef<(HTMLDivElement | null)[]>([])
	const dropdownListRef = useRef<HTMLDivElement>(null)

	// Get the list of model IDs sorted alphabetically
	const modelIds = useMemo(() => {
		return Object.keys(makehubModels || {}).sort((a, b) => a.localeCompare(b))
	}, [makehubModels])

	// Create a flat list of items for search
	const searchableItems = useMemo(() => {
		return modelIds.map((id) => {
			const displayName = makehubModels[id]?.displayName || id
			return {
				id,
				displayName,
				searchText: `${displayName} ${id}`.toLowerCase(),
			}
		})
	}, [modelIds, makehubModels])

	// Fuse.js configuration for search
	const fuse = useMemo(() => {
		return new Fuse(searchableItems, {
			keys: ["searchText"],
			threshold: 0.4,
			ignoreLocation: true,
			isCaseSensitive: false,
		})
	}, [searchableItems])

	// Filtered and formatted search results
	const filteredItems = useMemo(() => {
		const favoritedModelIds = apiConfiguration?.favoritedModelIds || []

		// Separate favorites from the rest
		const favoritedModels = searchableItems.filter((item) => favoritedModelIds.includes(item.id))

		// For the remaining items, filter according to search
		let searchResults = []
		if (isDropdownVisible && inputValue.trim() !== "") {
			const results = fuse.search(inputValue)
			searchResults = results.map((result) => result.item).filter((item) => !favoritedModelIds.includes(item.id))
		} else {
			searchResults = searchableItems.filter((item) => !favoritedModelIds.includes(item.id))
		}

		// Combine favorites and search results
		return [...favoritedModels, ...searchResults]
	}, [searchableItems, inputValue, isDropdownVisible, fuse, apiConfiguration?.favoritedModelIds])

	// Get the selected model and its information
	const { selectedModelId, selectedModelInfo } = useMemo(() => {
		return normalizeApiConfiguration(apiConfiguration)
	}, [apiConfiguration])

	// Handle clicks outside the dropdown to close it
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
				setIsDropdownVisible(false)
				// Restore initial display value if no selection
				const currentModelId = apiConfiguration?.makehubModelId || makehubDefaultModelId
				const currentDisplayName = makehubModels[currentModelId]?.displayName || currentModelId
				setInputValue(currentDisplayName)
			}
		}

		document.addEventListener("mousedown", handleClickOutside)
		return () => {
			document.removeEventListener("mousedown", handleClickOutside)
		}
	}, [apiConfiguration?.makehubModelId, makehubModels, makehubDefaultModelId])

	// Reset selected index and scroll to top when input changes
	useEffect(() => {
		setSelectedIndex(-1)
		if (dropdownListRef.current) {
			dropdownListRef.current.scrollTop = 0
		}
	}, [inputValue])

	// Scroll selected item into view
	useEffect(() => {
		if (selectedIndex >= 0 && itemRefs.current[selectedIndex]) {
			itemRefs.current[selectedIndex]?.scrollIntoView({
				block: "nearest",
				behavior: "smooth",
			})
		}
	}, [selectedIndex])

	// Function to handle model selection change
	const handleModelSelect = (modelId: string) => {
		setApiConfiguration({
			...apiConfiguration,
			makehubModelId: modelId,
			makehubModelInfo: makehubModels[modelId],
		})

		// Update input with model name without formatting
		const displayName = makehubModels[modelId]?.displayName || modelId
		setInputValue(displayName)
		setIsDropdownVisible(false)
	}

	// Handle keyboard inputs
	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (!isDropdownVisible) return

		switch (event.key) {
			case "ArrowDown":
				event.preventDefault()
				setSelectedIndex((prev) => (prev < filteredItems.length - 1 ? prev + 1 : prev))
				break
			case "ArrowUp":
				event.preventDefault()
				setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0))
				break
			case "Enter":
				event.preventDefault()
				if (selectedIndex >= 0 && selectedIndex < filteredItems.length) {
					handleModelSelect(filteredItems[selectedIndex].id)
				}
				break
			case "Escape":
				event.preventDefault()
				setIsDropdownVisible(false)
				// Restore display value
				const currentModelId = apiConfiguration?.makehubModelId || makehubDefaultModelId
				const currentDisplayName = makehubModels[currentModelId]?.displayName || currentModelId
				setInputValue(currentDisplayName)
				break
		}
	}

	// Handle input changes
	const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		setInputValue(e.target.value)
		if (!isDropdownVisible) {
			setIsDropdownVisible(true)
		}
	}

	// Handle focus on input
	const handleFocus = () => {
		setIsDropdownVisible(true)
		if (inputRef.current) {
			inputRef.current.select()
		}
	}

	// Clear input
	const handleClear = () => {
		setInputValue("")
		setIsDropdownVisible(true)
		if (inputRef.current) {
			inputRef.current.focus()
		}
	}

	// Check if selected model has information
	const hasInfo = useMemo(() => {
		try {
			const currentModelId = apiConfiguration?.makehubModelId || ""
			return modelIds.includes(currentModelId)
		} catch {
			return false
		}
	}, [modelIds, apiConfiguration?.makehubModelId])

	return (
		<div style={{ width: "100%" }}>
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
					<div style={{ position: "relative" }}>
						<CustomSearchInput
							ref={inputRef}
							id="model-search"
							placeholder="Search and select a model..."
							value={inputValue}
							onChange={handleInputChange}
							onFocus={handleFocus}
							onKeyDown={handleKeyDown}
						/>
						{inputValue && (
							<ClearButton onClick={handleClear}>
								<span className="codicon codicon-close" />
							</ClearButton>
						)}
					</div>
					{isDropdownVisible && (
						<DropdownList ref={dropdownListRef}>
							{filteredItems.length === 0 ? (
								<div style={{ padding: "8px 10px", color: "var(--vscode-descriptionForeground)" }}>
									No models found
								</div>
							) : (
								filteredItems.map((item, index) => {
									const isFavorite = (apiConfiguration?.favoritedModelIds || []).includes(item.id)

									// Générer le contenu HTML surligné uniquement pour l'affichage de la liste
									const displayContent =
										inputValue.trim() !== "" ? highlightText(item.displayName, inputValue) : item.displayName

									return (
										<DropdownItem
											key={item.id}
											ref={(el) => (itemRefs.current[index] = el)}
											isSelected={index === selectedIndex}
											onMouseEnter={() => setSelectedIndex(index)}
											onClick={() => handleModelSelect(item.id)}>
											<div
												style={{
													display: "flex",
													justifyContent: "space-between",
													alignItems: "center",
												}}>
												<span dangerouslySetInnerHTML={{ __html: displayContent }} />
												<StarIcon
													isFavorite={isFavorite}
													onClick={(e) => {
														e.stopPropagation()
														StateServiceClient.toggleFavoriteModel(
															StringRequest.create({ value: item.id }),
														).catch((error) =>
															console.error("Failed to toggle favorite model:", error),
														)
													}}
												/>
											</div>
										</DropdownItem>
									)
								})
							)}
						</DropdownList>
					)}
				</DropdownWrapper>
			</div>

			{hasInfo ? (
				<ModelInfoView
					selectedModelId={selectedModelId}
					modelInfo={selectedModelInfo}
					isDescriptionExpanded={isDescriptionExpanded}
					setIsDescriptionExpanded={setIsDescriptionExpanded}
					isPopup={isPopup}
				/>
			) : (
				<p
					style={{
						fontSize: "12px",
						marginTop: 0,
						color: "var(--vscode-descriptionForeground)",
					}}>
					<>
						The extension automatically retrieves the list of available models on{" "}
						<VSCodeLink style={{ display: "inline", fontSize: "inherit" }} href="https://makehub.ai/models">
							MakeHub.
						</VSCodeLink>{" "}
						If you don't see any models, please check your API key and internet connection.
					</>
				</p>
			)}
		</div>
	)
}

export default MakehubModelPicker

// Styled components for dropdown
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
	z-index: ${MAKEHUB_MODEL_PICKER_Z_INDEX - 1};
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
