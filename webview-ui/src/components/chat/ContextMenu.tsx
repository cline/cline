import React, { useEffect, useMemo, useRef, useState } from "react"
import { getIconForFilePath, getIconUrlByName, getIconForDirectoryPath } from "vscode-material-icons"
import {
	ContextMenuOptionType,
	ContextMenuQueryItem,
	getContextMenuOptions,
	SearchResult,
} from "@src/utils/context-mentions"
import { removeLeadingNonAlphanumeric } from "../common/CodeAccordian"
import { ModeConfig } from "@roo/shared/modes"

interface ContextMenuProps {
	onSelect: (type: ContextMenuOptionType, value?: string) => void
	searchQuery: string
	inputValue: string
	onMouseDown: () => void
	selectedIndex: number
	setSelectedIndex: (index: number) => void
	selectedType: ContextMenuOptionType | null
	queryItems: ContextMenuQueryItem[]
	modes?: ModeConfig[]
	loading?: boolean
	dynamicSearchResults?: SearchResult[]
}

const ContextMenu: React.FC<ContextMenuProps> = ({
	onSelect,
	searchQuery,
	inputValue,
	onMouseDown,
	selectedIndex,
	setSelectedIndex,
	selectedType,
	queryItems,
	modes,
	dynamicSearchResults = [],
}) => {
	const [materialIconsBaseUri, setMaterialIconsBaseUri] = useState("")
	const menuRef = useRef<HTMLDivElement>(null)

	const filteredOptions = useMemo(() => {
		return getContextMenuOptions(searchQuery, inputValue, selectedType, queryItems, dynamicSearchResults, modes)
	}, [searchQuery, inputValue, selectedType, queryItems, dynamicSearchResults, modes])

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

	// get the icons base uri on mount
	useEffect(() => {
		const w = window as any
		setMaterialIconsBaseUri(w.MATERIAL_ICONS_BASE_URI)
	}, [])

	const renderOptionContent = (option: ContextMenuQueryItem) => {
		switch (option.type) {
			case ContextMenuOptionType.Mode:
				return (
					<div className="flex flex-col gap-0.5">
						<span className="leading-tight">{option.label}</span>
						{option.description && (
							<span className="opacity-50 text-[0.9em] leading-tight whitespace-nowrap overflow-hidden text-ellipsis">
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
						<div className="flex flex-col">
							<span className="leading-tight">{option.label}</span>
							<span className="text-[0.85em] opacity-70 whitespace-nowrap overflow-hidden text-ellipsis leading-tight">
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
					// remove trailing slash
					const path = removeLeadingNonAlphanumeric(option.value || "").replace(/\/$/, "")
					const pathList = path.split("/")
					const filename = pathList.at(-1)
					const folderPath = pathList.slice(0, -1).join("/")
					return (
						<div className="flex-1 overflow-hidden flex gap-[0.5em] whitespace-nowrap items-center justify-between text-left">
							<span>{filename}</span>
							<span className="whitespace-nowrap overflow-hidden text-ellipsis rtl text-right flex-1 opacity-75 text-[0.75em]">
								{folderPath}
							</span>
						</div>
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

	const getMaterialIconForOption = (option: ContextMenuQueryItem): string => {
		// only take the last part of the path to handle both file and folder icons
		// since material-icons have specific folder icons, we use them if available
		const name = option.value?.split("/").filter(Boolean).at(-1) ?? ""
		const iconName =
			option.type === ContextMenuOptionType.Folder ? getIconForDirectoryPath(name) : getIconForFilePath(name)
		return getIconUrlByName(iconName, materialIconsBaseUri)
	}

	const isOptionSelectable = (option: ContextMenuQueryItem): boolean => {
		return option.type !== ContextMenuOptionType.NoResults && option.type !== ContextMenuOptionType.URL
	}

	return (
		<div
			className="absolute bottom-[calc(100%-10px)] left-[15px] right-[15px] overflow-x-hidden"
			onMouseDown={onMouseDown}>
			<div
				ref={menuRef}
				className="bg-vscode-dropdown-background border border-vscode-editorGroup-border rounded-[3px] shadow-[0_4px_10px_rgba(0,0,0,0.25)] z-[1000] flex flex-col max-h-[200px] overflow-y-auto">
				{filteredOptions && filteredOptions.length > 0 ? (
					filteredOptions.map((option, index) => (
						<div
							key={`${option.type}-${option.value || index}`}
							onClick={() => isOptionSelectable(option) && onSelect(option.type, option.value)}
							className={`p-[4px_6px] text-vscode-dropdown-foreground flex items-center justify-between ${
								isOptionSelectable(option) ? "cursor-pointer" : "cursor-default"
							} ${
								index === selectedIndex && isOptionSelectable(option)
									? "bg-vscode-list-activeSelectionBackground text-vscode-list-activeSelectionForeground"
									: ""
							}`}
							onMouseEnter={() => isOptionSelectable(option) && setSelectedIndex(index)}>
							<div className="flex items-center flex-1 min-w-0 overflow-hidden pt-0">
								{(option.type === ContextMenuOptionType.File ||
									option.type === ContextMenuOptionType.Folder ||
									option.type === ContextMenuOptionType.OpenedFile) && (
									<img
										src={getMaterialIconForOption(option)}
										alt="Mode"
										className="mr-[6px] flex-shrink-0 w-4 h-4"
									/>
								)}
								{option.type !== ContextMenuOptionType.Mode &&
									option.type !== ContextMenuOptionType.File &&
									option.type !== ContextMenuOptionType.Folder &&
									option.type !== ContextMenuOptionType.OpenedFile &&
									getIconForOption(option) && (
										<i
											className={`codicon codicon-${getIconForOption(
												option,
											)} mr-[6px] flex-shrink-0 text-sm mt-0`}
										/>
									)}
								{renderOptionContent(option)}
							</div>
							{(option.type === ContextMenuOptionType.File ||
								option.type === ContextMenuOptionType.Folder ||
								option.type === ContextMenuOptionType.Git) &&
								!option.value && (
									<i className="codicon codicon-chevron-right text-[10px] flex-shrink-0 ml-2" />
								)}
						</div>
					))
				) : (
					<div className="p-1 flex items-center justify-center text-vscode-foreground opacity-70">
						<span>No results found</span>
					</div>
				)}
			</div>
		</div>
	)
}
export default ContextMenu
