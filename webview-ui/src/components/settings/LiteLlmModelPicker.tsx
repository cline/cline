import { liteLlmDefaultModelId, liteLlmModelInfoSaneDefaults } from "@shared/api"
import { EmptyRequest } from "@shared/proto/cline/common"
import { fromProtobufModels } from "@shared/proto-conversions/models/typeConversion"
import { Mode } from "@shared/storage/types"
import { VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import Fuse from "fuse.js"
import React, { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import { useMount } from "react-use"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { ModelsServiceClient } from "../../services/grpc-client"
import { highlight } from "../history/HistoryView"
import { ModelInfoView } from "./common/ModelInfoView"
import { getModeSpecificFields, normalizeApiConfiguration } from "./utils/providerUtils"
import { useApiConfigurationHandlers } from "./utils/useApiConfigurationHandlers"

export interface LiteLlmModelPickerProps {
	isPopup?: boolean
	currentMode: Mode
}

const LiteLlmModelPicker: React.FC<LiteLlmModelPickerProps> = ({ isPopup, currentMode }) => {
	const { apiConfiguration, liteLlmModels: dynamicLiteLlmModels, setLiteLlmModels } = useExtensionState()
	const { handleModeFieldsChange } = useApiConfigurationHandlers()
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	const [searchTerm, setSearchTerm] = useState(modeFields.liteLlmModelId || liteLlmDefaultModelId)
	const [debouncedSearchTerm, setDebouncedSearchTerm] = useState(searchTerm)
	const [isDropdownVisible, setIsDropdownVisible] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(-1)
	const dropdownRef = useRef<HTMLDivElement>(null)
	const itemRefs = useRef<(HTMLDivElement | null)[]>([])
	const dropdownListRef = useRef<HTMLDivElement>(null)

	const handleModelChange = (newModelId: string) => {
		const modelInfo = dynamicLiteLlmModels?.[newModelId] || liteLlmModelInfoSaneDefaults

		handleModeFieldsChange(
			{
				liteLlmModelId: { plan: "planModeLiteLlmModelId", act: "actModeLiteLlmModelId" },
				liteLlmModelInfo: { plan: "planModeLiteLlmModelInfo", act: "actModeLiteLlmModelInfo" },
			},
			{
				liteLlmModelId: newModelId,
				liteLlmModelInfo: modelInfo,
			},
			currentMode,
		)
		setSearchTerm(newModelId)
	}

	const { selectedModelId, selectedModelInfo } = useMemo(() => {
		return normalizeApiConfiguration(apiConfiguration, currentMode)
	}, [apiConfiguration, currentMode])

	useMount(() => {
		ModelsServiceClient.refreshLiteLlmModelsRpc(EmptyRequest.create({}))
			.then((response) => {
				setLiteLlmModels(fromProtobufModels(response.models))
			})
			.catch((err) => {
				console.error("Failed to refresh LiteLLM models:", err)
			})
	})

	// Sync external changes when the modelId changes
	useEffect(() => {
		const currentModelId = modeFields.liteLlmModelId || liteLlmDefaultModelId
		setSearchTerm(currentModelId)
	}, [modeFields.liteLlmModelId])

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

	const allLiteLlmModels = dynamicLiteLlmModels || {}

	const modelIds = useMemo(() => {
		return Object.keys(allLiteLlmModels).sort((a, b) => a.localeCompare(b))
	}, [allLiteLlmModels])

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
		const results: { id: string; html: string }[] = debouncedSearchTerm
			? highlight(fuse.search(debouncedSearchTerm), "model-item-highlight")
			: searchableItems
		return results
	}, [searchableItems, debouncedSearchTerm, fuse])

	const parseHighlightedText = React.useCallback((htmlString: string) => {
		const parts = htmlString.split(/(<span class="model-item-highlight">.*?<\/span>)/g)

		return parts
			.map((part) => {
				if (part.startsWith('<span class="model-item-highlight">')) {
					const text = part.replace(/<span class="model-item-highlight">(.*?)<\/span>/, "$1")
					return (
						<span className="model-item-highlight" key={`highlight-${text}`}>
							{text}
						</span>
					)
				}
				return part || null
			})
			.filter((part) => part !== null && part !== "")
	}, [])

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

	// If no models are available, show fallback message
	if (!dynamicLiteLlmModels || Object.keys(dynamicLiteLlmModels).length === 0) {
		return (
			<p className="text-xs mt-0 text-(--vscode-descriptionForeground)">
				No models available. Ensure your LiteLLM server is running and the Base URL and API Key are correctly configured.
			</p>
		)
	}

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
				<label htmlFor="litellm-model-search">
					<span className="font-medium">Model</span>
				</label>
				<div className="relative w-full" ref={dropdownRef}>
					<VSCodeTextField
						id="litellm-model-search"
						onFocus={() => setIsDropdownVisible(true)}
						onInput={(e) => {
							setSearchTerm((e.target as HTMLInputElement)?.value || "")
							setIsDropdownVisible(true)
						}}
						onKeyDown={handleKeyDown}
						placeholder="Search and select a model..."
						style={{
							width: "100%",
							zIndex: LITELLM_MODEL_PICKER_Z_INDEX,
							position: "relative",
						}}
						value={searchTerm}>
						{searchTerm && (
							<div
								aria-label="Clear search"
								className="input-icon-button codicon codicon-close flex justify-center items-center h-full"
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
							className="absolute top-[calc(100%-3px)] left-0 w-[calc(100%-2px)] max-h-[200px] overflow-y-auto border border-(--vscode-list-activeSelectionBackground) rounded-b-[3px]"
							ref={dropdownListRef}
							style={{
								backgroundColor: "var(--vscode-dropdown-background)",
								zIndex: LITELLM_MODEL_PICKER_Z_INDEX - 1,
							}}>
							{modelSearchResults.map((item, index) => (
								<div
									className={`px-2.5 py-1.5 cursor-pointer break-all whitespace-normal hover:bg-(--vscode-list-activeSelectionBackground) ${
										index === selectedIndex ? "bg-(--vscode-list-activeSelectionBackground)" : ""
									}`}
									key={item.id}
									onClick={() => {
										handleModelChange(item.id)
										setIsDropdownVisible(false)
									}}
									onMouseEnter={() => setSelectedIndex(index)}
									ref={(el: HTMLDivElement | null) => {
										itemRefs.current[index] = el
									}}>
									{parseHighlightedText(item.html)}
								</div>
							))}
						</div>
					)}
				</div>
			</div>

			{hasInfo ? (
				<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
			) : (
				<p className="text-xs mt-0 text-(--vscode-descriptionForeground)">
					The extension fetches the model list from your configured LiteLLM server.{" "}
					<VSCodeLink className="inline text-inherit" href="https://docs.litellm.ai/docs/">
						Learn more about LiteLLM
					</VSCodeLink>
				</p>
			)}
		</div>
	)
}

export const LITELLM_MODEL_PICKER_Z_INDEX = 1_000

export default LiteLlmModelPicker
