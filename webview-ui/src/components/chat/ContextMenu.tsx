import React, { useEffect, useMemo, useRef } from "react"
import { ContextMenuOptionType, ContextMenuQueryItem, getContextMenuOptions } from "../../utils/context-mentions"
import { removeLeadingNonAlphanumeric } from "../common/CodeAccordian"

interface ContextMenuProps {
	onSelect: (type: ContextMenuOptionType, value?: string) => void
	searchQuery: string
	onMouseDown: () => void
	selectedIndex: number
	setSelectedIndex: (index: number) => void
	selectedType: ContextMenuOptionType | null
	queryItems: ContextMenuQueryItem[]
}

const ContextMenu: React.FC<ContextMenuProps> = ({
	onSelect,
	searchQuery,
	onMouseDown,
	selectedIndex,
	setSelectedIndex,
	selectedType,
	queryItems,
}) => {
	const menuRef = useRef<HTMLDivElement>(null)

	const filteredOptions = useMemo(
		() => getContextMenuOptions(searchQuery, selectedType, queryItems),
		[searchQuery, selectedType, queryItems]
	)

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
			case ContextMenuOptionType.URL:
				return <span>Paste URL to fetch contents</span>
			case ContextMenuOptionType.NoResults:
				return <span>No results found</span>
			case ContextMenuOptionType.File:
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
			case ContextMenuOptionType.File:
				return "file"
			case ContextMenuOptionType.Folder:
				return "folder"
			case ContextMenuOptionType.Problems:
				return "warning"
			case ContextMenuOptionType.URL:
				return "link"
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
				{/* Can't use virtuoso since it requires fixed height and menu height is dynamic based on # of items */}
				{filteredOptions.map((option, index) => (
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
							backgroundColor:
								index === selectedIndex && isOptionSelectable(option)
									? "var(--vscode-list-activeSelectionBackground)"
									: "",
						}}
						onMouseEnter={() => isOptionSelectable(option) && setSelectedIndex(index)}>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								flex: 1,
								minWidth: 0,
								overflow: "hidden",
							}}>
							<i
								className={`codicon codicon-${getIconForOption(option)}`}
								style={{ marginRight: "8px", flexShrink: 0, fontSize: "14px" }}
							/>
							{renderOptionContent(option)}
						</div>
						{(option.type === ContextMenuOptionType.File || option.type === ContextMenuOptionType.Folder) &&
							!option.value && (
								<i
									className="codicon codicon-chevron-right"
									style={{ fontSize: "14px", flexShrink: 0, marginLeft: 8 }}
								/>
							)}
						{(option.type === ContextMenuOptionType.Problems ||
							((option.type === ContextMenuOptionType.File ||
								option.type === ContextMenuOptionType.Folder) &&
								option.value)) && (
							<i
								className="codicon codicon-add"
								style={{ fontSize: "14px", flexShrink: 0, marginLeft: 8 }}
							/>
						)}
					</div>
				))}
			</div>
		</div>
	)
}

export default ContextMenu
