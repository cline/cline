import React, { useEffect, useMemo, useRef } from "react"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { ContextMenuOptionType, ContextMenuQueryItem, getContextMenuOptions } from "../../utils/context-mentions"
import { cleanPathPrefix } from "../common/CodeAccordian"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { vscode } from "../../utils/vscode"

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
	const { memoryBankSettings } = useExtensionState()

	const filteredOptions = useMemo(
		() => getContextMenuOptions(searchQuery, selectedType, queryItems),
		[searchQuery, selectedType, queryItems],
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

	const updateMemoryBank = (enabled: boolean) => {
		vscode.postMessage({
			type: "memoryBankSettings",
			memoryBankSettings: {
				...memoryBankSettings,
				enabled,
			},
		})
	}

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
			case ContextMenuOptionType.MemoryBank:
				if (option.type === ContextMenuOptionType.MemoryBank && option.value === "Enable Memory Bank") {
					return (
						<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
							<VSCodeCheckbox
								checked={memoryBankSettings.enabled}
								onChange={() => {
									updateMemoryBank(!memoryBankSettings.enabled)
								}}
								title="Enable Memory Bank"
								aria-label="Enable Memory Bank"
							/>
							<span>Enable Memory Bank</span>
						</div>
					)
				} else if (option.type === ContextMenuOptionType.MemoryBank && option.value) {
					return <span>{option.value}</span>
				} else {
					return <span>Memory Bank</span>
				}

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
								{cleanPathPrefix(option.value || "") + "\u200E"}
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
			case ContextMenuOptionType.MemoryBank:
				return "database"
			case ContextMenuOptionType.Git:
				return "git-commit"
			case ContextMenuOptionType.NoResults:
				return "info"
			default:
				return "file"
		}
	}

	const isOptionSelectable = (option: ContextMenuQueryItem): boolean => {
		if (
			option.type === ContextMenuOptionType.MemoryBank &&
			(option.value === "Initialize Memory Bank" ||
				option.value === "Update Memory Bank" ||
				option.value === "Follow your custom instructions")
		) {
			return memoryBankSettings.enabled
		}
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
					maxHeight: "250px",
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
							pointerEvents: isOptionSelectable(option) ? "auto" : "none",
							color:
								isOptionSelectable(option) || option.type === ContextMenuOptionType.URL
									? index === selectedIndex
										? "var(--vscode-quickInputList-focusForeground)"
										: "inherit"
									: "gray",
							borderBottom: "1px solid var(--vscode-editorGroup-border)",
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							backgroundColor:
								index === selectedIndex && isOptionSelectable(option)
									? "var(--vscode-quickInputList-focusBackground)"
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
								style={{
									marginRight: "8px",
									flexShrink: 0,
									fontSize: "14px",
								}}
							/>
							{renderOptionContent(option)}
						</div>
						{(option.type === ContextMenuOptionType.File ||
							option.type === ContextMenuOptionType.Folder ||
							option.type === ContextMenuOptionType.MemoryBank ||
							option.type === ContextMenuOptionType.Git) &&
							!option.value && (
								<i
									className="codicon codicon-chevron-right"
									style={{
										fontSize: "14px",
										flexShrink: 0,
										marginLeft: 8,
									}}
								/>
							)}
						{(option.type === ContextMenuOptionType.Problems ||
							option.type === ContextMenuOptionType.Terminal ||
							((option.type === ContextMenuOptionType.File ||
								option.type === ContextMenuOptionType.Folder ||
								option.type === ContextMenuOptionType.Git) &&
								option.value)) && (
							<i
								className="codicon codicon-add"
								style={{
									fontSize: "14px",
									flexShrink: 0,
									marginLeft: 8,
								}}
							/>
						)}
						{option.type === ContextMenuOptionType.MemoryBank &&
							option.value &&
							option.value !== "Enable Memory Bank" && (
								<i
									className="codicon codicon-comment"
									style={{
										fontSize: "14px",
										flexShrink: 0,
										marginLeft: 8,
									}}
								/>
							)}
					</div>
				))}
			</div>
		</div>
	)
}

export default ContextMenu
