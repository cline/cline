"use client"

import type { RunStatus as _RunStatus } from "@/hooks/use-run-status"
import { cn } from "@/lib/utils"

export const RunStatus = ({ runStatus: { sseStatus, heartbeat, runners = [] } }: { runStatus: _RunStatus }) => (
	<div>
		<div className="flex items-center gap-2">
			<div className="flex items-center gap-2">
				<div>Task Stream:</div>
				<div className="font-mono text-sm text-muted-foreground">{sseStatus}</div>
			</div>
			<div className="relative">
				<div
					className={cn("absolute size-2.5 rounded-full opacity-50 animate-ping", {
						"bg-green-500": sseStatus === "connected",
						"bg-amber-500": sseStatus === "waiting",
						"bg-rose-500": sseStatus === "error",
					})}
				/>
				<div
					className={cn("size-2.5 rounded-full", {
						"bg-green-500": sseStatus === "connected",
						"bg-amber-500": sseStatus === "waiting",
						"bg-rose-500": sseStatus === "error",
					})}
				/>
			</div>
		</div>
		<div className="flex items-center gap-2">
			<div className="flex items-center gap-2">
				<div>Task Controller:</div>
				<div className="font-mono text-sm text-muted-foreground">{heartbeat ?? "dead"}</div>
			</div>
			<div className="relative">
				<div
					className={cn("absolute size-2.5 rounded-full opacity-50 animate-ping", {
						"bg-green-500": !!heartbeat,
						"bg-rose-500": !heartbeat,
					})}
				/>
				<div
					className={cn("size-2.5 rounded-full", {
						"bg-green-500": !!heartbeat,
						"bg-rose-500": !heartbeat,
					})}
				/>
			</div>
		</div>
		<div className="flex items-center gap-2">
			<div>Task Runners:</div>
			{runners.length > 0 && <div className="font-mono text-sm text-muted-foreground">{runners?.join(", ")}</div>}
		</div>
	</div>
)
