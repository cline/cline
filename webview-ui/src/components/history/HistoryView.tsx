import { BooleanRequest, EmptyRequest, StringArrayRequest, StringRequest } from "@shared/proto/cline/common"
import { GetTaskHistoryRequest, TaskFavoriteRequest } from "@shared/proto/cline/task"
import { VSCodeButton, VSCodeCheckbox, VSCodeRadio, VSCodeRadioGroup, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import Fuse, { FuseResult } from "fuse.js"
import { ArrowDownIcon, ArrowDownToLineIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, BrainIcon } from "lucide-react"
import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { Virtuoso } from "react-virtuoso"
import DangerButton from "@/components/common/DangerButton"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { TaskServiceClient } from "@/services/grpc-client"
import { formatLargeNumber, formatSize } from "@/utils/format"

type HistoryViewProps = {
	onDone: () => void
}

type SortOption = "newest" | "oldest" | "mostExpensive" | "mostTokens" | "mostRelevant"

// Tailwind-styled radio with custom icon support - works independently of VSCodeRadioGroup but looks the same
// Used for workspace and favorites filters

interface CustomFilterRadioProps {
	checked: boolean
	onChange: () => void
	icon: string
	label: string
}

const CustomFilterRadio = ({ checked, onChange, icon, label }: CustomFilterRadioProps) => {
	return (
		<div
			className="flex items-center cursor-pointer py-[0.3em] px-0 mr-[10px] text-[var(--vscode-font-size)] select-none"
			onClick={onChange}>
			<div
				className={`w-[14px] h-[14px] rounded-full border border-[var(--vscode-checkbox-border)] relative flex justify-center items-center mr-[6px] ${
					checked ? "bg-[var(--vscode-checkbox-background)]" : "bg-transparent"
				}`}>
				{checked && <div className="w-[6px] h-[6px] rounded-full bg-[var(--vscode-checkbox-foreground)]" />}
			</div>
			<span className="flex items-center gap-[3px]">
				<div className={`codicon codicon-${icon} text-[var(--vscode-button-background)] text-base`} />
				{label}
			</span>
		</div>
	)
}

const HistoryView = ({ onDone }: HistoryViewProps) => {
	const extensionStateContext = useExtensionState()
	const { taskHistory, onRelinquishControl } = extensionStateContext
	const [searchQuery, setSearchQuery] = useState("")
	const [sortOption, setSortOption] = useState<SortOption>("newest")
	const [lastNonRelevantSort, setLastNonRelevantSort] = useState<SortOption | null>("newest")
	const [deleteAllDisabled, setDeleteAllDisabled] = useState(false)
	const [selectedItems, setSelectedItems] = useState<string[]>([])
	const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)
	const [showCurrentWorkspaceOnly, setShowCurrentWorkspaceOnly] = useState(false)

	// Keep track of pending favorite toggle operations
	const [pendingFavoriteToggles, setPendingFavoriteToggles] = useState<Record<string, boolean>>({})

	// Load filtered task history with gRPC
	const [tasks, setTasks] = useState<any[]>([])

	// Load and refresh task history
	const loadTaskHistory = useCallback(async () => {
		try {
			const response = await TaskServiceClient.getTaskHistory(
				GetTaskHistoryRequest.create({
					favoritesOnly: showFavoritesOnly,
					searchQuery: searchQuery || undefined,
					sortBy: sortOption,
					currentWorkspaceOnly: showCurrentWorkspaceOnly,
				}),
			)
			setTasks(response.tasks || [])
		} catch (error) {
			console.error("Error loading task history:", error)
		}
	}, [showFavoritesOnly, showCurrentWorkspaceOnly, searchQuery, sortOption, taskHistory])

	// Load when filters change
	useEffect(() => {
		// Force a complete refresh when both filters are active
		// to ensure proper combined filtering
		if (showFavoritesOnly && showCurrentWorkspaceOnly) {
			setTasks([])
		}
		loadTaskHistory()
	}, [loadTaskHistory, showFavoritesOnly, showCurrentWorkspaceOnly])

	const toggleFavorite = useCallback(
		async (taskId: string, currentValue: boolean) => {
			// Optimistic UI update
			setPendingFavoriteToggles((prev) => ({ ...prev, [taskId]: !currentValue }))

			try {
				await TaskServiceClient.toggleTaskFavorite(
					TaskFavoriteRequest.create({
						taskId,
						isFavorited: !currentValue,
					}),
				)

				// Refresh if either filter is active to ensure proper combined filtering
				if (showFavoritesOnly || showCurrentWorkspaceOnly) {
					loadTaskHistory()
				}
			} catch (err) {
				console.error(`[FAVORITE_TOGGLE_UI] Error for task ${taskId}:`, err)
				// Revert optimistic update
				setPendingFavoriteToggles((prev) => {
					const updated = { ...prev }
					delete updated[taskId]
					return updated
				})
			} finally {
				// Clean up pending state after 1 second
				setTimeout(() => {
					setPendingFavoriteToggles((prev) => {
						const updated = { ...prev }
						delete updated[taskId]
						return updated
					})
				}, 1000)
			}
		},
		[showFavoritesOnly, loadTaskHistory],
	)

	// Use the onRelinquishControl hook instead of message event
	useEffect(() => {
		return onRelinquishControl(() => {
			setDeleteAllDisabled(false)
		})
	}, [onRelinquishControl])

	const { totalTasksSize, setTotalTasksSize } = extensionStateContext

	const fetchTotalTasksSize = useCallback(async () => {
		try {
			const response = await TaskServiceClient.getTotalTasksSize(EmptyRequest.create({}))
			if (response && typeof response.value === "number") {
				setTotalTasksSize?.(response.value || 0)
			}
		} catch (error) {
			console.error("Error getting total tasks size:", error)
		}
	}, [setTotalTasksSize])

	// Request total tasks size when component mounts
	useEffect(() => {
		fetchTotalTasksSize()
	}, [fetchTotalTasksSize])

	useEffect(() => {
		if (searchQuery && sortOption !== "mostRelevant" && !lastNonRelevantSort) {
			setLastNonRelevantSort(sortOption)
			setSortOption("mostRelevant")
		} else if (!searchQuery && sortOption === "mostRelevant" && lastNonRelevantSort) {
			setSortOption(lastNonRelevantSort)
			setLastNonRelevantSort(null)
		}
	}, [searchQuery, sortOption, lastNonRelevantSort])

	const handleShowTaskWithId = useCallback((id: string) => {
		TaskServiceClient.showTaskWithId(StringRequest.create({ value: id })).catch((error) =>
			console.error("Error showing task:", error),
		)
	}, [])

	const handleHistorySelect = useCallback((itemId: string, checked: boolean) => {
		setSelectedItems((prev) => {
			if (checked) {
				return [...prev, itemId]
			} else {
				return prev.filter((id) => id !== itemId)
			}
		})
	}, [])

	const handleDeleteHistoryItem = useCallback(
		(id: string) => {
			TaskServiceClient.deleteTasksWithIds(StringArrayRequest.create({ value: [id] }))
				.then(() => fetchTotalTasksSize())
				.catch((error) => console.error("Error deleting task:", error))
		},
		[fetchTotalTasksSize],
	)

	const handleDeleteSelectedHistoryItems = useCallback(
		(ids: string[]) => {
			if (ids.length > 0) {
				TaskServiceClient.deleteTasksWithIds(StringArrayRequest.create({ value: ids }))
					.then(() => fetchTotalTasksSize())
					.catch((error) => console.error("Error deleting tasks:", error))
				setSelectedItems([])
			}
		},
		[fetchTotalTasksSize],
	)

	const formatDate = useCallback((timestamp: number) => {
		const date = new Date(timestamp)
		return date
			?.toLocaleString("en-US", {
				month: "long",
				day: "numeric",
				hour: "numeric",
				minute: "2-digit",
				hour12: true,
			})
			.replace(", ", " ")
			.replace(" at", ",")
			.toUpperCase()
	}, [])

	const fuse = useMemo(() => {
		return new Fuse(tasks, {
			keys: ["task"],
			threshold: 0.6,
			shouldSort: true,
			isCaseSensitive: false,
			ignoreLocation: false,
			includeMatches: true,
			minMatchCharLength: 1,
		})
	}, [tasks])

	const taskHistorySearchResults = useMemo(() => {
		const results = searchQuery ? highlight(fuse.search(searchQuery)) : tasks

		results.sort((a, b) => {
			switch (sortOption) {
				case "oldest":
					return a.ts - b.ts
				case "mostExpensive":
					return (b.totalCost || 0) - (a.totalCost || 0)
				case "mostTokens":
					return (
						(b.tokensIn || 0) +
						(b.tokensOut || 0) +
						(b.cacheWrites || 0) +
						(b.cacheReads || 0) -
						((a.tokensIn || 0) + (a.tokensOut || 0) + (a.cacheWrites || 0) + (a.cacheReads || 0))
					)
				case "mostRelevant":
					// NOTE: you must never sort directly on object since it will cause members to be reordered
					return searchQuery ? 0 : b.ts - a.ts // Keep fuse order if searching, otherwise sort by newest
				case "newest":
				default:
					return b.ts - a.ts
			}
		})

		return results
	}, [tasks, searchQuery, fuse, sortOption])

	// Calculate total size of selected items
	const selectedItemsSize = useMemo(() => {
		if (selectedItems.length === 0) {
			return 0
		}

		return taskHistory.filter((item) => selectedItems.includes(item.id)).reduce((total, item) => total + (item.size || 0), 0)
	}, [selectedItems, taskHistory])

	const handleBatchHistorySelect = useCallback(
		(selectAll: boolean) => {
			if (selectAll) {
				setSelectedItems(taskHistorySearchResults.map((item) => item.id))
			} else {
				setSelectedItems([])
			}
		},
		[taskHistorySearchResults],
	)

	return (
		<div
			style={{
				position: "fixed",
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				display: "flex",
				flexDirection: "column",
				overflow: "hidden",
			}}>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					padding: "10px 17px 10px 20px",
				}}>
				<h3
					style={{
						color: "var(--vscode-foreground)",
						margin: 0,
					}}>
					History
				</h3>
				<VSCodeButton onClick={() => onDone()}>Close</VSCodeButton>
			</div>
			<div style={{ padding: "5px 17px 6px 17px" }}>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: "6px",
					}}>
					<VSCodeTextField
						onInput={(e) => {
							const newValue = (e.target as HTMLInputElement)?.value
							setSearchQuery(newValue)
							if (newValue && !searchQuery && sortOption !== "mostRelevant") {
								setLastNonRelevantSort(sortOption)
								setSortOption("mostRelevant")
							}
						}}
						placeholder="Fuzzy search history..."
						style={{ width: "100%" }}
						value={searchQuery}>
						<div
							className="codicon codicon-search"
							slot="start"
							style={{
								fontSize: 13,
								marginTop: 2.5,
								opacity: 0.8,
							}}></div>
						{searchQuery && (
							<div
								aria-label="Clear search"
								className="input-icon-button codicon codicon-close"
								onClick={() => setSearchQuery("")}
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
					<VSCodeRadioGroup
						onChange={(e) => setSortOption((e.target as HTMLInputElement).value as SortOption)}
						style={{ display: "flex", flexWrap: "wrap" }}
						value={sortOption}>
						<VSCodeRadio value="newest">Newest</VSCodeRadio>
						<VSCodeRadio value="oldest">Oldest</VSCodeRadio>
						<VSCodeRadio value="mostExpensive">Most Expensive</VSCodeRadio>
						<VSCodeRadio value="mostTokens">Most Tokens</VSCodeRadio>
						<VSCodeRadio disabled={!searchQuery} style={{ opacity: searchQuery ? 1 : 0.5 }} value="mostRelevant">
							Most Relevant
						</VSCodeRadio>
						<CustomFilterRadio
							checked={showCurrentWorkspaceOnly}
							icon="workspace"
							label="Workspace"
							onChange={() => setShowCurrentWorkspaceOnly(!showCurrentWorkspaceOnly)}
						/>
						<CustomFilterRadio
							checked={showFavoritesOnly}
							icon="star-full"
							label="Favorites"
							onChange={() => setShowFavoritesOnly(!showFavoritesOnly)}
						/>
					</VSCodeRadioGroup>
				</div>
			</div>
			<div style={{ flexGrow: 1, overflowY: "auto", margin: 0 }}>
				<Virtuoso
					data={taskHistorySearchResults}
					itemContent={(_, item) => (
						<div
							className="w-full flex shrink-0 p-1 cursor-pointer border-b border-muted-foreground/10 *:last:border-0 hover:bg-muted/40"
							key={item.id}>
							<div
								onClick={() => handleShowTaskWithId(item.id)}
								style={{
									display: "flex",
									flexDirection: "column",
									gap: "8px",
									padding: "12px 20px",
									paddingLeft: "16px",
									position: "relative",
									flexGrow: 1,
								}}>
								<div
									style={{
										display: "flex",
										justifyContent: "space-between",
										alignItems: "center",
									}}>
									<div className="inline-flex items-center gap-2">
										<VSCodeCheckbox
											checked={selectedItems.includes(item.id)}
											className="text-xs"
											onClick={(e) => {
												const checked = (e.target as HTMLInputElement).checked
												handleHistorySelect(item.id, checked)
												e.stopPropagation()
											}}
										/>
										<span className="text-description text-xs font-medium capitalize">
											{formatDate(item.ts)}
										</span>
										<span className="text-description text-xs">{formatSize(item.size)}</span>
									</div>
									<div className="flex gap-0.5 items-center">
										<VSCodeButton
											appearance="icon"
											aria-label={item.isFavorited ? "Remove from favorites" : "Add to favorites"}
											className="p-0"
											onClick={(e) => {
												e.stopPropagation()
												toggleFavorite(item.id, item.isFavorited || false)
											}}>
											<div
												className={`codicon ${
													pendingFavoriteToggles[item.id] !== undefined
														? pendingFavoriteToggles[item.id]
															? "codicon-star-full"
															: "codicon-star-empty"
														: item.isFavorited
															? "codicon-star-full"
															: "codicon-star-empty"
												}`}
												style={{
													color:
														(pendingFavoriteToggles[item.id] ?? item.isFavorited)
															? "var(--vscode-button-background)"
															: "inherit",
													opacity: (pendingFavoriteToggles[item.id] ?? item.isFavorited) ? 1 : 0.7,
													display:
														(pendingFavoriteToggles[item.id] ?? item.isFavorited)
															? "block"
															: undefined,
												}}
											/>
										</VSCodeButton>

										<VSCodeButton
											appearance="icon"
											aria-label="Delete"
											className="text-description p-0"
											disabled={pendingFavoriteToggles[item.id] ?? item.isFavorited}
											onClick={(e) => {
												e.stopPropagation()
												handleDeleteHistoryItem(item.id)
											}}>
											<span className="codicon codicon-trash"></span>
										</VSCodeButton>

										<VSCodeButton
											appearance="icon"
											aria-label="Export"
											className="text-description"
											onClick={(e) => {
												e.stopPropagation()
												TaskServiceClient.exportTaskWithId(
													StringRequest.create({ value: item.id }),
												).catch((err) => console.error("Failed to export task:", err))
											}}>
											<ArrowDownToLineIcon size={12} />
										</VSCodeButton>
									</div>
								</div>

								<div style={{ marginBottom: "8px", position: "relative" }}>
									<div
										style={{
											fontSize: "var(--vscode-font-size)",
											color: "var(--vscode-foreground)",
											display: "-webkit-box",
											WebkitLineClamp: 3,
											WebkitBoxOrient: "vertical",
											overflow: "hidden",
											whiteSpace: "pre-wrap",
											wordBreak: "break-word",
											overflowWrap: "anywhere",
										}}>
										<span
											className="ph-no-capture"
											dangerouslySetInnerHTML={{
												__html: item.task,
											}}
										/>
									</div>
								</div>

								<div>
									{item.modelId && (
										<div className="flex gap-1 items-center text-xs">
											<BrainIcon size={12} />
											{item.modelId}
										</div>
									)}

									<div className="flex gap-2 text-description flex-wrap text-xs">
										{item.totalCost > 0 && (
											<div className="flex gap-1 items-center text-xs">${item.totalCost?.toFixed(4)}</div>
										)}
										<div className="flex gap-0.5 items-center">
											<span className="font-semibold">Tokens</span>
											<span className="inline-flex items-center">
												<ArrowUpIcon size={12} />
												{formatLargeNumber(item.tokensIn || 0)}
											</span>
											<span className="inline-flex items-center">
												<ArrowDownIcon size={12} />
												{formatLargeNumber(item.tokensOut || 0)}
											</span>
										</div>

										{item.cacheWrites + item.cacheReads > 0 && (
											<div className="flex gap-0.5 items-center">
												<span className="font-semibold">Cache</span>
												{item.cacheWrites > 0 && (
													<span className="inline-flex items-center">
														<ArrowRightIcon size={12} />
														{formatLargeNumber(item.cacheWrites)}
													</span>
												)}
												{item.cacheReads > 0 && (
													<span className="inline-flex items-center">
														<ArrowLeftIcon size={12} />
														{formatLargeNumber(item.cacheReads)}
													</span>
												)}
											</div>
										)}
									</div>
								</div>
							</div>
						</div>
					)}
					style={{
						flexGrow: 1,
						overflowY: "scroll",
					}}
				/>
			</div>
			<div className="flex p-1 gap-2 border-t border-muted-foreground/20">
				<VSCodeButton
					className="flex-1/2"
					onClick={() => handleBatchHistorySelect(selectedItems.length !== taskHistorySearchResults.length)}>
					{selectedItems.length === taskHistorySearchResults.length ? "Deselect All" : "Select All"}
				</VSCodeButton>
				{selectedItems.length > 0 ? (
					<DangerButton
						aria-label="Delete selected items"
						className="flex-1/2"
						onClick={() => {
							handleDeleteSelectedHistoryItems(selectedItems)
						}}>
						Delete {selectedItems.length > 1 ? selectedItems.length : ""} Selected
						{selectedItemsSize > 0 ? ` (${formatSize(selectedItemsSize)})` : ""}
					</DangerButton>
				) : (
					<DangerButton
						aria-label="Delete all history"
						className="flex-1/2"
						disabled={deleteAllDisabled || taskHistory.length === 0}
						onClick={() => {
							setDeleteAllDisabled(true)
							TaskServiceClient.deleteAllTaskHistory(BooleanRequest.create({}))
								.then(() => fetchTotalTasksSize())
								.catch((error) => console.error("Error deleting task history:", error))
								.finally(() => setDeleteAllDisabled(false))
						}}>
						Delete All History{totalTasksSize !== null ? ` (${formatSize(totalTasksSize)})` : ""}
					</DangerButton>
				)}
			</div>
		</div>
	)
}

