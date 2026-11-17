"use client";

import {
	Badge,
	DetailList,
	type DetailListColumn,
	DetailListItem,
	Switch,
} from "@cline/ui";
import { ChevronRight } from "lucide-react";
import { useId } from "react";
import { useHasUnreadScheduleRun } from "@/hooks/use-schedule-run-notifications";
import { cn } from "@/lib/utils";
import { getScheduleDescription } from "./schedule-format";
import {
	formatScheduleFrequency,
	formatScheduleLastRun,
	formatScheduleNextRun,
	summarizeScheduleRuns,
} from "./schedule-list-format";
import { ScheduleStatusBadge } from "./schedule-status-badge";
import type { Schedule, ScheduleExecution } from "./schedule-types";

const SCHEDULE_COLUMNS = [
	{ key: "frequency", label: "Frequency", width: "96px" },
	{ key: "nextRun", label: "Next run", width: "128px" },
	{ key: "lastRun", label: "Last run", width: "96px" },
	{ key: "status", label: "Status", width: "112px" },
] satisfies readonly DetailListColumn[];

type ScheduleActions = {
	onOpen: (schedule: Schedule, trigger?: HTMLButtonElement) => void;
	onEnabledChange: (
		schedule: Schedule,
		enabled: boolean,
	) => void | Promise<void>;
};

function ScheduleTitle({
	children,
	unread = false,
}: {
	children: string;
	unread?: boolean;
}) {
	return (
		<span className="flex min-w-0 items-start gap-3">
			<span
				aria-hidden="true"
				className={cn(
					"mt-[calc((1lh-0.375rem)/2)] size-1.5 shrink-0 rounded-full",
					unread && "bg-cline-ui-info-solid",
				)}
				data-schedule-run-indicator-slot
				data-schedule-run-status={unread ? "unread" : undefined}
			/>
			<span className="min-w-0 truncate">{children}</span>
		</span>
	);
}

export function ScheduleList({
	schedules,
	executions,
	busyScheduleIds,
	...actions
}: ScheduleActions & {
	schedules: Schedule[];
	executions: ScheduleExecution[];
	busyScheduleIds: ReadonlySet<string>;
}) {
	return (
		<DetailList
			columns={SCHEDULE_COLUMNS}
			actionsWidth="64px"
			aria-label="Schedules"
			titleLabel={<ScheduleTitle>Title</ScheduleTitle>}
		>
			{schedules.map((schedule) => (
				<ScheduleListItem
					key={schedule.scheduleId}
					schedule={schedule}
					executions={executions}
					isBusy={busyScheduleIds.has(schedule.scheduleId)}
					{...actions}
				/>
			))}
		</DetailList>
	);
}

export function ScheduleListItem({
	schedule,
	executions,
	isBusy,
	onOpen,
	onEnabledChange,
}: ScheduleActions & {
	schedule: Schedule;
	executions: ScheduleExecution[];
	isBusy: boolean;
}) {
	const summaryId = useId();
	const hasUnreadRun = useHasUnreadScheduleRun(schedule.scheduleId);
	const runs = summarizeScheduleRuns(schedule, executions);
	const description =
		getScheduleDescription(schedule).trim() || schedule.prompt || undefined;
	return (
		<DetailListItem
			title={
				<ScheduleTitle unread={hasUnreadRun}>{schedule.name}</ScheduleTitle>
			}
			primaryAction={{
				label: `Open ${schedule.name}`,
				onClick: (event) => onOpen(schedule, event.currentTarget),
			}}
			description={
				description ? (
					<span className="block truncate pl-[1.125rem]">{description}</span>
				) : undefined
			}
			values={{
				frequency: (
					<Badge tone="neutral">{formatScheduleFrequency(schedule)}</Badge>
				),
				nextRun: formatScheduleNextRun(schedule),
				lastRun: formatScheduleLastRun(schedule.lastRunAt),
				status: (
					<>
						<ScheduleStatusBadge
							status={runs.status}
							label={runs.label}
							descriptionId={summaryId}
						/>
						<span id={summaryId} className="sr-only">
							{runs.description}
						</span>
					</>
				),
			}}
			actions={
				<>
					<Switch
						size="sm"
						tone="neutral"
						checked={schedule.enabled}
						onCheckedChange={(checked) =>
							void onEnabledChange(schedule, checked)
						}
						pending={isBusy}
						aria-label={`Enable ${schedule.name}`}
					/>
					<ChevronRight
						aria-hidden="true"
						className="size-5 shrink-0 text-(--neutral-8)"
					/>
				</>
			}
		/>
	);
}
