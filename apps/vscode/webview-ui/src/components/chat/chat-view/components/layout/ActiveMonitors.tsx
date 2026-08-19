import type { ActiveMonitor } from "@shared/ExtensionMessage"
import { StringRequest } from "@shared/proto/cline/common"
import { useState } from "react"
import { TaskServiceClient } from "@/services/grpc-client"

export function monitorSummary(items: ActiveMonitor[]): string {
	return items.length === 1 ? "Watching in the background" : `${items.length} background monitors`
}

export function linesLabel(count: number): string {
	return count === 1 ? "1 line" : `${count} lines`
}

/** Only running monitors render; ended ones disappear from the roster. */
export function selectRunningMonitors(items: ActiveMonitor[] | undefined): ActiveMonitor[] {
	return (items ?? []).filter((item) => item.status === "running")
}

interface ActiveMonitorsProps {
	items?: ActiveMonitor[]
}

export function ActiveMonitors({ items = [] }: ActiveMonitorsProps) {
	const [stoppingIds, setStoppingIds] = useState<Set<string>>(() => new Set())

	const running = selectRunningMonitors(items)
	if (running.length === 0) {
		return null
	}

	const stopMonitor = (monitorId: string) => {
		setStoppingIds((current) => new Set(current).add(monitorId))
		TaskServiceClient.stopMonitor(StringRequest.create({ value: monitorId }))
			.catch((error) => {
				console.error("Failed to stop monitor:", error)
			})
			.finally(() => {
				setStoppingIds((current) => {
					const next = new Set(current)
					next.delete(monitorId)
					return next
				})
			})
	}

	return (
		<div className="mx-3 mt-2.5 mb-2.5 rounded-xs border border-editor-group-border bg-code/70 px-2.5 py-2 shadow-xs">
			<div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-description">
				<span aria-hidden="true" className="codicon codicon-pulse text-[12px]" />
				<span>{monitorSummary(running)}</span>
			</div>
			<div className="flex max-h-28 flex-col gap-1.5 overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
				{running.map((item) => {
					const isStopping = stoppingIds.has(item.id)
					return (
						<div
							className="flex items-start gap-2 rounded-[3px] bg-input-background/40 px-2 py-1.5 text-xs"
							key={item.id}>
							<span aria-hidden="true" className="mt-1.75 size-1.5 shrink-0 rounded-full bg-success/80" />
							<span className="min-w-0 flex-1 break-words text-foreground" title={item.command}>
								<span className="font-medium">{item.name}</span>
								<span className="text-description"> {item.description}</span>
							</span>
							<span className="flex h-5 shrink-0 items-center rounded-[3px] border border-editor-group-border px-1.5 text-[10px] leading-none text-description">
								{linesLabel(item.linesEmitted)}
							</span>
							<button
								aria-label="Stop monitor"
								className="-my-1.5 flex size-5 shrink-0 items-center justify-center rounded-[3px] text-description hover:bg-toolbar-hover-background hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
								disabled={isStopping}
								onClick={() => stopMonitor(item.id)}
								title="Stop monitor"
								type="button">
								<span aria-hidden="true" className="codicon codicon-stop-circle text-[12px]" />
							</button>
						</div>
					)
				})}
			</div>
		</div>
	)
}
