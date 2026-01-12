import { HistoryItem } from "@shared/HistoryItem"
import { StringRequest } from "@shared/proto/cline/common"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { ChevronUpIcon, DownloadIcon, StarIcon, Trash2Icon } from "lucide-react"
import { memo, useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { TaskServiceClient } from "@/services/grpc-client"
import { formatLargeNumber, formatSize } from "@/utils/format"

type HistoryViewItemProps = {
	item: HistoryItem
	index: number
	selectedItems: string[]
	pendingFavoriteToggles: Record<string, boolean>
	handleDeleteHistoryItem: (id: string) => void
	toggleFavorite: (id: string, isCurrentlyFavorited: boolean) => void
	handleHistorySelect: (itemId: string, checked: boolean) => void
}

const HistoryViewItem = ({
	item,
	pendingFavoriteToggles,
	handleDeleteHistoryItem,
	toggleFavorite,
	handleHistorySelect,
	selectedItems,
}: HistoryViewItemProps) => {
	const [expanded, setExpanded] = useState(false)

	const handleShowTaskWithId = useCallback((id: string) => {
		TaskServiceClient.showTaskWithId(StringRequest.create({ value: id })).catch((error) =>
			console.error("Error showing task:", error),
		)
	}, [])

	const formatDate = useCallback((timestamp: number) => {
		const date = new Date(timestamp)
		const today = new Date()
		const isToday =
			date.getDate() === today.getDate() &&
			date.getMonth() === today.getMonth() &&
			date.getFullYear() === today.getFullYear()

		if (isToday) {
			return date
				.toLocaleString("en-US", {
					hour: "numeric",
					minute: "2-digit",
					hour12: true,
				})
				.toUpperCase()
		}

		return date
			.toLocaleString("en-US", {
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

	return (
		<div className="history-item cursor-pointer flex" key={item.id}>
			<VSCodeCheckbox
				checked={selectedItems.includes(item.id)}
				className="pl-3 pr-1 py-auto"
				onClick={(e) => {
					e.preventDefault()
					e.stopPropagation()
					const checked = (e.target as HTMLInputElement).checked
					handleHistorySelect(item.id, checked)
				}}
			/>

			<div
				className="flex flex-col gap-2 py-2 pl-2 pr-3 relative flex-grow w-full"
				onClick={(e) => {
					e.stopPropagation()
					handleShowTaskWithId(item.id)
				}}>
				<div className="flex justify-between items-center">
					<div className="line-clamp-1 overflow-hidden break-words whitespace-pre-wrap">
						<span className="ph-no-capture">{item.task}</span>
					</div>
					{/* Delete Button */}
					<div className="flex gap-1">
						<Button
							aria-label="Delete"
							className="delete-button p-0 hidden"
							disabled={pendingFavoriteToggles[item.id] !== undefined}
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
						{/* Favorite Button */}
						<Button
							aria-label={item.isFavorited ? "Remove from favorites" : "Add to favorites"}
							className="p-0"
							disabled={pendingFavoriteToggles[item.id] !== undefined}
							onClick={(e) => {
								e.stopPropagation()
								toggleFavorite(item.id, item.isFavorited || false)
							}}
							variant="icon">
							<StarIcon
								className={cn("opacity-70", {
									"text-button-background  fill-button-background opacity-100":
										pendingFavoriteToggles[item.id] ?? item.isFavorited,
								})}
							/>
						</Button>
					</div>
				</div>

				<Button
					className="p-0"
					onClick={(e) => {
						e.stopPropagation()
						setExpanded(!expanded)
					}}
					variant="icon">
					<div className="mb-2 flex items-center justify-between w-full">
						{expanded ? <ChevronUpIcon className="text-description" /> : <div></div>}
						<div className="text-description text-sm uppercase">{formatDate(item.ts)}</div>
					</div>
				</Button>
				{expanded && (
					<Button
						className="p-0 text-sm"
						onClick={(e) => {
							e.stopPropagation()
							setExpanded(!expanded)
						}}
						variant="text">
						<div className="flex flex-col gap-1 w-full">
							<div className="flex items-center justify-between w-full">
								<div className="flex items-center gap-1 flex-wrap w-full">
									<div className="flex justify-between items-center w-full gap-1">
										<div className="font-medium text-description">Cost:</div>
										<div className="text-description">${item.totalCost?.toFixed(4) ?? 0}</div>
									</div>

									<div className="flex justify-between items-center w-full gap-1">
										<div className="font-medium text-description">Tokens:</div>
										<div className="flex items-center gap-1">
											<span className="flex items-center gap-1 text-description">
												<i
													className="codicon codicon-arrow-up font-bold -mb-0.5"
													style={{
														fontSize: "12px",
													}}
												/>
												{formatLargeNumber(item.tokensIn || 0)}
											</span>
											<span className="text-description">
												<i
													className="codicon codicon-arrow-down font-bold -mb-0.5"
													style={{
														fontSize: "12px",
													}}
												/>
												{formatLargeNumber(item.tokensOut || 0)}
											</span>
											{item.cacheWrites
												? item.cacheWrites > 0 && (
														<span className="text-description">
															<i
																className="codicon codicon-arrow-right font-bold -mb-[1px]"
																style={{
																	fontSize: "12px",
																}}
															/>
															{formatLargeNumber(item.cacheWrites)}
														</span>
													)
												: null}
											{item.cacheReads
												? item.cacheReads > 0 && (
														<span className="text-description">
															<i
																className="codicon codicon-arrow-left font-bold mb-0"
																style={{
																	fontSize: "12px",
																}}
															/>
															{formatLargeNumber(item.cacheReads)}
														</span>
													)
												: null}
										</div>
									</div>

									{item.modelId && (
										<div className="flex justify-between items-center w-full gap-1">
											<div className="font-medium text-description">Model:</div>
											<div className="text-description">{item.modelId}</div>
										</div>
									)}

									<div className="flex justify-between items-center w-full gap-1">
										<div className="font-medium text-description">Size:</div>
										<div className="items-center gap-2 flex text-description">
											{formatSize(item.size)}
											<Button
												aria-label="Export"
												className="m-0 p-0"
												onClick={(e) => {
													e.stopPropagation()
													TaskServiceClient.exportTaskWithId(
														StringRequest.create({ value: item.id }),
													).catch((err) => console.error("Failed to export task:", err))
												}}
												variant="icon">
												<DownloadIcon />
											</Button>
											<Button
												aria-label="Delete"
												className="p-0"
												disabled={pendingFavoriteToggles[item.id] !== undefined}
												onClick={(e) => {
													e.stopPropagation()
													handleDeleteHistoryItem(item.id)
												}}
												variant="icon">
												<div className="flex items-center gap-1 text-xs">
													<Trash2Icon />
												</div>
											</Button>
										</div>
									</div>
								</div>
							</div>
						</div>
					</Button>
				)}
			</div>
		</div>
	)
}

export default memo(HistoryViewItem)
