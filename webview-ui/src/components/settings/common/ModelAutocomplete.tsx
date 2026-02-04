import { ModelInfo } from "@shared/api"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import Fuse from "fuse.js"
import { KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react"
import styled from "styled-components"
import { highlight } from "../../history/HistoryView"

interface ModelAutocompleteProps {
	models: Record<string, ModelInfo>
	selectedModelId: string | undefined
	onChange: (modelId: string, modelInfo: ModelInfo | undefined) => void
	zIndex?: number
	label?: string
	placeholder?: string
}

const AUTOCOMPLETE_Z_INDEX = 1_000

export const ModelAutocomplete = ({
	models,
	selectedModelId,
	onChange,
	zIndex = AUTOCOMPLETE_Z_INDEX,
	label = "Model",
	placeholder = "Search and select a model...",
}: ModelAutocompleteProps) => {
	const [searchTerm, setSearchTerm] = useState(selectedModelId || "")
	const [isDropdownVisible, setIsDropdownVisible] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(-1)
	const dropdownRef = useRef<HTMLDivElement>(null)
	const itemRefs = useRef<(HTMLDivElement | null)[]>([])
	const dropdownListRef = useRef<HTMLDivElement>(null)
	const isSelectingRef = useRef(false) // Track if user is clicking a dropdown item

	// Generate unique IDs for accessibility
	const uniqueId = useId()
	const inputId = `model-autocomplete-${uniqueId}`
	const listboxId = `model-listbox-${uniqueId}`

	useEffect(() => {
		setSearchTerm(selectedModelId || "")
	}, [selectedModelId])

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
		return Object.keys(models).sort((a, b) => a.localeCompare(b))
	}, [models])

	const searchableItems = useMemo(() => {
		return modelIds.map((id) => ({
			id,
			html: id,
		}))
	}, [modelIds])

	const fuse = useMemo(() => {
		return new Fuse(searchableItems, {
			keys: ["html"],
			threshold: 0.6,
			shouldSort: true,
			isCaseSensitive: false,
			ignoreLocation: false,
			includeMatches: true,
			minMatchCharLength: 1,
		})
	}, [searchableItems])

	const modelSearchResults = useMemo(() => {
		if (!searchTerm) {
			return searchableItems
		}
		return highlight(fuse.search(searchTerm), "model-item-highlight")
	}, [searchableItems, searchTerm, fuse])

	const handleModelChange = (newModelId: string) => {
		setSearchTerm(newModelId)
		const modelInfo = models[newModelId]
		onChange(newModelId, modelInfo)
	}

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

	// Reset selection when search term changes
	useEffect(() => {
		setSelectedIndex(-1)
		if (dropdownListRef.current) {
			dropdownListRef.current.scrollTop = 0
		}
	}, [searchTerm])

	// Scroll selected item into view
	useEffect(() => {
		if (selectedIndex >= 0 && itemRefs.current[selectedIndex]) {
			itemRefs.current[selectedIndex]?.scrollIntoView({
				block: "nearest",
				behavior: "smooth",
			})
		}
	}, [selectedIndex])

	const activeDescendantId = selectedIndex >= 0 ? `${listboxId}-option-${selectedIndex}` : undefined

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
				<label htmlFor={inputId}>
					<span style={{ fontWeight: 500 }}>{label}</span>
				</label>

				<DropdownWrapper ref={dropdownRef}>
					<VSCodeTextField
						aria-activedescendant={activeDescendantId}
						aria-autocomplete="list"
						aria-controls={isDropdownVisible ? listboxId : undefined}
						aria-expanded={isDropdownVisible}
						id={inputId}
						onBlur={() => {
							// Delay to allow click events on dropdown items to fire first
							setTimeout(() => {
								if (!isSelectingRef.current && searchTerm !== selectedModelId) {
									handleModelChange(searchTerm)
								}
								isSelectingRef.current = false
							}, 150)
						}}
						onFocus={() => setIsDropdownVisible(true)}
						onInput={(e) => {
							setSearchTerm((e.target as HTMLInputElement)?.value || "")
							setIsDropdownVisible(true)
						}}
						onKeyDown={handleKeyDown}
						placeholder={placeholder}
						style={{
							width: "100%",
							zIndex: zIndex,
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
						<DropdownList
							aria-label="Model suggestions"
							id={listboxId}
							ref={dropdownListRef}
							role="listbox"
							style={{ zIndex: zIndex - 1 }}>
							{modelSearchResults.map((item, index) => (
								<DropdownItem
									aria-selected={index === selectedIndex}
									id={`${listboxId}-option-${index}`}
									isSelected={index === selectedIndex}
									key={item.id}
									onClick={() => {
										handleModelChange(item.id)
										setIsDropdownVisible(false)
										isSelectingRef.current = false
									}}
									onMouseDown={() => {
										isSelectingRef.current = true
									}}
									onMouseEnter={() => setSelectedIndex(index)}
									ref={(el) => (itemRefs.current[index] = el)}
									role="option">
									<span dangerouslySetInnerHTML={{ __html: item.html }} />
								</DropdownItem>
							))}
						</DropdownList>
					)}
				</DropdownWrapper>
			</div>
		</div>
	)
}

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
