import { HistoryItem } from "@shared/HistoryItem"
import { StringRequest } from "@shared/proto/cline/common"
import { UpdateTaskNameRequest } from "@shared/proto/cline/task"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import {
	ArrowDownIcon,
	ArrowLeftIcon,
	ArrowRightIcon,
	ArrowUpIcon,
	CheckIcon,
	ChevronRightIcon,
	CopyIcon,
	DownloadIcon,
	Pin,
	StarIcon,
} from "lucide-react"
import { memo, useCallback, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { TaskServiceClient } from "@/services/grpc-client"
import { formatLargeNumber, formatSize } from "@/utils/format"

type HistoryViewItemProps = {
	item: HistoryItem
	index: number
	selectedItems: string[]
	pendingFavoriteToggles: Record<string, boolean>
	pendingPinToggles: Record<string, boolean>
	handleDeleteHistoryItem: (id: string) => void
	toggleFavorite: (id: string, isCurrentlyFavorited: boolean) => void
	togglePin: (id: string, isCurrentlyPinned: boolean) => void
	handleHistorySelect: (itemId: string, checked: boolean) => void
	onTaskUpdated: () => void
}

const HistoryViewItem = ({
	item,
	pendingFavoriteToggles,
	pendingPinToggles,
	handleDeleteHistoryItem,
	toggleFavorite,
	togglePin,
	handleHistorySelect,
	selectedItems,
	onTaskUpdated,
}: HistoryViewItemProps) => {
	const [expanded, setExpanded] = useState(false)
	const [isEditingName, setIsEditingName] = useState(false)
	const [editNameValue, setEditNameValue] = useState(item.customName || "")
	const [copied, setCopied] = useState(false)
	const [showColorPicker, setShowColorPicker] = useState(false)

	const presetColors = [
		{ name: "Yellow", value: "#f0c674" },
		{ name: "Blue", value: "#81a2be" },
		{ name: "Green", value: "#b5bd68" },
		{ name: "Orange", value: "#de935f" },
		{ name: "Purple", value: "#b294bb" },
		{ name: "Red", value: "#cc6666" },
	]

	// Debug logging to see what color the item actually has
	console.log(`[HistoryViewItem] Rendering item ${item.id}:`, {
		customName: item.customName,
		customNameColor: item.customNameColor,
	})

	const isFavoritedItem = useMemo(
		() => pendingFavoriteToggles[item.id] ?? item.isFavorited,
		[item.id, item.isFavorited, pendingFavoriteToggles],
	)

	const isPinnedItem = useMemo(() => pendingPinToggles[item.id] ?? item.isPinned, [item.id, item.isPinned, pendingPinToggles])

	const handleSaveCustomName = useCallback(
		async (colorOverride?: string) => {
			const trimmedValue = editNameValue.trim()
			if (trimmedValue === item.customName || (trimmedValue === "" && !item.customName)) {
				setIsEditingName(false)
				setShowColorPicker(false)
				return
			}

			try {
				await TaskServiceClient.updateTaskName(
					UpdateTaskNameRequest.create({
						taskId: item.id,
						customName: trimmedValue,
						customNameColor: colorOverride !== undefined ? colorOverride : item.customNameColor,
					}),
				)
				setIsEditingName(false)
				setShowColorPicker(false)
				// Reload the history view to show the updated name
				onTaskUpdated()
			} catch (error) {
				console.error("Error updating task name:", error)
			}
		},
		[editNameValue, item.id, item.customName, item.customNameColor, onTaskUpdated],
	)

	const handleColorSelect = useCallback(
		async (color: string) => {
			try {
				// Get the current name being edited, or use the existing custom name
				const nameToSave = editNameValue.trim() || item.customName || ""

				console.log(`[HistoryViewItem] Sending color update:`, {
					taskId: item.id,
					customName: nameToSave,
					customNameColor: color,
					currentItemColor: item.customNameColor,
				})

				await TaskServiceClient.updateTaskName(
					UpdateTaskNameRequest.create({
						taskId: item.id,
						customName: nameToSave,
						customNameColor: color,
					}),
				)

				console.log(`[HistoryViewItem] Color update sent successfully`)
				// Reload the history view to show the updated color
				onTaskUpdated()
				// Don't close the picker - let user continue editing
			} catch (error) {
				console.error("Error updating task color:", error)
			}
		},
		[item.id, item.customName, editNameValue, onTaskUpdated],
	)

	const handleCancelEdit = useCallback(() => {
		setEditNameValue(item.customName || "")
		setIsEditingName(false)
	}, [item.customName])

	const handleCopyTask = useCallback(() => {
		navigator.clipboard.writeText(item.task).then(() => {
			setCopied(true)
			setTimeout(() => setCopied(false), 1500)
		})
	}, [item.task])

	const handleShowTaskWithId = useCallback((id: string) => {
		TaskServiceClient.showTaskWithId(StringRequest.create({ value: id })).catch((error) =>
			console.error("Error showing task:", error),
		)
	}, [])

	const formatDateShort = useCallback((timestamp: number) => {
		const date = new Date(timestamp)
		return {
			date: date.toLocaleString("en-US", {
				month: "short",
				day: "numeric",
			}),
			time: date.toLocaleString("en-US", {
				hour: "numeric",
				minute: "2-digit",
				hour12: true,
			}),
		}
	}, [])

	const formatDateLong = useCallback((timestamp: number) => {
		const date = new Date(timestamp)
		const today = new Date()
		const isToday = today.toDateString() === date.toDateString()

		return date
			.toLocaleString(
				"en-US",
				isToday
					? {
							hour: "numeric",
							minute: "2-digit",
							hour12: true,
						}
					: {
							month: "long",
							day: "numeric",
							hour: "numeric",
							minute: "2-digit",
							hour12: true,
						},
			)
			.replace(", ", " ")
			.replace(" at", ",")
	}, [])

	return (
		<div
			className="group mb-2 rounded mx-3"
			key={item.id}
			onMouseEnter={(e) => {
				e.currentTarget.style.backgroundColor =
					"color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 100%, transparent)"
			}}
			onMouseLeave={(e) => {
				e.currentTarget.style.backgroundColor =
					"color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 65%, transparent)"
			}}
			style={{
				backgroundColor: "color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 65%, transparent)",
				transition: "background-color 0.2s",
			}}>
			{/* Header bar with icons */}
			<div
				className="flex items-center justify-between gap-2 px-3 pt-0 pb-0 rounded-t"
				style={{
					backgroundColor: "#212121",
				}}>
				{/* Left side: Custom name field */}
				<div className="flex-1 min-w-0 py-1">
					{isEditingName ? (
						<div className="relative">
							<input
								autoFocus
								className="w-full bg-transparent border-none outline-none text-[10px] text-[var(--vscode-input-foreground)] px-1"
								maxLength={75}
								onBlur={() => {
									// Save on blur (clicking outside, tabbing away, etc.)
									handleSaveCustomName()
									setShowColorPicker(false)
								}}
								onChange={(e) => setEditNameValue(e.target.value)}
								onClick={(e) => e.stopPropagation()}
								onFocus={() => setShowColorPicker(true)}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										handleSaveCustomName()
										setShowColorPicker(false)
									} else if (e.key === "Escape") {
										handleCancelEdit()
										setShowColorPicker(false)
									}
									e.stopPropagation()
								}}
								placeholder="Click to name..."
								style={{
									backgroundColor: "var(--vscode-input-background)",
									borderBottom: "1px solid var(--vscode-input-border)",
								}}
								type="text"
								value={editNameValue}
							/>
							{showColorPicker && (
								<div
									className="absolute top-full left-0 mt-1 p-2 rounded shadow-lg z-50"
									onClick={(e) => e.stopPropagation()}
									onMouseDown={(e) => e.preventDefault()}
									style={{
										backgroundColor: "var(--vscode-dropdown-background)",
										border: "1px solid var(--vscode-dropdown-border)",
									}}>
									<div className="flex gap-1">
										{presetColors.map((color) => (
											<button
												aria-label={`${color.name} color`}
												className="w-6 h-6 rounded cursor-pointer border-2 hover:scale-110 transition-transform"
												key={color.value}
												onClick={() => handleColorSelect(color.value)}
												style={{
													backgroundColor: color.value,
													borderColor:
														item.customNameColor === color.value
															? "var(--vscode-focusBorder)"
															: "transparent",
												}}
												type="button"
											/>
										))}
									</div>
								</div>
							)}
						</div>
					) : (
						<button
							className="w-full text-left text-[10px] px-1 py-0.5 rounded hover:bg-[var(--vscode-input-background)] transition-colors truncate"
							onClick={(e) => {
								e.stopPropagation()
								setIsEditingName(true)
								setEditNameValue(item.customName || "")
								setShowColorPicker(true)
							}}
							style={{
								color: item.customName
									? item.customNameColor || "#f0c674"
									: "var(--vscode-descriptionForeground)",
								fontStyle: item.customName ? "normal" : "italic",
								opacity: item.customName ? 1 : 0.7,
							}}
							type="button">
							{item.customName || "Click to name..."}
						</button>
					)}
				</div>
				<Button
					aria-label={isPinnedItem ? "Unpin task" : "Pin task"}
					className={cn("p-0 transition-opacity", {
						"opacity-0 group-hover:opacity-100": !isPinnedItem,
					})}
					disabled={pendingPinToggles[item.id] !== undefined}
					onClick={(e) => {
						e.stopPropagation()
						togglePin(item.id, isPinnedItem)
					}}
					variant="icon">
					<Pin
						className={cn("opacity-70", {
							"text-button-background fill-button-background opacity-100": isPinnedItem,
						})}
						size={16}
						style={{ transform: "rotate(45deg) scale(0.7)" }}
					/>
				</Button>
				<Button
					aria-label={isFavoritedItem ? "Remove from favorites" : "Add to favorites"}
					className={cn("p-0 transition-opacity", {
						"opacity-0 group-hover:opacity-100": !isFavoritedItem && !isPinnedItem,
					})}
					disabled={pendingFavoriteToggles[item.id] !== undefined}
					onClick={(e) => {
						e.stopPropagation()
						toggleFavorite(item.id, isFavoritedItem)
					}}
					variant="icon">
					<StarIcon
						className={cn("opacity-70", {
							"text-button-background fill-button-background opacity-100": isFavoritedItem,
						})}
						size={16}
						style={{ transform: "scale(0.7)" }}
					/>
				</Button>
				<Button
					aria-label="Copy task text"
					className="p-0"
					onClick={(e) => {
						e.stopPropagation()
						handleCopyTask()
					}}
					variant="icon">
					{copied ? (
						<CheckIcon className="opacity-70" size={16} style={{ transform: "scale(0.7)" }} />
					) : (
						<CopyIcon className="opacity-70" size={16} style={{ transform: "scale(0.7)" }} />
					)}
				</Button>
				<VSCodeCheckbox
					checked={selectedItems.includes(item.id)}
					onClick={(e) => {
						e.preventDefault()
						e.stopPropagation()
						const checked = (e.target as HTMLInputElement).checked
						handleHistorySelect(item.id, checked)
					}}
					style={{ transform: "scale(0.7)" }}
				/>
			</div>

			{/* Main content */}
			<div
				className="cursor-pointer px-3 pb-1 pt-2"
				onClick={(e) => {
					e.stopPropagation()
					handleShowTaskWithId(item.id)
				}}>
				<div className="flex justify-between gap-3 min-h-[60px]">
					{/* Left side: Task title and details link */}
					<div className="flex flex-col justify-between flex-1 min-w-0">
						<div className="text-sm font-normal mb-1 line-clamp-2 break-words" style={{ lineHeight: "1.2" }}>
							<span className="ph-no-capture">{item.task}</span>
						</div>
						<button
							className="text-[10px] text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] flex items-center gap-1 p-0 bg-transparent border-none cursor-pointer self-start mb-1"
							onClick={(e) => {
								e.stopPropagation()
								setExpanded(!expanded)
							}}
							type="button">
							Task Details
							<ChevronRightIcon
								className="transition-transform"
								size={10}
								style={{
									transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
								}}
							/>
						</button>
					</div>

					{/* Right side: Cost and date */}
					<div className="flex flex-col items-center gap-2 flex-shrink-0">
						{/* Cost badge */}
						{item.totalCost != null && (
							<div
								className="px-3 py-1 rounded-full text-xs font-medium"
								style={{
									backgroundColor: "var(--vscode-badge-background)",
									color: "var(--vscode-badge-foreground)",
								}}>
								${item.totalCost.toFixed(2)}
							</div>
						)}

						{/* Date */}
						<div className="text-xs text-[var(--vscode-descriptionForeground)] mt-[2px]">
							{formatDateShort(item.ts).date}
						</div>
					</div>
				</div>
			</div>

			{/* Expanded details */}
			{expanded && (
				<div className="px-3 pb-3">
					<div
						className="p-3 rounded text-[10px]"
						style={{
							backgroundColor: "#212121",
						}}>
						<div className="flex flex-col gap-1 text-[10px]">
							<div className="flex justify-between items-center text-[10px]">
								<span className="font-medium text-[var(--vscode-descriptionForeground)] text-[10px]">Date:</span>
								<span className="text-[var(--vscode-descriptionForeground)] text-[10px]">
									{formatDateLong(item.ts)}
								</span>
							</div>

							<div className="flex justify-between items-center text-[10px]">
								<span className="font-medium text-[var(--vscode-descriptionForeground)] text-[10px]">
									Tokens:
								</span>
								<div className="flex items-center gap-2 text-[var(--vscode-descriptionForeground)] text-[10px]">
									<span className="flex items-center gap-1">
										<ArrowUpIcon size={12} />
										{formatLargeNumber(item.tokensIn || 0)}
									</span>
									<span className="flex items-center gap-1">
										<ArrowDownIcon size={12} />
										{formatLargeNumber(item.tokensOut || 0)}
									</span>
									{item.cacheWrites && item.cacheWrites > 0 && (
										<span className="flex items-center gap-1">
											<ArrowRightIcon size={12} />
											{formatLargeNumber(item.cacheWrites)}
										</span>
									)}
									{item.cacheReads && item.cacheReads > 0 && (
										<span className="flex items-center gap-1">
											<ArrowLeftIcon size={12} />
											{formatLargeNumber(item.cacheReads)}
										</span>
									)}
								</div>
							</div>

							{item.modelId && (
								<div className="flex justify-between items-center text-[10px]">
									<span className="font-medium text-[var(--vscode-descriptionForeground)] text-[10px]">
										Model:
									</span>
									<span className="text-[var(--vscode-descriptionForeground)] text-[10px]">{item.modelId}</span>
								</div>
							)}

							<div className="flex justify-between items-center text-[10px]">
								<span className="font-medium text-[var(--vscode-descriptionForeground)] text-[10px]">Size:</span>
								<span className="flex items-center gap-2 text-[var(--vscode-descriptionForeground)] text-[10px]">
									{formatSize(item.size)}
									<Button
										aria-label="Export"
										className="m-0 p-0"
										onClick={(e) => {
											e.stopPropagation()
											TaskServiceClient.exportTaskWithId(StringRequest.create({ value: item.id })).catch(
												(err) => console.error("Failed to export task:", err),
											)
										}}
										variant="ghost">
										<DownloadIcon size={14} />
									</Button>
								</span>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}

export default memo(HistoryViewItem)
