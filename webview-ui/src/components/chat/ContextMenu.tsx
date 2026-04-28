import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { cleanPathPrefix } from "@/components/common/CodeAccordian"
import ScreenReaderAnnounce from "@/components/common/ScreenReaderAnnounce"
import { useMenuAnnouncement } from "@/hooks/useMenuAnnouncement"
import { ContextMenuOptionType, ContextMenuQueryItem, getContextMenuOptions, SearchResult } from "@/utils/context-mentions"

interface ContextMenuProps {
	onSelect: (type: ContextMenuOptionType, value?: string) => void
	searchQuery: string
	onMouseDown: () => void
	selectedIndex: number
	setSelectedIndex: (index: number) => void
	selectedType: ContextMenuOptionType | null;
	queryItems: ContextMenuQueryItem[]
	dynamicSearchResults?: SearchResult[]
	isLoading?: boolean
	// CLINE-1814: structured error_reason / error_message from the most recent
	// FileService.searchFiles response. When present and the picker would
	// otherwise show "no results found", we render a grey italic subtitle so
	// the user can tell a "still loading", "ripgrep is broken", or "workspace
	// is missing" state apart from a genuinely empty result set. See proto
	// `cline.FileSearchResults.error_reason` for the closed enumeration.
	errorReason?: string
	errorMessage?: string
}

/**
 * CLINE-1814: map a structured `error_reason` to a short, user-readable
 * subtitle that gets rendered in grey beneath the "No results found" row.
 *
 * Phrasing rules:
 *   - `workspace_not_ready` is rendered neutrally — it is *expected* during
 *     IDE startup and the picker self-heals on the next keystroke. Do not use
 *     the word "indexing"; the trigger is project-model-not-yet-applied,
 *     which is a different (narrower) IntelliJ window than dumb mode.
 *   - `workspace_unavailable` is the non-transient form. Tell the user the
 *     workspace itself is missing.
 *   - `ripgrep_spawn_failed` carries the first line of stderr from rg in
 *     `error_message`; render it verbatim because it's typically the most
 *     useful diagnostic (`ENOENT`, `Operation not permitted`, etc.).
 *   - `results_truncated` is a Phase 2C signal — already wired in the proto
 *     so the UI is forwards-compatible.
 */
