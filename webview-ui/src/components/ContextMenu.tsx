import React, { useEffect, useState, useRef } from "react"
import { getContextMenuOptions } from "../utils/mention-context"

interface ContextMenuProps {
	onSelect: (type: string, value: string) => void
	searchQuery: string
	onMouseDown: () => void
	selectedIndex: number
	setSelectedIndex: (index: number) => void
	selectedType: string | null
}

const ContextMenu: React.FC<ContextMenuProps> = ({
	onSelect,
	searchQuery,
	onMouseDown,
	selectedIndex,
	setSelectedIndex,
	selectedType,
}) => {
	const [filteredOptions, setFilteredOptions] = useState(getContextMenuOptions(searchQuery, selectedType))
	const menuRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		setFilteredOptions(getContextMenuOptions(searchQuery, selectedType))
	}, [searchQuery, selectedType])

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

	return (
		<div
			style={{
				position: "absolute",
				bottom: "calc(100% - 10px)",
				left: 15,
				right: 15,
			}}
			onMouseDown={onMouseDown}>
			<div
				ref={menuRef}
				style={{
					backgroundColor: "var(--vscode-dropdown-background)",
					border: "1px solid var(--vscode-dropdown-border)",
					borderRadius: "3px",
					zIndex: 1000,
					display: "flex",
					flexDirection: "column",
					boxShadow: "0 8px 16px rgba(0,0,0,0.24)",
					maxHeight: "200px",
					overflowY: "auto",
				}}>
				{filteredOptions.map((option, index) => (
					<div
						key={option.value}
						onClick={() => option.type !== "url" && onSelect(option.type, option.value)}
						style={{
							padding: "8px 12px",
							cursor: option.type !== "url" ? "pointer" : "default",
							color: "var(--vscode-dropdown-foreground)",
							borderBottom: "1px solid var(--vscode-dropdown-border)",
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							backgroundColor:
								index === selectedIndex && option.type !== "url"
									? "var(--vscode-list-activeSelectionBackground)"
									: "",
							// opacity: option.type === "url" ? 0.5 : 1, // Make URL option appear disabled
						}}
						onMouseEnter={() => option.type !== "url" && setSelectedIndex(index)}>
						<div style={{ display: "flex", alignItems: "center" }}>
							<i className={`codicon codicon-${option.icon}`} style={{ marginRight: "8px" }} />
							{option.value === "File"
								? "Add file"
								: option.value === "Folder"
								? "Add folder"
								: option.value === "Problems"
								? "Workspace Problems"
								: option.value === "URL"
								? "Paste URL to scrape"
								: option.value}
						</div>
						{(option.value === "File" || option.value === "Folder") && (
							<i className="codicon codicon-chevron-right" style={{ fontSize: "14px" }} />
						)}
						{(option.type === "problems" ||
							((option.type === "file" || option.type === "folder") &&
								option.value !== "File" &&
								option.value !== "Folder")) && (
							<i className="codicon codicon-add" style={{ fontSize: "14px" }} />
						)}
					</div>
				))}
			</div>
		</div>
	)
}

export default ContextMenu
