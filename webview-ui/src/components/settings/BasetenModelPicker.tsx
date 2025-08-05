import { EmptyRequest } from "@shared/proto/cline/common"
import { VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import Fuse from "fuse.js"
import React, { KeyboardEvent, memo, useEffect, useMemo, useRef, useState } from "react"
import { useRemark } from "react-remark"
import { useMount } from "react-use"
import { basetenDefaultModelId, basetenModels } from "@shared/api"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { ModelsServiceClient } from "../../services/grpc-client"
import { CODE_BLOCK_BG_COLOR } from "../common/CodeBlock"
import { highlight } from "../history/HistoryView"
import { ModelInfoView } from "./common/ModelInfoView"
import { normalizeApiConfiguration } from "./utils/providerUtils"
import { useApiConfigurationHandlers } from "./utils/useApiConfigurationHandlers"
import { getModeSpecificFields } from "./utils/providerUtils"
import { Mode } from "@shared/storage/types"

export interface BasetenModelPickerProps {
	isPopup?: boolean
	currentMode: Mode
}

const BasetenModelPicker: React.FC<BasetenModelPickerProps> = ({ isPopup, currentMode }) => {
	const { apiConfiguration, basetenModels: dynamicBasetenModels, setBasetenModels } = useExtensionState()
	const { handleModeFieldsChange } = useApiConfigurationHandlers()
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	const [searchTerm, setSearchTerm] = useState(modeFields.basetenModelId || basetenDefaultModelId)
	const [debouncedSearchTerm, setDebouncedSearchTerm] = useState(searchTerm)
	const [isDropdownVisible, setIsDropdownVisible] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(-1)
	const dropdownRef = useRef<HTMLDivElement>(null)
	const itemRefs = useRef<(HTMLDivElement | null)[]>([])
	const dropdownListRef = useRef<HTMLDivElement>(null)

	const handleModelChange = (newModelId: string) => {
		// Only allow selection of models that are in the static basetenModels
		if (!(newModelId in basetenModels)) {
			console.warn(`Model ${newModelId} is not in the static basetenModels list`)
			return
		}

		// Use dynamic models if available, otherwise fall back to static models
		const modelInfo = dynamicBasetenModels?.[newModelId] || basetenModels[newModelId as keyof typeof basetenModels]

		handleModeFieldsChange(
			{
				basetenModelId: { plan: "planModeBasetenModelId", act: "actModeBasetenModelId" },
				basetenModelInfo: { plan: "planModeBasetenModelInfo", act: "actModeBasetenModelInfo" },
			},
			{
				basetenModelId: newModelId,
				basetenModelInfo: modelInfo,
			},
			currentMode,
		)
		setSearchTerm(newModelId)
	}

	const { selectedModelId, selectedModelInfo } = useMemo(() => {
		return normalizeApiConfiguration(apiConfiguration, currentMode)
	}, [apiConfiguration, currentMode])

	useMount(() => {
		ModelsServiceClient.refreshBasetenModels(EmptyRequest.create({}))
			.then((response) => {
				// Filter to only include models that are listed in the static basetenModels
				const filteredModels: Record<string, any> = {}

				// Always include the default model
				filteredModels[basetenDefaultModelId] = basetenModels[basetenDefaultModelId]

				// Only include models from the API response that exist in static basetenModels
				for (const [modelId, modelInfo] of Object.entries(response.models)) {
					if (modelId in basetenModels) {
						filteredModels[modelId] = modelInfo
					}
				}

				setBasetenModels(filteredModels)
			})
			.catch((err) => {
				console.error("Failed to refresh Baseten models:", err)
				// On error, fall back to only static models
				setBasetenModels({
					[basetenDefaultModelId]: basetenModels[basetenDefaultModelId],
				})
			})
	})

	// Sync external changes when the modelId changes
	useEffect(() => {
		const currentModelId = modeFields.basetenModelId || basetenDefaultModelId
		setSearchTerm(currentModelId)
	}, [modeFields.basetenModelId])

	// Debounce search term to reduce re-renders
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedSearchTerm(searchTerm)
		}, 300)

		return () => clearTimeout(timer)
	}, [searchTerm])

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

	const allBasetenModels = useMemo(() => {
		// Only include models that are listed in the static basetenModels
		const filteredModels: Record<string, any> = {}

		// Start with static models
		for (const [modelId, modelInfo] of Object.entries(basetenModels)) {
			filteredModels[modelId] = modelInfo
		}

		// Override with dynamic models, but only if they exist in static basetenModels
		if (dynamicBasetenModels) {
			for (const [modelId, modelInfo] of Object.entries(dynamicBasetenModels)) {
				if (modelId in basetenModels) {
					filteredModels[modelId] = modelInfo
				}
			}
		}

		return filteredModels
	}, [dynamicBasetenModels])

	const modelIds = useMemo(() => {
		return Object.keys(allBasetenModels).sort((a, b) => a.localeCompare(b))
	}, [allBasetenModels])

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
		let results: { id: string; html: string }[] = debouncedSearchTerm
			? highlight(fuse.search(debouncedSearchTerm), "model-item-highlight")
			: searchableItems
		return results
	}, [searchableItems, debouncedSearchTerm, fuse])

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

	const hasInfo = useMemo(() => {
		return selectedModelInfo && selectedModelInfo.description
	}, [selectedModelInfo])

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
		<div className="w-full">
			<style>
				{`
				.model-item-highlight {
					background-color: var(--vscode-editor-findMatchHighlightBackground);
					color: inherit;
				}
				`}
			</style>
			<div className="flex flex-col">
				<label htmlFor="model-search">
					<span className="font-medium">Model</span>
				</label>
				<div ref={dropdownRef} className="relative w-full">
					<VSCodeTextField
						id="model-search"
						placeholder="Search and select a model..."
						value={searchTerm}
						onInput={(e) => {
							setSearchTerm((e.target as HTMLInputElement)?.value || "")
							setIsDropdownVisible(true)
						}}
						onFocus={() => setIsDropdownVisible(true)}
						onKeyDown={handleKeyDown}
						style={{
							width: "100%",
							zIndex: BASETEN_MODEL_PICKER_Z_INDEX,
							position: "relative",
						}}>
						{searchTerm && (
							<div
								className="input-icon-button codicon codicon-close flex justify-center items-center h-full"
								aria-label="Clear search"
								onClick={() => {
									setSearchTerm("")
									setIsDropdownVisible(true)
								}}
								slot="end"
							/>
						)}
					</VSCodeTextField>
					{isDropdownVisible && (
						<div
							ref={dropdownListRef}
							className="absolute top-[calc(100%-3px)] left-0 w-[calc(100%-2px)] max-h-[200px] overflow-y-auto border border-[var(--vscode-list-activeSelectionBackground)] rounded-b-[3px]"
							style={{
								backgroundColor: "var(--vscode-dropdown-background)",
								zIndex: BASETEN_MODEL_PICKER_Z_INDEX - 1,
							}}>
							{modelSearchResults.map((item, index) => (
								<div
									key={item.id}
									ref={(el: HTMLDivElement | null) => (itemRefs.current[index] = el)}
									className={`px-2.5 py-1.5 cursor-pointer break-all whitespace-normal hover:bg-[var(--vscode-list-activeSelectionBackground)] ${
										index === selectedIndex ? "bg-[var(--vscode-list-activeSelectionBackground)]" : ""
									}`}
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
						</div>
					)}
				</div>
			</div>

			{hasInfo ? (
				<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} isPopup={isPopup} />
			) : (
				<p className="text-xs mt-0 text-[var(--vscode-descriptionForeground)]">
					<>
						The extension automatically fetches the latest list of models available on{" "}
						<VSCodeLink className="inline text-inherit" href="https://www.baseten.co/products/model-apis/">
							Baseten.
						</VSCodeLink>
						If you're unsure which model to choose, Cline works best with{" "}
						<VSCodeLink
							className="inline text-inherit"
							onClick={() => handleModelChange("moonshotai/Kimi-K2-Instruct")}>
							moonshotai/Kimi-K2-Instruct.
						</VSCodeLink>
					</>
				</p>
			)}
		</div>
	)
}

export const BASETEN_MODEL_PICKER_Z_INDEX = 1_000

export default BasetenModelPicker
