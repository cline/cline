import { EmptyRequest } from "@shared/proto/cline/common"
import { GetTaskHistoryRequest, WorkspaceInfo } from "@shared/proto/cline/task"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import Fuse from "fuse.js"
import { KeyboardEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import styled from "styled-components"
import { TaskServiceClient } from "@/services/grpc-client"
import { highlight } from "./HistoryView"

export const WORKSPACE_FILTER_DROPDOWN_Z_INDEX = 1_000

interface WorkspaceFilterDropdownProps {
	selectedWorkspaceId: string | null // null = "All Workspaces", "" = "Current Workspace"
	onWorkspaceChange: (workspaceId: string | null) => void
	onFilterChange: (request: GetTaskHistoryRequest) => void
	currentFilters: GetTaskHistoryRequest
}

const WorkspaceFilterDropdown = ({
	selectedWorkspaceId,
	onWorkspaceChange,
	onFilterChange,
	currentFilters,
}: WorkspaceFilterDropdownProps) => {
	const [searchTerm, setSearchTerm] = useState("")
	const [isDropdownVisible, setIsDropdownVisible] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(-1)
	const [knownWorkspaces, setKnownWorkspaces] = useState<WorkspaceInfo[]>([])
	const dropdownRef = useRef<HTMLDivElement>(null)
	const itemRefs = useRef<(HTMLDivElement | null)[]>([])
	const dropdownListRef = useRef<HTMLDivElement>(null)

	// Load workspaces from backend
	useEffect(() => {
		const loadWorkspaces = async () => {
			try {
				const response = await TaskServiceClient.getKnownWorkspaces(EmptyRequest.create({}))
				setKnownWorkspaces(response.workspaces || [])
			} catch (error) {
				console.error("Error loading workspaces:", error)
			}
		}
		loadWorkspaces()
	}, [])

	// Close dropdown when clicking outside
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

	// Build searchable items list
	const searchableItems = useMemo(() => {
		const items = [
			{ id: "", name: "Current Workspace", path: "", isSpecial: true },
			{ id: null, name: "All Workspaces", path: "", isSpecial: true },
			...knownWorkspaces.map((ws) => ({ id: ws.path, name: ws.name, path: ws.path, isSpecial: false })),
		]
		return items.map((item) => ({
			...item,
			html: item.name,
		}))
	}, [knownWorkspaces])

	const fuse = useMemo(() => {
		return new Fuse(searchableItems, {
			keys: ["name", "path"],
			threshold: 0.4,
			shouldSort: true,
			isCaseSensitive: false,
			ignoreLocation: false,
			includeMatches: true,
			minMatchCharLength: 1,
		})
	}, [searchableItems])

	const workspaceSearchResults = useMemo(() => {
		if (!searchTerm) {
			return searchableItems
		}

		const fuseResults = fuse.search(searchTerm)

		// If no results, return empty array so dropdown shows "no results" state
		if (fuseResults.length === 0) {
			return []
		}

		// Highlight matching text in results
		return highlight(fuseResults, "workspace-filter-item-highlight")
	}, [searchableItems, searchTerm, fuse])

	const currentDisplayName = useMemo(() => {
		if (selectedWorkspaceId === null) return "All Workspaces"
		if (selectedWorkspaceId === "") return "Current Workspace"
		const workspace = knownWorkspaces.find((ws) => ws.path === selectedWorkspaceId)
		return workspace?.name || selectedWorkspaceId
	}, [selectedWorkspaceId, knownWorkspaces])

	const handleWorkspaceSelect = useCallback(
		(workspaceId: string | null) => {
			onWorkspaceChange(workspaceId)
			setSearchTerm("")
			setIsDropdownVisible(false)

			// Update filter request
			const newFilters = GetTaskHistoryRequest.create({
				...currentFilters,
				currentWorkspaceOnly: workspaceId === "",
				filterByWorkspaceId: typeof workspaceId === "string" && workspaceId !== "" ? workspaceId : undefined,
			})
			onFilterChange(newFilters)
		},
		[onWorkspaceChange, onFilterChange, currentFilters],
	)

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (!isDropdownVisible) {
			return
		}

		switch (event.key) {
			case "ArrowDown":
				event.preventDefault()
				setSelectedIndex((prev) => (prev < workspaceSearchResults.length - 1 ? prev + 1 : prev))
				break
			case "ArrowUp":
				event.preventDefault()
				setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev))
				break
			case "Enter":
				event.preventDefault()
				if (selectedIndex >= 0 && selectedIndex < workspaceSearchResults.length) {
					handleWorkspaceSelect(workspaceSearchResults[selectedIndex].id)
				}
				break
			case "Escape":
				setIsDropdownVisible(false)
				setSelectedIndex(-1)
				setSearchTerm("")
				break
		}
	}

	// Reset selection when search term changes
	useEffect(() => {
		setSelectedIndex(-1)
		if (dropdownListRef.current) {
			dropdownListRef.current.scrollTop = 0
		}
	}, [searchTerm])

	// Scroll selected item into view
	useEffect(() => {
		if (selectedIndex >= 0 && itemRefs.current[selectedIndex]) {
			itemRefs.current[selectedIndex]?.scrollIntoView({
				block: "nearest",
				behavior: "smooth",
			})
		}
	}, [selectedIndex])

	return (
		<div style={{ width: "100%", minWidth: "200px" }}>
			<style>
				{`
				.workspace-filter-item-highlight {
					background-color: var(--vscode-editor-findMatchHighlightBackground);
					color: inherit;
				}
				`}
			</style>
			<DropdownWrapper ref={dropdownRef}>
				<VSCodeTextField
					id="workspace-filter-search"
					onFocus={() => setIsDropdownVisible(true)}
					onInput={(e) => {
						const value = (e.target as HTMLInputElement)?.value || ""
						setSearchTerm(value)
						setIsDropdownVisible(true)
					}}
					onKeyDown={handleKeyDown}
					placeholder={currentDisplayName}
					style={{
						width: "100%",
						zIndex: WORKSPACE_FILTER_DROPDOWN_Z_INDEX,
						position: "relative",
					}}
					value={searchTerm}>
					<div
						className="codicon codicon-folder"
						slot="start"
						style={{
							fontSize: 13,
							marginTop: 2.5,
							opacity: 0.8,
						}}
					/>
					{searchTerm && (
						<div
							aria-label="Clear search"
							className="input-icon-button codicon codicon-close"
							onClick={() => {
								setSearchTerm("")
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
						{workspaceSearchResults.length === 0 && searchTerm ? (
							<DropdownItem isSelected={false}>
								<div style={{ opacity: 0.6, fontStyle: "italic" }}>No matching workspaces found</div>
							</DropdownItem>
						) : (
							workspaceSearchResults.map((item, index) => (
								<DropdownItem
									isSelected={index === selectedIndex}
									key={`${item.id}-${item.name}`}
									onClick={() => handleWorkspaceSelect(item.id)}
									onMouseEnter={() => setSelectedIndex(index)}
									ref={(el) => (itemRefs.current[index] = el)}>
									<div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
										<span
											className={`codicon ${item.isSpecial ? "codicon-globe" : "codicon-folder"}`}
											style={{ fontSize: "14px", opacity: 0.8 }}
										/>
										<span dangerouslySetInnerHTML={{ __html: item.html }} />
									</div>
									{!item.isSpecial && item.path && (
										<div
											style={{
												fontSize: "11px",
												opacity: 0.6,
												marginTop: "2px",
												marginLeft: "20px",
												wordBreak: "break-all",
											}}>
											{item.path}
										</div>
									)}
								</DropdownItem>
							))
						)}
					</DropdownList>
				)}
			</DropdownWrapper>
		</div>
	)
}

export default memo(WorkspaceFilterDropdown)

// Styled components

const DropdownWrapper = styled.div`
	position: relative;
	width: 100%;
`

const DropdownList = styled.div`
	position: absolute;
	top: calc(100% - 3px);
	left: 0;
	width: calc(100% - 2px);
	max-height: 300px;
	overflow-y: auto;
	background-color: var(--vscode-dropdown-background);
	border: 1px solid var(--vscode-list-activeSelectionBackground);
	z-index: ${WORKSPACE_FILTER_DROPDOWN_Z_INDEX - 1};
	border-bottom-left-radius: 3px;
	border-bottom-right-radius: 3px;
`

const DropdownItem = styled.div<{ isSelected: boolean }>`
	padding: 8px 10px;
	cursor: pointer;
	word-break: break-word;
	white-space: normal;

	background-color: ${({ isSelected }) => (isSelected ? "var(--vscode-list-activeSelectionBackground)" : "inherit")};

	&:hover {
		background-color: var(--vscode-list-activeSelectionBackground);
	}
`
