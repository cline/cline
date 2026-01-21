import { HistoryItem } from "@shared/HistoryItem"
import { StringRequest } from "@shared/proto/cline/common"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import {
	ArrowDownIcon,
	ArrowLeftIcon,
	ArrowRightIcon,
	ArrowUpIcon,
	ChevronsDownUpIcon,
	ChevronsUpDownIcon,
	DownloadIcon,
	StarIcon,
	TrashIcon,
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

	const isFavoritedItem = useMemo(
		() => pendingFavoriteToggles[item.id] ?? item.isFavorited,
		[item.id, item.isFavorited, pendingFavoriteToggles],
	)

	const handleShowTaskWithId = useCallback((id: string) => {
		TaskServiceClient.showTaskWithId(StringRequest.create({ value: id })).catch((error) =>
			console.error("Error showing task:", error),
		)
	}, [])

	const formatDate = useCallback((timestamp: number) => {
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
		<div className="history-item cursor-pointer flex group mb-1 hover:bg-list-hover border-b border-accent/10" key={item.id}>
			<VSCodeCheckbox
				checked={selectedItems.includes(item.id)}
				className="pl-3 pr-1 py-auto self-start mt-3"
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
					<div className="flex gap-2">
						<Button
							aria-label="Delete"
							className="p-0 opacity-0 group-hover:opacity-100 transition-opacity"
							disabled={isFavoritedItem}
							onClick={(e) => {
								e.stopPropagation()
								handleDeleteHistoryItem(item.id)
							}}
							variant="ghost">
							<span className="flex items-center gap-1 text-xs">
								<TrashIcon className="stroke-1" />
							</span>
						</Button>
						<Button
							aria-label={isFavoritedItem ? "Remove from favorites" : "Add to favorites"}
							className="p-0"
							disabled={pendingFavoriteToggles[item.id] !== undefined}
							onClick={(e) => {
								e.stopPropagation()
								toggleFavorite(item.id, isFavoritedItem)
							}}
							variant="icon">
							<StarIcon
								className={cn("opacity-70", {
									"text-button-background  fill-button-background opacity-100": isFavoritedItem,
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
					<div className="flex items-center justify-between w-full">
						<div className="text-description text-xs uppercase">{formatDate(item.ts)}</div>
						<div className="self-end flex items-center text-xs">
							<span className="text-description">${item.totalCost?.toFixed(4) ?? 0}</span>
							{expanded ? (
								<ChevronsDownUpIcon className="text-description" />
							) : (
								<ChevronsUpDownIcon className="text-description hidden opacity-0 group-hover:opacity-100 transition-opacity group-hover:block" />
							)}
						</div>
					</div>
				</Button>
				{expanded && (
					<Button
						className="m-0 text-xs cursor-pointer p-2 bg-accent/10 w-full rounded-xs"
						onClick={(e) => {
							e.stopPropagation()
							setExpanded(!expanded)
						}}
						variant="text">
						<div className="flex flex-col gap-1 w-full text-xs">
							<div className="flex items-center justify-between w-full">
								<div className="flex items-center gap-1 flex-wrap w-full">
									<div className="flex justify-between items-center w-full gap-1 text-xs">
										<span className="font-medium text-description">Tokens:</span>
										<div className="flex items-center gap-1 text-description text-xs">
											<span className="flex items-center gap-1 text-description">
												<ArrowUpIcon className="text-description !size-1" />
												{formatLargeNumber(item.tokensIn || 0)}
											</span>
											<span className="flex items-center gap-1 text-description">
												<ArrowDownIcon className="text-description !size-1" />
												{formatLargeNumber(item.tokensOut || 0)}
											</span>
											{item.cacheWrites
												? item.cacheWrites > 0 && (
														<span className="flex items-center gap-1 text-description">
															<ArrowRightIcon className="text-description !size-1" />
															{formatLargeNumber(item.cacheWrites)}
														</span>
													)
												: null}
											{item.cacheReads
												? item.cacheReads > 0 && (
														<span className="flex items-center gap-1 text-description">
															<ArrowLeftIcon className="text-description !size-1" />
															{formatLargeNumber(item.cacheReads)}
														</span>
													)
												: null}
										</div>
									</div>

									{item.modelId && (
										<div className="flex justify-between items-center w-full gap-1 text-xs">
											<span className="font-medium text-description">Model:</span>
											<span className="text-description">{item.modelId}</span>
										</div>
									)}

									<div className="flex justify-between items-center w-full gap-1 text-xs">
										<span className="font-medium text-description">Size:</span>
										<span className="items-center gap-2 flex text-description">
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
												variant="ghost">
												<DownloadIcon />
											</Button>
										</span>
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
