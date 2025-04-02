"use client"

import { useCallback } from "react"
import { Skull } from "lucide-react"

import { killProcessTree } from "@/lib/server/processes"
import { EventSourceStatus } from "@/hooks/use-event-source"
import { useProcessList } from "@/hooks/use-process-tree"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui"

type ConnectionStatusProps = {
	status: EventSourceStatus
	pid: number | null
}

export const ConnectionStatus = (connectionStatus: ConnectionStatusProps) => {
	const { data: pids, isLoading } = useProcessList(connectionStatus.pid)
	const status = isLoading ? "loading" : pids === null ? "dead" : connectionStatus.status

	const onKill = useCallback(async () => {
		if (connectionStatus.pid) {
			await killProcessTree(connectionStatus.pid)
			window.location.reload()
		}
	}, [connectionStatus.pid])

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
				<div>PIDs:</div>
				<div className="font-mono text-sm">{connectionStatus.pid}</div>
				{status === "connected" && (
					<>
						<div className="font-mono text-sm text-muted-foreground">{pids?.join(" ")}</div>
						<Button variant="ghost" size="sm" onClick={onKill}>
							Kill
							<Skull />
						</Button>
					</>
				)}
			</div>
		</div>
	)
}
