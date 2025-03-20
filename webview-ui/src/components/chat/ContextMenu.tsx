import React, { useEffect, useMemo, useRef } from "react"
import {
	ContextMenuOptionType,
	ContextMenuQueryItem,
	getContextMenuOptions,
	SearchResult,
} from "../../utils/context-mentions"
import { removeLeadingNonAlphanumeric } from "../common/CodeAccordian"
import { ModeConfig } from "../../../../src/shared/modes"

interface ContextMenuProps {
	onSelect: (type: ContextMenuOptionType, value?: string) => void
	searchQuery: string
	onMouseDown: () => void
	selectedIndex: number
	setSelectedIndex: (index: number) => void
	selectedType: ContextMenuOptionType | null
	queryItems: ContextMenuQueryItem[]
	modes?: ModeConfig[]
	loading?: boolean // New loading prop
	dynamicSearchResults?: SearchResult[] // New dynamic search results prop
}

const ContextMenu: React.FC<ContextMenuProps> = ({
	onSelect,
	searchQuery,
	onMouseDown,
	selectedIndex,
	setSelectedIndex,
	selectedType,
	queryItems,
	modes,
	loading = false,
	dynamicSearchResults = [],
}) => {
	const menuRef = useRef<HTMLDivElement>(null)

	const filteredOptions = useMemo(() => {
		return getContextMenuOptions(searchQuery, selectedType, queryItems, dynamicSearchResults, modes)
	}, [searchQuery, selectedType, queryItems, dynamicSearchResults, modes])

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
			case ContextMenuOptionType.Mode:
				return (
					<div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
						<span style={{ lineHeight: "1.2" }}>{option.label}</span>
						{option.description && (
							<span
								style={{
									opacity: 0.5,
									fontSize: "0.9em",
									lineHeight: "1.2",
									whiteSpace: "nowrap",
									overflow: "hidden",
									textOverflow: "ellipsis",
								}}>
								{option.description}
							</span>
						)}
					</div>
				)
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
						<div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
							<span style={{ lineHeight: "1.2" }}>{option.label}</span>
							<span
								style={{
									fontSize: "0.85em",
									opacity: 0.7,
									whiteSpace: "nowrap",
									overflow: "hidden",
									textOverflow: "ellipsis",
									lineHeight: "1.2",
								}}>
								{option.description}
							</span>
						</div>
					)
				} else {
					return <span>Git Commits</span>
				}
			case ContextMenuOptionType.File:
			case ContextMenuOptionType.OpenedFile:
			case ContextMenuOptionType.Folder:
				if (option.value) {
					return (
						<>
							<span>/</span>
							{option.value?.startsWith("/.") && <span>.</span>}
							<span
								style={{
									whiteSpace: "nowrap",
									overflow: "hidden",
									textOverflow: "ellipsis",
									direction: "rtl",
									textAlign: "left",
								}}>
								{removeLeadingNonAlphanumeric(option.value || "") + "\u200E"}
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
			case ContextMenuOptionType.Mode:
				return "symbol-misc"
			case ContextMenuOptionType.OpenedFile:
				return "window"
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
		<div
			style={{
				position: "absolute",
				bottom: "calc(100% - 10px)",
				left: 15,
				right: 15,
				overflowX: "hidden",
			}}
			onMouseDown={onMouseDown}>
			<div
				ref={menuRef}
				style={{
					backgroundColor: "var(--vscode-dropdown-background)",
					border: "1px solid var(--vscode-editorGroup-border)",
					borderRadius: "3px",
					boxShadow: "0 4px 10px rgba(0, 0, 0, 0.25)",
					zIndex: 1000,
					display: "flex",
					flexDirection: "column",
					maxHeight: "200px",
					overflowY: "auto",
				}}>
				{filteredOptions && filteredOptions.length > 0 ? (
					filteredOptions.map((option, index) => (
						<div
							key={`${option.type}-${option.value || index}`}
							onClick={() => isOptionSelectable(option) && onSelect(option.type, option.value)}
							style={{
								padding: "8px 12px",
								cursor: isOptionSelectable(option) ? "pointer" : "default",
								color: "var(--vscode-dropdown-foreground)",
								borderBottom: "1px solid var(--vscode-editorGroup-border)",
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								...(index === selectedIndex && isOptionSelectable(option)
									? {
											backgroundColor: "var(--vscode-list-activeSelectionBackground)",
											color: "var(--vscode-list-activeSelectionForeground)",
										}
									: {}),
							}}
							onMouseEnter={() => isOptionSelectable(option) && setSelectedIndex(index)}>
							<div
								style={{
									display: "flex",
									alignItems: "center",
									flex: 1,
									minWidth: 0,
									overflow: "hidden",
									paddingTop: 0,
								}}>
								{option.type !== ContextMenuOptionType.Mode && getIconForOption(option) && (
									<i
										className={`codicon codicon-${getIconForOption(option)}`}
										style={{
											marginRight: "6px",
											flexShrink: 0,
											fontSize: "14px",
											marginTop: 0,
										}}
									/>
								)}
								{renderOptionContent(option)}
							</div>
							{(option.type === ContextMenuOptionType.File ||
								option.type === ContextMenuOptionType.Folder ||
								option.type === ContextMenuOptionType.Git) &&
								!option.value && (
									<i
										className="codicon codicon-chevron-right"
										style={{ fontSize: "14px", flexShrink: 0, marginLeft: 8 }}
									/>
								)}
							{(option.type === ContextMenuOptionType.Problems ||
								option.type === ContextMenuOptionType.Terminal ||
								((option.type === ContextMenuOptionType.File ||
									option.type === ContextMenuOptionType.Folder ||
									option.type === ContextMenuOptionType.OpenedFile ||
									option.type === ContextMenuOptionType.Git) &&
									option.value)) && (
								<i
									className="codicon codicon-add"
									style={{ fontSize: "14px", flexShrink: 0, marginLeft: 8 }}
								/>
							)}
						</div>
					))
				) : (
					<div
						style={{
							padding: "12px",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							color: "var(--vscode-foreground)",
							opacity: 0.7,
						}}>
						<span>No results found</span>
					</div>
				)}
			</div>
		</div>
	)
}

export default ContextMenu
