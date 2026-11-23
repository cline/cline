import { StringRequest } from "@shared/proto/cline/common"
import { ArrowRightIcon, ClockIcon, StarIcon } from "lucide-react"
import { memo, useMemo } from "react"
import { CloudStatusPill } from "@/components/cloud/CloudStatusPill"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useResolvedCloudStatuses } from "@/hooks/useResolvedCloudStatuses"
import { useUsageCostVisibility } from "@/hooks/useUsageCostVisibility"
import { TaskServiceClient } from "@/services/grpc-client"

type HistoryPreviewProps = {
	showHistoryView: () => void
}

const HistoryPreview = ({ showHistoryView }: HistoryPreviewProps) => {
	const { taskHistory } = useExtensionState()
	const previewItems = useMemo(() => taskHistory.filter((item) => item.ts && item.task).slice(0, 4), [taskHistory])
	const resolvedCloudStatuses = useResolvedCloudStatuses(previewItems)
	const isCostVisible = useUsageCostVisibility()
	const handleHistorySelect = (id: string) => {
		TaskServiceClient.showTaskWithId(StringRequest.create({ value: id })).catch((error) =>
			console.error("Error showing task:", error),
		)
	}

	const formatDate = (timestamp: number) => {
		const date = new Date(timestamp)
		return date?.toLocaleString("en-US", {
			month: "short",
			day: "numeric",
		})
	}

	return (
		<div className="shrink-0 w-full mt-2">
			<div className="flex items-center justify-between mb-2.5 px-0.5 select-none">
				<div className="flex items-center gap-1.5 text-[#70767f]">
					<ClockIcon size={12} strokeWidth={1.8} />
					<span className="text-[11px] font-medium uppercase tracking-[0.09em]">Recent Sessions</span>
				</div>
				{taskHistory.filter((item) => item.ts && item.task).length > 0 && (
					<button
						aria-label="View all history"
						className="inline-flex items-center gap-1 bg-transparent border-0 p-1 cursor-pointer text-[11.5px] font-medium text-[#7c828b] hover:text-[#eceef0] transition-colors"
						onClick={() => showHistoryView()}
						type="button">
						View All
						<ArrowRightIcon size={12} strokeWidth={1.8} />
					</button>
				)}
			</div>

			<div className="flex flex-col gap-2">
				{previewItems.length > 0 ? (
					previewItems.map((item) => (
						<div
							className="group relative flex items-start justify-between gap-4 px-4 py-3 rounded-xl bg-[#151618] hover:bg-[#1b1d20] border border-white/[0.06] hover:border-white/[0.12] cursor-pointer transition-all duration-150"
							key={item.id}
							onClick={() => handleHistorySelect(item.id)}>
							<div className="flex-1 flex items-start gap-2.5 min-w-0">
								{item.isFavorited && (
									<StarIcon
										aria-label="Favorited"
										className="shrink-0 mt-0.5 text-[#c8cdd4] fill-[#c8cdd4]"
										size={13}
									/>
								)}
								<div className="flex-1 text-[13.5px] leading-[1.5] text-[#d6d9dd] group-hover:text-[#f2f4f7] line-clamp-2 overflow-hidden ph-no-capture transition-colors">
									{item.task}
								</div>
								{item.isLegacy && (
									<span className="shrink-0 px-2 py-0.5 rounded-md bg-white/[0.05] text-[#8f959e] font-geist-mono text-[10.5px]">
										Legacy
									</span>
								)}
								{item.executionTarget === "cloud" && (
									<CloudStatusPill status={resolvedCloudStatuses.get(item.id) ?? item.cloudStatus} />
								)}
							</div>
							<div className="flex flex-col items-end gap-1 shrink-0">
								<span className="font-geist-mono text-[11px] text-[#6d737c] whitespace-nowrap">
									{formatDate(item.ts)}
								</span>
								{item.totalCost != null &&
									item.executionTarget !== "cloud" &&
									isCostVisible(item.apiProvider) && (
										<span className="px-2 py-0.5 rounded-md bg-white/[0.05] border border-white/[0.06] text-[#9ea4ad] font-geist-mono text-[10.5px] tabular-nums whitespace-nowrap">
											${item.totalCost.toFixed(2)}
										</span>
									)}
							</div>
						</div>
					))
				) : (
					<div className="text-center text-[#6d737c] text-[13px] py-4">No recent tasks</div>
				)}
			</div>
		</div>
	)
}

export default memo(HistoryPreview)
