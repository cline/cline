import type { ModelInfo } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import { VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import Fuse from "fuse.js"
import type React from "react"
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import { useMount } from "react-use"
import styled from "styled-components"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { highlight } from "../history/HistoryView"
import { ModelInfoView } from "./common/ModelInfoView"
import ThinkingBudgetSlider from "./ThinkingBudgetSlider"
import { getModeSpecificFields } from "./utils/providerUtils"
import { useApiConfigurationHandlers } from "./utils/useApiConfigurationHandlers"

export interface VercelModelPickerProps {
	isPopup?: boolean
	currentMode: Mode
}

const VercelModelPicker: React.FC<VercelModelPickerProps> = ({ isPopup, currentMode }) => {
	const { handleModeFieldsChange } = useApiConfigurationHandlers()
	const { apiConfiguration, vercelAiGatewayModels, refreshVercelAiGatewayModels } = useExtensionState()
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	// Vercel AI Gateway uses its own model fields
	const [searchTerm, setSearchTerm] = useState(modeFields.vercelAiGatewayModelId || "")
	const [isDropdownVisible, setIsDropdownVisible] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(-1)
	const dropdownRef = useRef<HTMLDivElement>(null)
	const itemRefs = useRef<(HTMLDivElement | null)[]>([])
	const dropdownListRef = useRef<HTMLDivElement>(null)

	const handleModelChange = (newModelId: string) => {
		setSearchTerm(newModelId)

		// Vercel AI Gateway uses its own model fields
		handleModeFieldsChange(
			{
				vercelAiGatewayModelId: { plan: "planModeVercelAiGatewayModelId", act: "actModeVercelAiGatewayModelId" },
				vercelAiGatewayModelInfo: { plan: "planModeVercelAiGatewayModelInfo", act: "actModeVercelAiGatewayModelInfo" },
			},
			{
				vercelAiGatewayModelId: newModelId,
				vercelAiGatewayModelInfo: vercelAiGatewayModels[newModelId],
			},
			currentMode,
		)
	}

	const { selectedModelId, selectedModelInfo } = useMemo(() => {
		return {
			selectedModelId: modeFields.vercelAiGatewayModelId || "",
			selectedModelInfo: modeFields.vercelAiGatewayModelInfo as ModelInfo | undefined,
		}
	}, [modeFields.vercelAiGatewayModelId, modeFields.vercelAiGatewayModelInfo])

	useMount(refreshVercelAiGatewayModels)

	// Sync external changes when the modelId changes
	useEffect(() => {
		const currentModelId = modeFields.vercelAiGatewayModelId || ""
		setSearchTerm(currentModelId)
	}, [modeFields.vercelAiGatewayModelId])

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
		return Object.keys(vercelAiGatewayModels).sort((a, b) => a.localeCompare(b))
	}, [vercelAiGatewayModels])

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
		const searchResults = searchTerm ? highlight(fuse.search(searchTerm), "model-item-highlight") : searchableItems

		return searchResults
	}, [searchableItems, searchTerm, fuse])

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

	const showBudgetSlider = useMemo(() => {
		return (
			selectedModelId?.toLowerCase().includes("claude-haiku-4.5") ||
			selectedModelId?.toLowerCase().includes("claude-4.5-haiku") ||
			selectedModelId?.toLowerCase().includes("claude-sonnet-4.5") ||
			selectedModelId?.toLowerCase().includes("claude-sonnet-4") ||
			selectedModelId?.toLowerCase().includes("claude-opus-4.1") ||
			selectedModelId?.toLowerCase().includes("claude-opus-4") ||
			selectedModelId?.toLowerCase().includes("claude-opus-4.5") ||
			selectedModelId?.toLowerCase().includes("claude-3-7-sonnet") ||
			selectedModelId?.toLowerCase().includes("claude-3.7-sonnet")
		)
	}, [selectedModelId])

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
				<label htmlFor="vercel-model-search">
					<span style={{ fontWeight: 500 }}>Model</span>
				</label>

				<DropdownWrapper ref={dropdownRef}>
					<VSCodeTextField
						id="vercel-model-search"
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
							zIndex: VERCEL_MODEL_PICKER_Z_INDEX,
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
							{modelSearchResults.length > 0 ? (
								modelSearchResults.map((item, index) => (
									<DropdownItem
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
								))
							) : (
								<DropdownItem isSelected={false}>
									<span style={{ color: "var(--vscode-descriptionForeground)" }}>
										{Object.keys(vercelAiGatewayModels).length === 0
											? "Loading models..."
											: "No models found"}
									</span>
								</DropdownItem>
							)}
						</DropdownList>
					)}
				</DropdownWrapper>
			</div>

			{hasInfo && selectedModelInfo ? (
				<>
					{showBudgetSlider && <ThinkingBudgetSlider currentMode={currentMode} />}

					<ModelInfoView
						isPopup={isPopup}
						modelInfo={selectedModelInfo}
						selectedModelId={selectedModelId}
						showProviderRouting={false}
					/>
				</>
			) : (
				<p
					style={{
						fontSize: "12px",
						marginTop: 0,
						color: "var(--vscode-descriptionForeground)",
					}}>
					{Object.keys(vercelAiGatewayModels).length === 0 ? (
						<>
							Enter your Vercel AI Gateway API key above to load available models. You can get an API key from{" "}
							<VSCodeLink
								href="https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai"
								style={{ display: "inline", fontSize: "inherit" }}>
								Vercel AI Gateway.
							</VSCodeLink>
						</>
					) : (
						<>
							Select a model from the dropdown above. The extension fetches available models from your Vercel AI
							Gateway configuration.
						</>
					)}
				</p>
			)}
		</div>
	)
}

export default VercelModelPicker

// Dropdown styles

const DropdownWrapper = styled.div`
	position: relative;
	width: 100%;
`

export const VERCEL_MODEL_PICKER_Z_INDEX = 1_000

const DropdownList = styled.div`
	position: absolute;
	top: calc(100% - 3px);
	left: 0;
	width: calc(100% - 2px);
	max-height: 200px;
	overflow-y: auto;
	background-color: var(--vscode-dropdown-background);
	border: 1px solid var(--vscode-list-activeSelectionBackground);
	z-index: ${VERCEL_MODEL_PICKER_Z_INDEX - 1};
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
