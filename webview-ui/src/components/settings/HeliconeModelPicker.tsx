import { heliconeDefaultModelId } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import Fuse from "fuse.js"
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import styled from "styled-components"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { highlight } from "../history/HistoryView"
import { DropdownContainer as ProviderDropdownContainer } from "./ApiOptions"
import { getModeSpecificFields, normalizeApiConfiguration } from "./utils/providerUtils"
import { useApiConfigurationHandlers } from "./utils/useApiConfigurationHandlers"

export interface HeliconeModelPickerProps {
	isPopup?: boolean
	currentMode: Mode
}

const HeliconeModelPicker: React.FC<HeliconeModelPickerProps> = ({ currentMode }) => {
	const { handleModeFieldsChange } = useApiConfigurationHandlers()
	const { apiConfiguration, favoritedModelIds, heliconeModels, refreshHeliconeModels } = useExtensionState()
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	const [searchTerm, setSearchTerm] = useState(modeFields.heliconeModelId || heliconeDefaultModelId)
	const [isDropdownVisible, setIsDropdownVisible] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(-1)
	const dropdownRef = useRef<HTMLDivElement>(null)
	const itemRefs = useRef<(HTMLDivElement | null)[]>([])
	const dropdownListRef = useRef<HTMLDivElement>(null)

	const handleModelChange = (newModelId: string) => {
		console.log("newModelId", newModelId)
		setSearchTerm(newModelId)
		handleModeFieldsChange(
			{
				heliconeModelId: {
					plan: "planModeHeliconeModelId",
					act: "actModeHeliconeModelId",
				},
				heliconeModelInfo: {
					plan: "planModeHeliconeModelInfo",
					act: "actModeHeliconeModelInfo",
				},
			},
			{
				heliconeModelId: newModelId,
				heliconeModelInfo: heliconeModels[newModelId],
			},
			currentMode,
		)
	}

	const { selectedModelId } = useMemo(
		() => normalizeApiConfiguration(apiConfiguration, currentMode),
		[apiConfiguration, currentMode],
	)

	useEffect(() => {
		refreshHeliconeModels()
	}, [refreshHeliconeModels])

	// Sync external changes when the modelId changes
	useEffect(() => {
		const currentModelId = modeFields.heliconeModelId || heliconeDefaultModelId
		setSearchTerm(currentModelId)
	}, [modeFields.heliconeModelId])

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
				setIsDropdownVisible(false)
			}
		}
		document.addEventListener("mousedown", handleClickOutside)
		return () => document.removeEventListener("mousedown", handleClickOutside)
	}, [])

	const modelIds = useMemo(() => Object.keys(heliconeModels).sort((a, b) => a.localeCompare(b)), [heliconeModels])

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
		const favorited = searchableItems.filter((item) => favoritedModelIds.includes(item.id))
		const rest = searchTerm
			? highlight(fuse.search(searchTerm), "model-item-highlight").filter((i) => !favoritedModelIds.includes(i.id))
			: searchableItems.filter((i) => !favoritedModelIds.includes(i.id))
		return [...favorited, ...rest]
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

	useEffect(() => {
		setSelectedIndex(-1)
		if (dropdownListRef.current) {
			dropdownListRef.current.scrollTop = 0
		}
	}, [searchTerm])

	return (
		<ProviderDropdownContainer ref={dropdownRef}>
			<VSCodeTextField
				data-testid="helicone-model-selector-input"
				id="helicone-model"
				onFocus={() => {
					setIsDropdownVisible(true)
					setSearchTerm(selectedModelId || heliconeDefaultModelId)
				}}
				onInput={(e) => {
					setSearchTerm((e.target as HTMLInputElement)?.value || "")
					setIsDropdownVisible(true)
				}}
				onKeyDown={handleKeyDown}
				placeholder="Search and select model..."
				style={{ width: "100%" }}
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
					{modelSearchResults.map((item, index) => (
						<DropdownItem
							data-testid={`helicone-model-option-${item.id}`}
							isSelected={index === selectedIndex}
							key={item.id}
							onClick={() => {
								handleModelChange(item.id)
								setIsDropdownVisible(false)
							}}
							onMouseEnter={() => setSelectedIndex(index)}
							ref={(el) => (itemRefs.current[index] = el)}>
							<span dangerouslySetInnerHTML={{ __html: item.html }} />
						</DropdownItem>
					))}
				</DropdownList>
			)}
		</ProviderDropdownContainer>
	)
}

export default HeliconeModelPicker

const DropdownList = styled.div`
  position: absolute;
  top: calc(100% - 3px);
  left: 0;
  width: calc(100% - 2px);
  max-height: 200px;
  overflow-y: auto;
  background-color: var(--vscode-dropdown-background);
  border: 1px solid var(--vscode-list-activeSelectionBackground);
  z-index: 1000;
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
