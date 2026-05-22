import React, { useEffect, useMemo, useRef, useState } from "react"
import { cleanPathPrefix } from "@/components/common/CodeAccordian"
import { ContextMenuOptionType, ContextMenuQueryItem, getContextMenuOptions, SearchResult } from "@/utils/context-mentions"

interface ContextMenuProps {
	onSelect: (type: ContextMenuOptionType, value?: string) => void
	searchQuery: string
	onMouseDown: () => void
	selectedIndex: number
	setSelectedIndex: (index: number) => void
	selectedType: ContextMenuOptionType | null
	queryItems: ContextMenuQueryItem[]
	dynamicSearchResults?: SearchResult[]
	isLoading?: boolean
}

const ContextMenu: React.FC<ContextMenuProps> = ({
	onSelect,
	searchQuery,
	onMouseDown,
	selectedIndex,
	setSelectedIndex,
	selectedType,
	queryItems,
	dynamicSearchResults = [],
	isLoading = false,
}) => {
	const menuRef = useRef<HTMLDivElement>(null)

	// State to show delayed loading indicator
	const [showDelayedLoading, setShowDelayedLoading] = useState(false)
	const loadingTimeoutRef = useRef<NodeJS.Timeout | null>(null)

	const filteredOptions = useMemo(() => {
		const options = getContextMenuOptions(searchQuery, selectedType, queryItems, dynamicSearchResults)
		return options
	}, [searchQuery, selectedType, queryItems, dynamicSearchResults])

	// Effect to handle delayed loading indicator (show "Searching..." after 500ms of searching)
	useEffect(() => {
		if (loadingTimeoutRef.current) {
			clearTimeout(loadingTimeoutRef.current)
			loadingTimeoutRef.current = null
		}

		if (isLoading && searchQuery) {
			setShowDelayedLoading(false)
			loadingTimeoutRef.current = setTimeout(() => {
				if (isLoading) {
					setShowDelayedLoading(true)
				}
			}, 500) // 500ms delay before showing "Searching..."
		} else {
			setShowDelayedLoading(false)
		}

		// Cleanup timeout on unmount or when dependencies change
		return () => {
			if (loadingTimeoutRef.current) {
				clearTimeout(loadingTimeoutRef.current)
				loadingTimeoutRef.current = null
			}
		}
	}, [isLoading, searchQuery])

	useEffect(() => {
		if (menuRef.current) {
			const selectedElement = menuRef.current.children[selectedIndex] as HTMLElement
			if (selectedElement) {
				const menuRect = menuRef.current.getBoundingClientRect()
				const selectedRect = selectedElement.getBoundingClientRect()

				if (selectedRect.bottom > menuRect.bottom) {
					menuRef.current.scrollTop += selectedRect.bottom - menuRect.bottom
				} else if (selectedRect.top < menuRect.top) {
					menuRef.current.scrollTop -= menuRect.top - selectedRect.top
				}
			}
		}
	}, [selectedIndex])

	const renderOptionContent = (option: ContextMenuQueryItem) => {
		switch (option.type) {
			case ContextMenuOptionType.Problems:
				return <span>Problems</span>
			case ContextMenuOptionType.Terminal:
				return <span>Terminal</span>
			case ContextMenuOptionType.URL:
				return <span>Paste URL to fetch contents</span>
			case ContextMenuOptionType.NoResults:
				return <span>No results found</span>
			case ContextMenuOptionType.Git:
				if (option.value) {
					return (
						<div className="flex flex-col">
							<span className="ph-no-capture leading-snug">{option.label}</span>
							<span className="ph-no-capture context-menu-git-desc">{option.description}</span>
						</div>
					)
				} else {
					return <span>Git Commits</span>
				}
			case ContextMenuOptionType.File:
			case ContextMenuOptionType.Folder:
				if (option.value) {
					// Use label if it differs from just the basename (indicates workspace prefix or custom label)
					const displayText =
						option.label && option.label !== option.value.split("/").pop() ? option.label : option.value

					return (
						<>
							{!displayText.includes(":") && <span>/</span>}
							{displayText.startsWith("/.") && <span>.</span>}
							<span
								className="ph-no-capture context-menu-file-name"
								style={{
									direction: displayText.includes(":") ? "ltr" : "rtl",
								}}>
								{displayText.includes(":") ? displayText : cleanPathPrefix(displayText) + "\u200E"}
							</span>
						</>
					)
				} else {
					return <span>Add {option.type === ContextMenuOptionType.File ? "File" : "Folder"}</span>
				}
		}
	}

	const getIconForOption = (option: ContextMenuQueryItem): string => {
		switch (option.type) {
			case ContextMenuOptionType.File:
				return "file"
			case ContextMenuOptionType.Folder:
				return "folder"
			case ContextMenuOptionType.Problems:
				return "warning"
			case ContextMenuOptionType.Terminal:
				return "terminal"
			case ContextMenuOptionType.URL:
				return "link"
			case ContextMenuOptionType.Git:
				return "git-commit"
			case ContextMenuOptionType.NoResults:
				return "info"
			default:
				return "file"
		}
	}

	const isOptionSelectable = (option: ContextMenuQueryItem): boolean => {
		return option.type !== ContextMenuOptionType.NoResults && option.type !== ContextMenuOptionType.URL
	}

	return (
		<div className="context-menu-outer" onMouseDown={onMouseDown}>
			<div className="context-menu-inner" ref={menuRef}>
				{/* Can't use virtuoso since it requires fixed height and menu height is dynamic based on # of items */}
				{showDelayedLoading && searchQuery && (
					<div className="context-menu-loading">
						<i className="codicon codicon-loading codicon-modifier-spin text-sm" />
						<span>Searching...</span>
					</div>
				)}
				{filteredOptions.map((option, index) => {
					// Include workspace name in key for files/folders to handle duplicates across workspaces
					const workspacePrefix = option.workspaceName ? `${option.workspaceName}:` : ""
					const generatedKey = `${option.type}-${workspacePrefix}${option.value || index}`

					return (
						<div
							className={`context-menu-item ${index === selectedIndex && isOptionSelectable(option) ? "context-menu-item--selected" : ""}`}
							key={generatedKey}
							onClick={() => {
								if (isOptionSelectable(option)) {
									// Use label if it contains workspace prefix, otherwise use value
									const mentionValue = option.label?.includes(":") ? option.label : option.value
									onSelect(option.type, mentionValue)
								}
							}}
							onMouseEnter={() => isOptionSelectable(option) && setSelectedIndex(index)}
							style={{
								cursor: isOptionSelectable(option) ? "pointer" : "default",
							}}>
							<div className="context-menu-item-content">
								<i className={`codicon codicon-${getIconForOption(option)} context-menu-icon`} />
								{renderOptionContent(option)}
							</div>
							{(option.type === ContextMenuOptionType.File ||
								option.type === ContextMenuOptionType.Folder ||
								option.type === ContextMenuOptionType.Git) &&
								!option.value && <i className="codicon codicon-chevron-right context-menu-chevron" />}
							{(option.type === ContextMenuOptionType.Problems ||
								option.type === ContextMenuOptionType.Terminal ||
								((option.type === ContextMenuOptionType.File ||
									option.type === ContextMenuOptionType.Folder ||
									option.type === ContextMenuOptionType.Git) &&
									option.value)) && <i className="codicon codicon-add context-menu-chevron" />}
						</div>
					)
				})}
			</div>
		</div>
	)
}

export default ContextMenu
