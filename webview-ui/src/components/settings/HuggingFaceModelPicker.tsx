import { EmptyRequest } from "@shared/proto/common"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import Fuse from "fuse.js"
import React, { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import { useMount } from "react-use"
import { huggingFaceDefaultModelId, huggingFaceModels } from "@shared/api"
import { Mode } from "@shared/ChatSettings"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { ModelsServiceClient } from "../../services/grpc-client"
import { highlight } from "../history/HistoryView"
import { ModelInfoView } from "./common/ModelInfoView"
import { normalizeApiConfiguration, getModeSpecificFields } from "./utils/providerUtils"
import { useApiConfigurationHandlers } from "./utils/useApiConfigurationHandlers"

export interface HuggingFaceModelPickerProps {
	isPopup?: boolean
	currentMode: Mode
}

const HuggingFaceModelPicker: React.FC<HuggingFaceModelPickerProps> = ({ isPopup, currentMode }) => {
	const { apiConfiguration, huggingFaceModels: dynamicModels, setHuggingFaceModels } = useExtensionState()
	const { handleModeFieldsChange } = useApiConfigurationHandlers()
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	const [searchTerm, setSearchTerm] = useState(modeFields.huggingFaceModelId || huggingFaceDefaultModelId)
	const [isDropdownVisible, setIsDropdownVisible] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(-1)
	const dropdownRef = useRef<HTMLDivElement>(null)
	const itemRefs = useRef<(HTMLDivElement | null)[]>([])
	const dropdownListRef = useRef<HTMLDivElement>(null)

	const handleModelChange = (newModelId: string) => {
		const allModels = { ...huggingFaceModels, ...dynamicModels }
		const modelInfo = allModels[newModelId as keyof typeof allModels]

		handleModeFieldsChange(
			{
				huggingFaceModelId: { plan: "planModeHuggingFaceModelId", act: "actModeHuggingFaceModelId" },
				huggingFaceModelInfo: { plan: "planModeHuggingFaceModelInfo", act: "actModeHuggingFaceModelInfo" },
			},
			{
				huggingFaceModelId: newModelId,
				huggingFaceModelInfo: modelInfo,
			},
			currentMode,
		)
		setSearchTerm(newModelId)
	}

	const { selectedModelId, selectedModelInfo } = useMemo(() => {
		return normalizeApiConfiguration(apiConfiguration, currentMode)
	}, [apiConfiguration, currentMode])

	useMount(() => {
		ModelsServiceClient.refreshHuggingFaceModels(EmptyRequest.create({}))
			.then((response) => {
				setHuggingFaceModels({
					[huggingFaceDefaultModelId]: huggingFaceModels[huggingFaceDefaultModelId],
					...response.models,
				})
			})
			.catch((err) => {
				console.error("Failed to refresh Hugging Face models:", err)
			})
	})

	// Sync external changes when the modelId changes
	useEffect(() => {
		const currentModelId = modeFields.huggingFaceModelId || huggingFaceDefaultModelId
		setSearchTerm(currentModelId)
	}, [modeFields.huggingFaceModelId])

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

	const allModels = useMemo(() => {
		return { ...huggingFaceModels, ...dynamicModels }
	}, [dynamicModels])

	const modelIds = useMemo(() => {
		return Object.keys(allModels).sort((a, b) => a.localeCompare(b))
	}, [allModels])

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
		let results: { id: string; html: string }[] = searchTerm
			? highlight(fuse.search(searchTerm), "model-item-highlight")
			: searchableItems
		return results
	}, [searchTerm, fuse, searchableItems])

	const handleKeyDown = (e: KeyboardEvent<HTMLElement>) => {
		if (!isDropdownVisible) return

		switch (e.key) {
			case "ArrowDown":
				e.preventDefault()
				setSelectedIndex((prev) => (prev < modelSearchResults.length - 1 ? prev + 1 : 0))
				break
			case "ArrowUp":
				e.preventDefault()
				setSelectedIndex((prev) => (prev > 0 ? prev - 1 : modelSearchResults.length - 1))
				break
			case "Enter":
				e.preventDefault()
				if (selectedIndex >= 0 && selectedIndex < modelSearchResults.length) {
					const selectedModelId = modelSearchResults[selectedIndex].id
					handleModelChange(selectedModelId)
					setIsDropdownVisible(false)
				}
				break
			case "Escape":
				e.preventDefault()
				setIsDropdownVisible(false)
				break
		}
	}

	useEffect(() => {
		if (selectedIndex >= 0 && itemRefs.current[selectedIndex] && dropdownListRef.current) {
			const selectedItem = itemRefs.current[selectedIndex]
			const dropdown = dropdownListRef.current
			const itemOffsetTop = selectedItem.offsetTop
			const itemHeight = selectedItem.offsetHeight
			const dropdownScrollTop = dropdown.scrollTop
			const dropdownHeight = dropdown.offsetHeight

			if (itemOffsetTop < dropdownScrollTop) {
				dropdown.scrollTop = itemOffsetTop
			} else if (itemOffsetTop + itemHeight > dropdownScrollTop + dropdownHeight) {
				dropdown.scrollTop = itemOffsetTop + itemHeight - dropdownHeight
			}
		}
	}, [selectedIndex])

	return (
		<div className="w-full">
			<div className="flex flex-col">
				<label htmlFor="hf-model-search">
					<span className="font-medium">Model</span>
				</label>

				<div ref={dropdownRef} className="relative w-full">
					<VSCodeTextField
						id="hf-model-search"
						placeholder="Search models..."
						value={searchTerm}
						onInput={(e: any) => {
							setSearchTerm(e.target.value)
							setIsDropdownVisible(true)
							setSelectedIndex(-1)
						}}
						onFocus={() => setIsDropdownVisible(true)}
						onKeyDown={handleKeyDown}
						className="w-full relative z-[1000]">
						{searchTerm && (
							<div
								className="input-icon-button codicon codicon-close"
								aria-label="Clear search"
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
						<div
							ref={dropdownListRef}
							className={`absolute top-[calc(100%-3px)] left-0 w-[calc(100%-2px)] ${
								isPopup ? "max-h-[90px]" : "max-h-[200px]"
							} overflow-y-auto bg-[var(--vscode-dropdown-background)] border border-[var(--vscode-list-activeSelectionBackground)] z-[999] rounded-b-[3px]`}>
							{modelSearchResults.map((result, index) => (
								<div
									key={result.id}
									ref={(el: HTMLDivElement | null) => (itemRefs.current[index] = el)}
									className={`p-[5px_10px] cursor-pointer break-all whitespace-normal ${
										index === selectedIndex ? "bg-[var(--vscode-list-activeSelectionBackground)]" : ""
									} hover:bg-[var(--vscode-list-activeSelectionBackground)]`}
									onMouseEnter={() => setSelectedIndex(index)}
									onClick={() => {
										handleModelChange(result.id)
										setIsDropdownVisible(false)
									}}>
									<div
										dangerouslySetInnerHTML={{ __html: result.html }}
										className="[&_.model-item-highlight]:bg-[var(--vscode-editor-findMatchHighlightBackground)] [&_.model-item-highlight]:text-inherit"
									/>
								</div>
							))}
						</div>
					)}
				</div>
			</div>

			<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} isPopup={isPopup} />
		</div>
	)
}

export { HuggingFaceModelPicker }