function renderErrorSubtitle(reason: string, message: string): string | null {
	if (!reason) {
		return null
	}
	switch (reason) {
		case "workspace_not_ready":
			return "(your IDE is still loading the project — try again in a moment)"
		case "workspace_unavailable":
			return "(workspace path unavailable)"
		case "ripgrep_spawn_failed":
			return message ? `(ripgrep failed: ${message})` : "(ripgrep failed)"
		case "results_truncated":
			return "(showing first 5000 results; refine your query)"
		case "unknown":
		default:
			return message ? `(internal error: ${message})` : "(internal error)"
	}
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
	errorReason = "",
	errorMessage = "",
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

	// Shared label definitions for simple option types
	const SIMPLE_OPTION_LABELS: Partial<Record<ContextMenuOptionType, string>> = {
		[ContextMenuOptionType.Problems]: "Problems",
		[ContextMenuOptionType.URL]: "Paste URL to fetch contents",
		[ContextMenuOptionType.NoResults]: "No results found",
	}

	// Get accessible label for an option (used for screen readers and aria-label)
	const getOptionLabel = useCallback((option: ContextMenuQueryItem): string => {
		// Check simple labels first
		const simpleLabel = SIMPLE_OPTION_LABELS[option.type]
		if (simpleLabel) {
			return simpleLabel
		}

		switch (option.type) {
			case ContextMenuOptionType.Git:
				if (option.value) {
					return `${option.label}${option.description ? `, ${option.description}` : ""}`
				}
				return "Git Commits"
			case ContextMenuOptionType.File:
			case ContextMenuOptionType.Folder:
				if (option.value) {
					return option.label || option.value
				}
				return `Add ${option.type === ContextMenuOptionType.File ? "File" : "Folder"}`
			default:
				return option.label || option.value || ""
		}
	}, [])

	const renderOptionContent = (option: ContextMenuQueryItem) => {
		// CLINE-1814: when the row is the NoResults sentinel and we have a
		// structured error_reason, render a two-line layout:
		//   "No results found"
		//   "(workspace path unavailable)"  -- grey, italic, smaller
		// so the user can tell a healthy-but-empty result set apart from a
		// real failure mode. Keep the simple label for the URL/Problems rows.
		if (option.type === ContextMenuOptionType.NoResults) {
			const subtitle = renderErrorSubtitle(errorReason, errorMessage)
			if (subtitle) {
				return (
					<div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
						<span style={{ lineHeight: "1.2" }}>No results found</span>
						<span
							style={{
								fontSize: "0.85em",
								opacity: 0.7,
								fontStyle: "italic",
								whiteSpace: "nowrap",
								overflow: "hidden",
								textOverflow: "ellipsis",
								lineHeight: "1.2",
							}}
							title={errorMessage || subtitle}>
							{subtitle}
						</span>
					</div>
				)
			}
			return <span>No results found</span>
		}

		// Handle simple label types
		const simpleLabel = SIMPLE_OPTION_LABELS[option.type]
		if (simpleLabel) {
			return <span>{simpleLabel}</span>
		}

		switch (option.type) {
			case ContextMenuOptionType.Git:
				if (option.value) {
					return (
						<div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
							<span className="ph-no-capture" style={{ lineHeight: "1.2" }}>
								{option.label}
							</span>
							<span
								className="ph-no-capture"
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
				}
				return <span>Git Commits</span>
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
								className="ph-no-capture"
								style={{
									whiteSpace: "nowrap",
									overflow: "hidden",
									textOverflow: "ellipsis",
									direction: displayText.includes(":") ? "ltr" : "rtl",
									textAlign: "left",
								}}>
								{displayText.includes(":") ? displayText : cleanPathPrefix(displayText) + "\u200E"}
							</span>
						</>
					)
				}
				return <span>Add {option.type === ContextMenuOptionType.File ? "File" : "Folder"}</span>
			default:
				return null
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

	// Screen reader announcements
	const { announcement } = useMenuAnnouncement({
		items: filteredOptions,
		selectedIndex,
		getItemLabel: getOptionLabel,
		isItemSelectable: isOptionSelectable,
	})

	// Handle selection with announcement
	const handleSelect = useCallback(
		(option: ContextMenuQueryItem) => {
			if (isOptionSelectable(option)) {
				const mentionValue = option.label?.includes(":") ? option.label : option.value
				onSelect(option.type, mentionValue)
			}
		},
		[onSelect],
	)

	return (
		<div
			onMouseDown={onMouseDown}
			style={{
				position: "absolute",
				bottom: "calc(100% - 10px)",
				left: 15,
				right: 15,
				overflowX: "hidden",
			}}>
			<ScreenReaderAnnounce message={announcement} />
			<div
				aria-activedescendant={
					filteredOptions.length > selectedIndex &&
					selectedIndex > -1 &&
					isOptionSelectable(filteredOptions[selectedIndex])
						? `context-menu-item-${selectedIndex}`
						: undefined
				}
				aria-label="Context mentions"
				ref={menuRef}
				role="listbox"
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
				{showDelayedLoading && searchQuery && (
					<div
						style={{
							padding: "8px 12px",
							display: "flex",
							alignItems: "center",
							gap: "8px",
							opacity: 0.7,
						}}>
						<i className="codicon codicon-loading codicon-modifier-spin" style={{ fontSize: "14px" }} />
						<span>Searching...</span>
					</div>
				)}
				{filteredOptions.map((option, index) => {
					// Include workspace name in key for files/folders to handle duplicates across workspaces
					const workspacePrefix = option.workspaceName ? `${option.workspaceName}:` : ""
					const generatedKey = `${option.type}-${workspacePrefix}${option.value || index}`

					return (
						<div
							aria-label={getOptionLabel(option)}
							aria-selected={index === selectedIndex && isOptionSelectable(option)}
							id={`context-menu-item-${index}`}
							key={generatedKey}
							onClick={() => handleSelect(option)}
							onMouseEnter={() => isOptionSelectable(option) && setSelectedIndex(index)}
							role="option"
							style={{
								padding: "8px 12px",
								cursor: isOptionSelectable(option) ? "pointer" : "default",
								color:
									index === selectedIndex && isOptionSelectable(option)
										? "var(--vscode-quickInputList-focusForeground)"
										: "",
								borderBottom: "1px solid var(--vscode-editorGroup-border)",
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								backgroundColor:
									index === selectedIndex && isOptionSelectable(option)
										? "var(--vscode-quickInputList-focusBackground)"
										: "",
							}}>
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
						</div>
					)
				})}
			</div>
		</div>
	)
}

export default ContextMenu
