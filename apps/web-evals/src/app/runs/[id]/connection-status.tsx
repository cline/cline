"use client"

import type { EventSourceStatus } from "@/hooks/use-event-source"
import { useRunners } from "@/hooks/use-runners"
import { cn } from "@/lib/utils"

type ConnectionStatusProps = {
	status: EventSourceStatus
	runId: number
}

export const ConnectionStatus = (connectionStatus: ConnectionStatusProps) => {
	const { data: runners, isLoading } = useRunners(connectionStatus.runId)
	const status = isLoading ? "loading" : runners === null ? "dead" : connectionStatus.status

	return (
		<div>
			<div className="flex items-center gap-2">
				<div className="flex items-center gap-2">
					<div>Status:</div>
					<div className="capitalize">{status}</div>
				</div>
				<div className="relative">
					<div
						className={cn("absolute size-2.5 rounded-full opacity-50 animate-ping", {
							"bg-gray-500": status === "loading",
							"bg-green-500": status === "connected",
							"bg-amber-500": status === "waiting",
							"bg-rose-500": status === "error" || status === "dead",
						})}
					/>
					<div
						className={cn("size-2.5 rounded-full", {
							"bg-gray-500": status === "loading",
							"bg-green-500": status === "connected",
							"bg-amber-500": status === "waiting",
							"bg-rose-500": status === "error" || status === "dead",
						})}
					/>
				</div>
			</div>
			<div className="flex items-center gap-2">
				<div>Runners:</div>
				{runners && runners.length > 0 && (
					<div className="font-mono text-sm text-muted-foreground">{runners?.join(", ")}</div>
				)}
			</div>
		</div>
	)
}
