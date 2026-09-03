import { formatRepoLabel } from "@shared/cloud/cloud-sessions"
import { StringRequest } from "@shared/proto/cline/common"
import { CloudIcon, LoaderCircleIcon } from "lucide-react"
import { memo, useMemo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { TaskServiceClient } from "@/services/grpc-client"
import { isCloudStatusActive } from "./CloudStatusPill"

/**
 * Home-screen strip listing cloud tasks that are still starting or running,
 * so parallel sessions stay visible without opening History.
 */
const RunningCloudTasks = () => {
	const { taskHistory } = useExtensionState()
	const running = useMemo(
		() => taskHistory.filter((item) => item.executionTarget === "cloud" && isCloudStatusActive(item.cloudStatus)),
		[taskHistory],
	)
	if (running.length === 0) {
		return null
	}
	return (
		<div className="shrink-0">
			<div className="mx-4 mb-2 mt-2 flex items-center gap-1 text-description">
				<CloudIcon className="size-3" />
				<span className="text-[0.85em] font-medium uppercase">Running in the cloud</span>
				<span className="ml-1 rounded-full bg-badge-background px-1.5 text-[0.75em] font-medium text-badge-foreground">
					{running.length}
				</span>
			</div>
			<div className="px-4">
				{running.map((item) => (
					<button
						className="mb-2 flex w-full cursor-pointer items-center gap-3 rounded-sm border-0 bg-[color-mix(in_srgb,var(--vscode-toolbar-hoverBackground)_65%,transparent)] px-3 py-2 text-left hover:bg-toolbar-hover"
						key={item.id}
						onClick={() =>
							TaskServiceClient.showTaskWithId(StringRequest.create({ value: item.id })).catch((error) =>
								console.error("Error showing task:", error),
							)
						}
						type="button">
						<LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-[var(--vscode-charts-green)]" />
						<div className="flex min-w-0 flex-1 flex-col gap-0.5">
							<span className="ph-no-capture line-clamp-1 text-foreground">{item.task}</span>
							<span className="truncate text-xs text-description">
								{item.cloudStatus === "provisioning" ? "Starting sandbox" : "Working"}
								{item.cloudRepoUrl ? ` · ${formatRepoLabel(item.cloudRepoUrl)}` : ""}
								{item.cloudBranch ? ` · ${item.cloudBranch}` : ""}
							</span>
						</div>
					</button>
				))}
			</div>
		</div>
	)
}

export default memo(RunningCloudTasks)
