import { type CurrentCloudTaskInfo, formatRepoLabel } from "@shared/cloud/cloud-sessions"
import { StringRequest } from "@shared/proto/cline/common"
import { CloudIcon, ExternalLinkIcon, LoaderCircleIcon } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { CloudServiceClient } from "@/services/grpc-client"

/** Task-header marker for a task running in Cline Cloud; click opens the session in the dashboard. */
export function CloudTaskBadge({ cloudTask }: { cloudTask: CurrentCloudTaskInfo }) {
	const active = cloudTask.status === "running" || cloudTask.status === "provisioning"
	const repo = formatRepoLabel(cloudTask.repoUrl)
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					className="mx-1 inline-flex max-w-40 shrink-0 cursor-pointer items-center gap-1 rounded-full border-0 bg-badge-background px-1.5 py-0.5 text-xs text-badge-foreground hover:opacity-90"
					onClick={(event) => {
						event.stopPropagation()
						CloudServiceClient.openCloudSessionDashboard(StringRequest.create({ value: cloudTask.sessionId })).catch(
							(error) => console.error("Failed to open dashboard:", error),
						)
					}}
					type="button">
					{active ? (
						<LoaderCircleIcon className="size-3 shrink-0 animate-spin" />
					) : (
						<CloudIcon className="size-3 shrink-0" />
					)}
					<span className="truncate">{repo || "Cloud"}</span>
					<ExternalLinkIcon className="size-2.5 shrink-0 opacity-70" />
				</button>
			</TooltipTrigger>
			<TooltipContent className="text-xs" side="bottom">
				Running in Cline Cloud{repo ? ` on ${repo}` : ""}
				{cloudTask.branch ? ` (${cloudTask.branch})` : ""}. Click to open in the dashboard.
			</TooltipContent>
		</Tooltip>
	)
}