// https://gist.github.com/evenfrost/1ba123656ded32fb7a0cd4651efd4db0
export const highlight = (fuseSearchResult: FuseResult<any>[], highlightClassName: string = "history-item-highlight") => {
	const set = (obj: Record<string, any>, path: string, value: any) => {
		const pathValue = path.split(".")
		let i: number

		for (i = 0; i < pathValue.length - 1; i++) {
			obj = obj[pathValue[i]] as Record<string, any>
		}

		obj[pathValue[i]] = value
	}

	// Function to merge overlapping regions
	const mergeRegions = (regions: [number, number][]): [number, number][] => {
		if (regions.length === 0) {
			return regions
		}

		// Sort regions by start index
		regions.sort((a, b) => a[0] - b[0])

		const merged: [number, number][] = [regions[0]]

		for (let i = 1; i < regions.length; i++) {
			const last = merged[merged.length - 1]
			const current = regions[i]

			if (current[0] <= last[1] + 1) {
				// Overlapping or adjacent regions
				last[1] = Math.max(last[1], current[1])
			} else {
				merged.push(current)
			}
		}

		return merged
	}

	const generateHighlightedText = (inputText: string, regions: [number, number][] = []) => {
		if (regions.length === 0) {
			return inputText
		}

		// Sort and merge overlapping regions
		const mergedRegions = mergeRegions(regions)

		let content = ""
		let nextUnhighlightedRegionStartingIndex = 0

		mergedRegions.forEach((region) => {
			const start = region[0]
			const end = region[1]
			const lastRegionNextIndex = end + 1

			content += [
				inputText.substring(nextUnhighlightedRegionStartingIndex, start),
				`<span class="${highlightClassName}">`,
				inputText.substring(start, lastRegionNextIndex),
				"</span>",
			].join("")

			nextUnhighlightedRegionStartingIndex = lastRegionNextIndex
		})

		content += inputText.substring(nextUnhighlightedRegionStartingIndex)

		return content
	}

	return fuseSearchResult
		.filter(({ matches }) => matches && matches.length)
		.map(({ item, matches }) => {
			const highlightedItem = { ...item }

			matches?.forEach((match) => {
				if (match.key && typeof match.value === "string" && match.indices) {
					// Merge overlapping regions before generating highlighted text
					const mergedIndices = mergeRegions([...match.indices])
					set(highlightedItem, match.key, generateHighlightedText(match.value, mergedIndices))
				}
			})

			return highlightedItem
		})
}

export default memo(HistoryView)
