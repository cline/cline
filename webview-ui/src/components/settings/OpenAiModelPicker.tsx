import { VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { Fzf } from "fzf"
import React, { KeyboardEvent, memo, useEffect, useMemo, useRef, useState } from "react"
import debounce from "debounce"
import { useRemark } from "react-remark"
import styled from "styled-components"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { vscode } from "../../utils/vscode"
import { highlightFzfMatch } from "../../utils/highlight"

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
							handleModelChange((e.target as HTMLInputElement)?.value?.toLowerCase())
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
						<DropdownList ref={dropdownListRef}>
							{modelSearchResults.map((item, index) => (
								<DropdownItem
									key={item.id}
									ref={(el) => (itemRefs.current[index] = el)}
									isSelected={index === selectedIndex}
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

const DropdownWrapper = styled.div`
	position: relative;
	width: 100%;
`

export const OPENAI_MODEL_PICKER_Z_INDEX = 1_000

const DropdownList = styled.div`
	position: absolute;
	top: calc(100% - 3px);
	left: 0;
	width: calc(100% - 2px);
	max-height: 200px;
	overflow-y: auto;
	background-color: var(--vscode-dropdown-background);
	border: 1px solid var(--vscode-list-activeSelectionBackground);
	z-index: ${OPENAI_MODEL_PICKER_Z_INDEX - 1};
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

// Markdown

const StyledMarkdown = styled.div`
	font-family:
		var(--vscode-font-family),
		system-ui,
		-apple-system,
		BlinkMacSystemFont,
		"Segoe UI",
		Roboto,
		Oxygen,
		Ubuntu,
		Cantarell,
		"Open Sans",
		"Helvetica Neue",
		sans-serif;
	font-size: 12px;
	color: var(--vscode-descriptionForeground);

	p,
	li,
	ol,
	ul {
		line-height: 1.25;
		margin: 0;
	}

	ol,
	ul {
		padding-left: 1.5em;
		margin-left: 0;
	}

	p {
		white-space: pre-wrap;
	}

	a {
		text-decoration: none;
	}
	a {
		&:hover {
			text-decoration: underline;
		}
	}
`

export const ModelDescriptionMarkdown = memo(
	({
		markdown,
		key,
		isExpanded,
		setIsExpanded,
	}: {
		markdown?: string
		key: string
		isExpanded: boolean
		setIsExpanded: (isExpanded: boolean) => void
	}) => {
		const [reactContent, setMarkdown] = useRemark()
		// const [isExpanded, setIsExpanded] = useState(false)
		const [showSeeMore, setShowSeeMore] = useState(false)
		const textContainerRef = useRef<HTMLDivElement>(null)
		const textRef = useRef<HTMLDivElement>(null)

		useEffect(() => {
			setMarkdown(markdown || "")
		}, [markdown, setMarkdown])

		useEffect(() => {
			if (textRef.current && textContainerRef.current) {
				const { scrollHeight } = textRef.current
				const { clientHeight } = textContainerRef.current
				const isOverflowing = scrollHeight > clientHeight
				setShowSeeMore(isOverflowing)
				// if (!isOverflowing) {
				// 	setIsExpanded(false)
				// }
			}
		}, [reactContent, setIsExpanded])

		return (
			<StyledMarkdown key={key} style={{ display: "inline-block", marginBottom: 0 }}>
				<div
					ref={textContainerRef}
					style={{
						overflowY: isExpanded ? "auto" : "hidden",
						position: "relative",
						wordBreak: "break-word",
						overflowWrap: "anywhere",
					}}>
					<div
						ref={textRef}
						style={{
							display: "-webkit-box",
							WebkitLineClamp: isExpanded ? "unset" : 3,
							WebkitBoxOrient: "vertical",
							overflow: "hidden",
							// whiteSpace: "pre-wrap",
							// wordBreak: "break-word",
							// overflowWrap: "anywhere",
						}}>
						{reactContent}
					</div>
					{!isExpanded && showSeeMore && (
						<div
							style={{
								position: "absolute",
								right: 0,
								bottom: 0,
								display: "flex",
								alignItems: "center",
							}}>
							<div
								style={{
									width: 30,
									height: "1.2em",
									background:
										"linear-gradient(to right, transparent, var(--vscode-sideBar-background))",
								}}
							/>
							<VSCodeLink
								style={{
									// cursor: "pointer",
									// color: "var(--vscode-textLink-foreground)",
									fontSize: "inherit",
									paddingRight: 0,
									paddingLeft: 3,
									backgroundColor: "var(--vscode-sideBar-background)",
								}}
								onClick={() => setIsExpanded(true)}>
								See more
							</VSCodeLink>
						</div>
					)}
				</div>
			</StyledMarkdown>
		)
	},
)
