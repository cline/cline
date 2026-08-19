"use client";

import {
	BarChart3,
	Blocks,
	CalendarClock,
	Plug,
	ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { DesktopProjection } from "@shared/projection";

/**
 * Read-only Phase 4-6 diagnostics: Gateway-reported execution
 * isolation, plugin catalog summary, bot-scoped connectors, and
 * schedules (the automation provenance sources). No authoring or
 * onboarding UI — this panel only renders what the Gateway reports.
 */
export function GatewayPanel({
	projection,
}: {
	projection: DesktopProjection;
}) {
	const connection = projection.connection;
	const plugins = projection.diagnostics.plugins;
	const connectors = projection.connectors.filter(
		(connector) =>
			!projection.selectedBotId ||
			connector.botId === projection.selectedBotId ||
			connector.botId === "",
	);
	const schedules = projection.schedules.filter(
		(schedule) =>
			!projection.selectedBotId ||
			schedule.botId === projection.selectedBotId ||
			schedule.botId === "",
	);

	return (
		<div
			className="flex shrink-0 flex-col gap-2 border-t px-3 py-2 text-xs"
			data-testid="gateway-panel"
		>
			<span className="font-medium text-muted-foreground uppercase">
				Gateway
			</span>
			<div className="flex flex-col gap-1">
				<span className="flex items-center gap-1.5 text-muted-foreground">
					<ShieldAlert aria-hidden className="size-3 text-amber-400" />
					execution:{" "}
					<span className="gwd-selectable font-mono">
						{connection.isolation ?? "unreported"}
					</span>
				</span>
				{connection.developmentExecution !== false && (
					<span className="text-[10px] text-amber-400/90">
						development execution — not sandboxed
					</span>
				)}
			</div>
			{plugins && (
				<div className="flex flex-col gap-1">
					<span className="flex items-center gap-1.5 text-muted-foreground">
						<Blocks aria-hidden className="size-3" />
						plugin catalog
					</span>
					<span className="gwd-selectable font-mono text-[10px] text-muted-foreground">
						generation {plugins.generation} · {plugins.pluginCount} plugins ·{" "}
						{plugins.pinnedByRuns} pinned ·{" "}
						{plugins.lastReloadOk ? "reload ok" : "reload FAILED"}
					</span>
				</div>
			)}
			{projection.diagnostics.usage && (
				<div className="flex flex-col gap-1" data-testid="usage-readout">
					<span className="flex items-center gap-1.5 text-muted-foreground">
						<BarChart3 aria-hidden className="size-3" />
						usage ({projection.diagnostics.usage.from} →{" "}
						{projection.diagnostics.usage.to})
					</span>
					<span className="gwd-selectable font-mono text-[10px] text-muted-foreground">
						{projection.diagnostics.usage.tokens.toLocaleString()} tokens ·{" "}
						{projection.diagnostics.usage.modelCalls} calls ·{" "}
						{projection.diagnostics.usage.messages} messages · $
						{projection.diagnostics.usage.estimatedCost.toFixed(4)} ·{" "}
						{projection.diagnostics.usage.activeModels} models
					</span>
				</div>
			)}
			<Separator />
			<div className="flex flex-col gap-1">
				<span className="flex items-center gap-1.5 text-muted-foreground">
					<Plug aria-hidden className="size-3" />
					connectors ({connectors.length})
				</span>
				{connectors.length === 0 && (
					<span className="text-[10px] text-muted-foreground">
						none registered for this bot
					</span>
				)}
				{connectors.map((connector) => (
					<div
						className="flex items-center gap-1.5"
						key={connector.connectorId}
					>
						<Badge
							className={cn(
								"border-transparent text-[10px]",
								connector.workerState === "running"
									? "bg-emerald-600/20 text-emerald-400"
									: "bg-muted text-muted-foreground",
							)}
						>
							{connector.kind}
						</Badge>
						<span className="min-w-0 flex-1 truncate">{connector.name}</span>
						<span className="text-[10px] text-muted-foreground">
							{connector.status}
							{connector.workerState ? ` · ${connector.workerState}` : ""}
							{connector.hasCredential ? "" : " · no credential"}
						</span>
					</div>
				))}
			</div>
			<div className="flex flex-col gap-1">
				<span className="flex items-center gap-1.5 text-muted-foreground">
					<CalendarClock aria-hidden className="size-3" />
					schedules ({schedules.length})
				</span>
				{schedules.length === 0 && (
					<span className="text-[10px] text-muted-foreground">
						none for this bot
					</span>
				)}
				{schedules.map((schedule) => (
					<div className="flex items-center gap-1.5" key={schedule.scheduleId}>
						<span className="min-w-0 flex-1 truncate">{schedule.name}</span>
						<span className="gwd-selectable truncate text-right font-mono text-[10px] text-muted-foreground">
							{schedule.trigger}
							{schedule.lastJobState ? ` · last: ${schedule.lastJobState}` : ""}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}
