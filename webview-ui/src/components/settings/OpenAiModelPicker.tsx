import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import debounce from "debounce"
import { Fzf } from "fzf"
import React, { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"

import { useExtensionState } from "../../context/ExtensionStateContext"
import { vscode } from "../../utils/vscode"
import { highlightFzfMatch } from "../../utils/highlight"
import { DropdownWrapper, DropdownList, DropdownItem } from "./styles"

const OpenAiModelPicker: React.FC = () => {
	const { apiConfiguration, setApiConfiguration, openAiModels, onUpdateApiConfig } = useExtensionState()
	const [searchTerm, setSearchTerm] = useState(apiConfiguration?.openAiModelId || "")
	const [isDropdownVisible, setIsDropdownVisible] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(-1)
	const dropdownRef = useRef<HTMLDivElement>(null)
	const itemRefs = useRef<(HTMLDivElement | null)[]>([])
	const dropdownListRef = useRef<HTMLDivElement>(null)

	const handleModelChange = (newModelId: string) => {
		// could be setting invalid model id/undefined info but validation will catch it
		const apiConfig = {
			...apiConfiguration,
			openAiModelId: newModelId,
		}

		setApiConfiguration(apiConfig)
		onUpdateApiConfig(apiConfig)
		setSearchTerm(newModelId)
	}

	useEffect(() => {
		if (apiConfiguration?.openAiModelId && apiConfiguration?.openAiModelId !== searchTerm) {
			setSearchTerm(apiConfiguration?.openAiModelId)
		}
	}, [apiConfiguration, searchTerm])

	const debouncedRefreshModels = useMemo(
		() =>
			debounce((baseUrl: string, apiKey: string) => {
				vscode.postMessage({
					type: "refreshOpenAiModels",
					values: {
						baseUrl,
						apiKey,
					},
				})
			}, 50),
		[],
	)

	useEffect(() => {
		if (!apiConfiguration?.openAiBaseUrl || !apiConfiguration?.openAiApiKey) {
			return
		}

		debouncedRefreshModels(apiConfiguration.openAiBaseUrl, apiConfiguration.openAiApiKey)

		// Cleanup debounced function
		return () => {
			debouncedRefreshModels.clear()
		}
	}, [apiConfiguration?.openAiBaseUrl, apiConfiguration?.openAiApiKey, debouncedRefreshModels])

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
		return openAiModels.sort((a, b) => a.localeCompare(b))
	}, [openAiModels])

	const searchableItems = useMemo(() => {
		return modelIds.map((id) => ({
			id,
			html: id,
		}))
	}, [modelIds])

	const fzf = useMemo(() => {
		return new Fzf(searchableItems, {
			selector: (item) => item.html,
		})
	}, [searchableItems])

	const modelSearchResults = useMemo(() => {
		if (!searchTerm) return searchableItems

		const searchResults = fzf.find(searchTerm)
		return searchResults.map((result) => ({
			...result.item,
			html: highlightFzfMatch(result.item.html, Array.from(result.positions), "model-item-highlight"),
		}))
	}, [searchableItems, searchTerm, fzf])

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (!isDropdownVisible) return

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
			itemRefs.current[selectedIndex]?.scrollIntoView({
				block: "nearest",
				behavior: "smooth",
			})
		}
	}, [selectedIndex])

	return (
		<>
			<style>
				{`
				.model-item-highlight {
					background-color: var(--vscode-editor-findMatchHighlightBackground);
					color: inherit;
				}
				`}
			</style>
			<div>
				<DropdownWrapper ref={dropdownRef}>
					<VSCodeTextField
						id="model-search"
						placeholder="Search and select a model..."
						value={searchTerm}
						onInput={(e) => {
							handleModelChange((e.target as HTMLInputElement)?.value)
							setIsDropdownVisible(true)
						}}
						onFocus={() => setIsDropdownVisible(true)}
						onKeyDown={handleKeyDown}
						style={{ width: "100%", zIndex: OPENAI_MODEL_PICKER_Z_INDEX, position: "relative" }}>
						{searchTerm && (
							<div
								className="input-icon-button codicon codicon-close"
								aria-label="Clear search"
								onClick={() => {
									handleModelChange("")
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
						<DropdownList ref={dropdownListRef} $zIndex={OPENAI_MODEL_PICKER_Z_INDEX - 1}>
							{modelSearchResults.map((item, index) => (
								<DropdownItem
									$selected={index === selectedIndex}
									key={item.id}
									ref={(el) => (itemRefs.current[index] = el)}
									onMouseEnter={() => setSelectedIndex(index)}
									onClick={() => {
										handleModelChange(item.id)
										setIsDropdownVisible(false)
									}}
									dangerouslySetInnerHTML={{
										__html: item.html,
									}}
								/>
							))}
						</DropdownList>
					)}
				</DropdownWrapper>
			</div>
		</>
	)
}

export default OpenAiModelPicker

// Dropdown

export const OPENAI_MODEL_PICKER_Z_INDEX = 1_000
