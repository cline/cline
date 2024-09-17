import React, { useEffect, useRef, useState } from "react"
import { getContextMenuOptions } from "../utils/mention-context"
import { removeLeadingNonAlphanumeric } from "./CodeAccordian"

interface ContextMenuProps {
	onSelect: (type: string, value: string) => void
	searchQuery: string
	onMouseDown: () => void
	selectedIndex: number
	setSelectedIndex: (index: number) => void
	selectedType: string | null
	searchPaths: { type: string; path: string }[]
}

const ContextMenu: React.FC<ContextMenuProps> = ({
	onSelect,
	searchQuery,
	onMouseDown,
	selectedIndex,
	setSelectedIndex,
	selectedType,
	searchPaths,
}) => {
	const [filteredOptions, setFilteredOptions] = useState(
		getContextMenuOptions(searchQuery, selectedType, searchPaths)
	)
	const menuRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		setFilteredOptions(getContextMenuOptions(searchQuery, selectedType, searchPaths))
	}, [searchQuery, selectedType, searchPaths])

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

	const renderOptionContent = (option: { type: string; value: string }) => {
		switch (option.value) {
			case "file":
			case "folder":
			case "problems":
			case "url":
				return (
					<span
						style={{
							whiteSpace: "nowrap",
							overflow: "hidden",
							textOverflow: "ellipsis",
						}}>
						{option.value === "file"
							? "Add File"
							: option.value === "folder"
							? "Add Folder"
							: option.value === "problems"
							? "Problems"
							: option.value === "url"
							? "Paste URL to scrape"
							: ""}
					</span>
				)
			default:
				return (
					<span
						style={{
							whiteSpace: "nowrap",
							overflow: "hidden",
							textOverflow: "ellipsis",
							direction: "rtl",
							textAlign: "left",
						}}>
						{removeLeadingNonAlphanumeric(option.value) + "\u200E"}
					</span>
				)
		}
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
						}}
						onMouseEnter={() => option.type !== "url" && setSelectedIndex(index)}>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								flex: 1,
								minWidth: 0, // Allows child to shrink below content size
								overflow: "hidden", // Ensures content doesn't overflow
							}}>
							<i
								className={`codicon codicon-${option.icon}`}
								style={{ marginRight: "8px", flexShrink: 0, fontSize: "14px" }}
							/>
							{renderOptionContent(option)}
						</div>
						{(option.value === "file" || option.value === "folder") && (
							<i
								className="codicon codicon-chevron-right"
								style={{ fontSize: "14px", flexShrink: 0, marginLeft: 8 }}
							/>
						)}
						{(option.type === "problems" ||
							((option.type === "file" || option.type === "folder") &&
								option.value !== "file" &&
								option.value !== "folder")) && (
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
