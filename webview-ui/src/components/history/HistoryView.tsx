import { BooleanRequest, EmptyRequest, StringArrayRequest, StringRequest } from "@shared/proto/cline/common"
import { GetTaskHistoryRequest, TaskFavoriteRequest } from "@shared/proto/cline/task"
import { VSCodeCheckbox, VSCodeRadio, VSCodeRadioGroup, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import Fuse, { FuseResult } from "fuse.js"
import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { Virtuoso } from "react-virtuoso"
import { Button } from "@/components/ui/button"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { TaskServiceClient } from "@/services/grpc-client"
import { getEnvironmentColor } from "@/utils/environmentColors"
import { formatLargeNumber, formatSize } from "@/utils/format"

type HistoryViewProps = {
	onDone: () => void
}

type SortOption = "newest" | "oldest" | "mostExpensive" | "mostTokens" | "mostRelevant"

const HistoryView = ({ onDone }: HistoryViewProps) => {
	const extensionStateContext = useExtensionState()
	const { taskHistory, onRelinquishControl, environment } = extensionStateContext
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
		<>
			<style>
				{`
					.history-item:hover {
						background-color: var(--vscode-list-hoverBackground);
					}
					.delete-button, .export-button {
						opacity: 0;
						pointer-events: none;
					}
					.history-item:hover .delete-button,
					.history-item:hover .export-button {
						opacity: 1;
						pointer-events: auto;
					}
					.history-item-highlight {
						background-color: var(--vscode-editor-findMatchHighlightBackground);
						color: inherit;
					}
				`}
			</style>
			<div className="fixed overflow-hidden inset-0 flex flex-col">
				<div className="flex justify-between items-center py-2.5 px-5">
					<h3
						className="m-0"
						style={{
							color: getEnvironmentColor(environment),
						}}>
						History
					</h3>
					<Button onClick={() => onDone()}>Done</Button>
				</div>
				<div className="py-1.5 px-4">
					<div className="flex flex-col gap-3">
						<VSCodeTextField
							className="w-full"
							onInput={(e) => {
								const newValue = (e.target as HTMLInputElement)?.value
								setSearchQuery(newValue)
								if (newValue && !searchQuery && sortOption !== "mostRelevant") {
									setLastNonRelevantSort(sortOption)
									setSortOption("mostRelevant")
								}
							}}
							placeholder="Fuzzy search history..."
							value={searchQuery}>
							<div
								className="codicon codicon-search"
								slot="start"
								style={{
									fontSize: 13,
									marginTop: 2.5,
									opacity: 0.8,
								}}
							/>
							{searchQuery && (
								<div
									aria-label="Clear search"
									className="input-icon-button codicon codicon-close flex justify-center items-center h-full"
									onClick={() => setSearchQuery("")}
									slot="end"
								/>
							)}
						</VSCodeTextField>
						<VSCodeRadioGroup
							className="flex flex-wrap"
							onChange={(e) => setSortOption((e.target as HTMLInputElement).value as SortOption)}
							value={sortOption}>
							<VSCodeRadio value="newest">Newest</VSCodeRadio>
							<VSCodeRadio value="oldest">Oldest</VSCodeRadio>
							<VSCodeRadio value="mostExpensive">Most Expensive</VSCodeRadio>
							<VSCodeRadio value="mostTokens">Most Tokens</VSCodeRadio>
							<VSCodeRadio disabled={!searchQuery} style={{ opacity: searchQuery ? 1 : 0.5 }} value="mostRelevant">
								Most Relevant
							</VSCodeRadio>
						</VSCodeRadioGroup>
						<div className="flex flex-wrap -mt-2">
							<VSCodeRadio
								checked={showCurrentWorkspaceOnly}
								onClick={() => setShowCurrentWorkspaceOnly(!showCurrentWorkspaceOnly)}>
								<span className="flex items-center gap-[3px]">
									<span className="codicon codicon-folder text-button-background" />
									Workspace
								</span>
							</VSCodeRadio>
							<VSCodeRadio checked={showFavoritesOnly} onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}>
								<span className="flex items-center gap-[3px]">
									<span className="codicon codicon-star-full text-button-background" />
									Favorites
								</span>
							</VSCodeRadio>
						</div>
					</div>
				</div>
				<div className="flex-grow overflow-y-auto m-0">
					<Virtuoso
						className="flex-grow overflow-y-scroll"
						data={taskHistorySearchResults}
						itemContent={(index, item) => (
							<div
								className="history-item"
								key={item.id}
								style={{
									cursor: "pointer",
									borderBottom:
										index < taskHistory.length - 1 ? "1px solid var(--vscode-panel-border)" : "none",
									display: "flex",
								}}>
								<VSCodeCheckbox
									checked={selectedItems.includes(item.id)}
									className="pl-3 pr-1 py-auto"
									onClick={(e) => {
										const checked = (e.target as HTMLInputElement).checked
										handleHistorySelect(item.id, checked)
										e.stopPropagation()
									}}
								/>
								<div
									className="flex flex-col gap-2 py-3 px-5 pl-4 relative flex-grow"
									onClick={() => handleShowTaskWithId(item.id)}>
									<div className="flex justify-between items-center">
										<span
											style={{
												color: "var(--vscode-descriptionForeground)",
												fontWeight: 500,
												fontSize: "0.85em",
												textTransform: "uppercase",
											}}>
											{formatDate(item.ts)}
										</span>
										<div className="flex gap-1">
											{/* only show delete button if task not favorited */}
											{!(pendingFavoriteToggles[item.id] ?? item.isFavorited) && (
												<Button
													aria-label="Delete"
													className="delete-button p-0"
													onClick={(e) => {
														e.stopPropagation()
														handleDeleteHistoryItem(item.id)
													}}
													variant="icon">
													<div className="flex items-center gap-1 text-xs">
														<span className="codicon codicon-trash"></span>
														{formatSize(item.size)}
													</div>
												</Button>
											)}
											<Button
												aria-label={item.isFavorited ? "Remove from favorites" : "Add to favorites"}
												className="p-0"
												onClick={(e) => {
													e.stopPropagation()
													toggleFavorite(item.id, item.isFavorited || false)
												}}
												variant="icon">
												<div
													className={cn(
														`opacity-70 codicon ${
															pendingFavoriteToggles[item.id] !== undefined
																? pendingFavoriteToggles[item.id]
																	? "codicon-star-full"
																	: "codicon-star-empty"
																: item.isFavorited
																	? "codicon-star-full"
																	: "codicon-star-empty"
														}`,
														{
															"text-button-background opacity-100 block":
																pendingFavoriteToggles[item.id] ?? item.isFavorited,
														},
													)}
												/>
											</Button>
										</div>
									</div>

									<div className="mb-2 relative">
										<div className="line-clamp-3 overflow-hidden break-words whitespace-pre-wrap">
											<span
												className="ph-no-capture"
												dangerouslySetInnerHTML={{
													__html: item.task,
												}}
											/>
										</div>
									</div>
									<div className="flex flex-col gap-1">
										<div className="flex items-center justify-between">
											<div className="flex items-center gap-1 flex-wrap">
												<span className="font-medium text-description">Tokens:</span>
												<span className="flex items-center gap-1 text-description">
													<i
														className="codicon codicon-arrow-up font-bold -mb-0.5"
														style={{
															fontSize: "12px",
														}}
													/>
													{formatLargeNumber(item.tokensIn || 0)}
												</span>
												<span className="flex items-center gap-1 text-description">
													<i
														className="codicon codicon-arrow-down font-bold -mb-0.5"
														style={{
															fontSize: "12px",
														}}
													/>
													{formatLargeNumber(item.tokensOut || 0)}
												</span>
											</div>
											{!item.totalCost && <ExportButton itemId={item.id} />}
										</div>

										{!!(item.cacheWrites || item.cacheReads) && (
											<div className="flex items-center gap-1 flex-wrap">
												<span className="font-medium text-description">Cache:</span>
												{item.cacheWrites > 0 && (
													<span className="flex items-center gap-1 text-description">
														<i
															className="codicon codicon-arrow-right font-bold -mb-[1px]"
															style={{
																fontSize: "12px",
															}}
														/>
														{formatLargeNumber(item.cacheWrites)}
													</span>
												)}
												{item.cacheReads > 0 && (
													<span className="flex items-center gap-1 text-description">
														<i
															className="codicon codicon-arrow-left font-bold mb-0"
															style={{
																fontSize: "12px",
															}}
														/>
														{formatLargeNumber(item.cacheReads)}
													</span>
												)}
											</div>
										)}
										{item.modelId && <div className="text-description">Model: {item.modelId}</div>}
										{!!item.totalCost && (
											<div className="flex justify-between items-center -mt-0.5">
												<div className="flex items-center gap-1">
													<span className="font-medium text-description">API Cost:</span>
													<span className="text-description">${item.totalCost?.toFixed(4)}</span>
												</div>
												<ExportButton itemId={item.id} />
											</div>
										)}
									</div>
								</div>
							</div>
						)}
					/>
				</div>
				<div className="p-2.5 border-t border-t-border-panel">
					<div className="flex gap-2.5 mb-2.5">
						<Button className="flex-1" onClick={() => handleBatchHistorySelect(true)} variant="secondary">
							Select All
						</Button>
						<Button className="flex-1" onClick={() => handleBatchHistorySelect(false)} variant="secondary">
							Select None
						</Button>
					</div>
					{selectedItems.length > 0 ? (
						<Button
							aria-label="Delete selected items"
							className="w-full"
							onClick={() => {
								handleDeleteSelectedHistoryItems(selectedItems)
							}}
							variant="danger">
							Delete {selectedItems.length > 1 ? selectedItems.length : ""} Selected
							{selectedItemsSize > 0 ? ` (${formatSize(selectedItemsSize)})` : ""}
						</Button>
					) : (
						<Button
							aria-label="Delete all history"
							className="w-full"
							disabled={deleteAllDisabled || taskHistory.length === 0}
							onClick={() => {
								setDeleteAllDisabled(true)
								TaskServiceClient.deleteAllTaskHistory(BooleanRequest.create({}))
									.then(() => fetchTotalTasksSize())
									.catch((error) => console.error("Error deleting task history:", error))
									.finally(() => setDeleteAllDisabled(false))
							}}
							variant="danger">
							Delete All History{totalTasksSize !== null ? ` (${formatSize(totalTasksSize)})` : ""}
						</Button>
					)}
				</div>
			</div>
		</>
	)
}

const ExportButton = ({ itemId }: { itemId: string }) => (
	<Button
		aria-label="Export"
		className="export-button"
		onClick={(e) => {
			e.stopPropagation()
			TaskServiceClient.exportTaskWithId(StringRequest.create({ value: itemId })).catch((err) =>
				console.error("Failed to export task:", err),
			)
		}}
		variant="icon">
		<span className="opacity-100 text-sm font-medium">EXPORT</span>
	</Button>
)

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
