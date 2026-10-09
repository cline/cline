import { type CurrentCloudTaskInfo, formatRepoLabel, isPersistedCloudSessionId } from "@shared/cloud/cloud-sessions"
import { StringRequest } from "@shared/proto/cline/common"
import { CloudIcon, ExternalLinkIcon, LoaderCircleIcon } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useResolvedCloudStatuses } from "@/hooks/useResolvedCloudStatuses"
import { CloudServiceClient } from "@/services/grpc-client"

/** Task-header marker for a task running in Cline Cloud; click opens the session in the dashboard. */
export function CloudTaskBadge({ cloudTask }: { cloudTask: CurrentCloudTaskInfo }) {
	const resolvedStatuses = useResolvedCloudStatuses([
		{ id: cloudTask.sessionId, executionTarget: "cloud", cloudStatus: cloudTask.status },
	])
	const status = resolvedStatuses.get(cloudTask.sessionId) ?? cloudTask.status
	const active = status === "running" || status === "provisioning"
	const unconfirmed = status === "unknown"
	const canOpenDashboard = isPersistedCloudSessionId(cloudTask.sessionId)
	const repo = formatRepoLabel(cloudTask.repoUrl)
	const where = repo ? ` on ${repo}${cloudTask.branch ? ` (${cloudTask.branch})` : ""}` : ""
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					className="mx-1 inline-flex max-w-40 shrink-0 items-center gap-1 rounded-full border-0 bg-badge-background px-1.5 py-0.5 text-xs text-badge-foreground enabled:cursor-pointer enabled:hover:opacity-90"
					disabled={!canOpenDashboard}
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
					{canOpenDashboard && <ExternalLinkIcon className="size-2.5 shrink-0 opacity-70" />}
				</button>
			</TooltipTrigger>
			<TooltipContent className="text-xs" side="bottom">
				{unconfirmed ? "Cline Cloud status could not be confirmed" : "Running in Cline Cloud"}
				{where}.
				{canOpenDashboard
					? " Click to open in the dashboard."
					: " The dashboard link will be available when provisioning finishes."}
			</TooltipContent>
		</Tooltip>
	)
}
