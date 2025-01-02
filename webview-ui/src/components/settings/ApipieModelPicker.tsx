import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import React, { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import { useMount } from "react-use"
import styled from "styled-components"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { vscode } from "../../utils/vscode"
import { ModelInfoView } from "./ApiOptions"

const defaultProvider = "openai"
const defaultModel = "gpt-4o"

const ApipieModelPicker: React.FC = () => {
	const { apiConfiguration, setApiConfiguration, apipieModels } = useExtensionState()
	const [selectedModel, setSelectedModel] = useState(
		apiConfiguration?.apiModelId || `${defaultProvider}/${defaultModel}`,
	)
	const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false)

	useMount(() => {
		vscode.postMessage({ type: "refreshApipieModels" })
	})

	useEffect(() => {
		console.log("Fetched apipieModels:", apipieModels)
	}, [apipieModels])

	const [isDropdownVisible, setIsDropdownVisible] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(-1)
	const dropdownRef = useRef<HTMLDivElement>(null)
	const itemRefs = useRef<(HTMLDivElement | null)[]>([])
	const dropdownListRef = useRef<HTMLDivElement>(null)

	const handleModelChange = (newModelId: string) => {
		setApiConfiguration({
			...apiConfiguration,
			apiModelId: newModelId,
			apiProvider: "apipie",
		})
		setSelectedModel(newModelId)
	}

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

	const filteredModelIds = useMemo(() => {
		return Object.keys(apipieModels || {})
			.filter((model) => model.toLowerCase().includes(selectedModel.toLowerCase()))
			.sort((a, b) => a.localeCompare(b))
	}, [apipieModels, selectedModel])

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (!isDropdownVisible || filteredModelIds.length === 0) return

		switch (event.key) {
			case "ArrowDown":
				event.preventDefault()
				setSelectedIndex((prev) => (prev < filteredModelIds.length - 1 ? prev + 1 : prev))
				break
			case "ArrowUp":
				event.preventDefault()
				setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev))
				break
			case "Enter":
				event.preventDefault()
				if (selectedIndex >= 0 && selectedIndex < filteredModelIds.length) {
					handleModelChange(filteredModelIds[selectedIndex])
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
	}, [selectedModel])

	useEffect(() => {
		if (selectedIndex >= 0 && itemRefs.current[selectedIndex]) {
			itemRefs.current[selectedIndex]?.scrollIntoView({
				block: "nearest",
				behavior: "smooth",
			})
		}
	}, [selectedIndex])

	const normalizeApipieModelInfo = (modelData: any) => {
		return {
			maxTokens: modelData.max_tokens,
			contextWindow: modelData.max_response_tokens,
			supportsImages: false,
			supportsComputerUse: false,
			supportsPromptCache: false,
			inputPrice: modelData.input_cost,
			outputPrice: modelData.output_cost,
			description: modelData.description,
		}
	}

	const selectedModelInfo = useMemo(() => {
		if (!apipieModels) return null
		const modelData = apipieModels[selectedModel]
		if (!modelData) return null
		return normalizeApipieModelInfo(modelData)
	}, [apipieModels, selectedModel])

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
				<label htmlFor="model-search">
					<span style={{ fontWeight: 500 }}>Model</span>
				</label>
				<DropdownWrapper ref={dropdownRef}>
					<VSCodeTextField
						id="model-search"
						placeholder="Search and select a model..."
						value={selectedModel}
						onInput={(e) => {
							handleModelChange((e.target as HTMLInputElement)?.value?.toLowerCase())
							setIsDropdownVisible(true)
						}}
						onFocus={() => setIsDropdownVisible(true)}
						onKeyDown={handleKeyDown}
						style={{ width: "100%", zIndex: APIPIE_MODEL_PICKER_Z_INDEX, position: "relative" }}>
						{selectedModel && (
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
						<DropdownList ref={dropdownListRef}>
							{filteredModelIds.map((model, index) => (
								<DropdownItem
									key={model}
									ref={(el) => (itemRefs.current[index] = el)}
									isSelected={index === selectedIndex}
									onMouseEnter={() => setSelectedIndex(index)}
									onClick={() => {
										handleModelChange(model)
										setIsDropdownVisible(false)
									}}
									dangerouslySetInnerHTML={{
										__html: model,
									}}
								/>
							))}
						</DropdownList>
					)}
				</DropdownWrapper>
			</div>

			{selectedModelInfo ? (
				<ModelInfoView
					selectedModelId={selectedModel}
					modelInfo={selectedModelInfo}
					isDescriptionExpanded={isDescriptionExpanded}
					setIsDescriptionExpanded={setIsDescriptionExpanded}
				/>
			) : (
				<p style={{ fontSize: "12px", marginTop: 0, color: "var(--vscode-descriptionForeground)" }}>
					Select a model from the dropdown above.
				</p>
			)}
		</>
	)
}

export default ApipieModelPicker

// Dropdown

const DropdownWrapper = styled.div`
	position: relative;
	width: 100%;
`

export const APIPIE_MODEL_PICKER_Z_INDEX = 1_000

const DropdownList = styled.div`
	position: absolute;
	top: calc(100% - 3px);
	left: 0;
	width: calc(100% - 2px);
	max-height: 200px;
	overflow-y: auto;
	background-color: var(--vscode-dropdown-background);
	border: 1px solid var(--vscode-list-activeSelectionBackground);
	z-index: ${APIPIE_MODEL_PICKER_Z_INDEX - 1};
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
