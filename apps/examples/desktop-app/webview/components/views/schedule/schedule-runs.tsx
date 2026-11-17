"use client";

import {
	DetailList,
	type DetailListColumn,
	DetailListItem,
	SectionHeading,
} from "@cline/ui";
import { ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { PaginationFooter } from "../shared/pagination-footer";
import { usePagination } from "../shared/use-pagination";
import { getScheduleExecutions } from "./schedule-executions";
import { formatDateTime } from "./schedule-format";
import { ScheduleRunError } from "./schedule-run-error";
import { ScheduleStatusBadge } from "./schedule-status-badge";
import type { ScheduleExecution } from "./schedule-types";

const RUN_PAGE_SIZE = 25;
const RUN_COLUMNS = [
	{ key: "status", label: "Status", width: "2fr" },
] satisfies readonly DetailListColumn[];

/** The overview contains a bounded, global history, so this is a recent-runs view. */
export function ScheduleRuns({
	scheduleId,
	executions,
	onOpenSession,
}: {
	scheduleId?: string;
	executions: ScheduleExecution[];
	onOpenSession?: (sessionId: string) => void | Promise<void>;
}) {
	const runs = useMemo(
		() => getScheduleExecutions(scheduleId, executions),
		[executions, scheduleId],
	);
	const pagination = usePagination({
		total: runs.length,
		pageSize: RUN_PAGE_SIZE,
		resetKey: scheduleId,
	});
	const visibleRuns = runs.slice(
		pagination.offset,
		pagination.offset + RUN_PAGE_SIZE,
	);

	return (
		<section className="space-y-4" aria-label="Runs">
			<SectionHeading title="Runs" />
			<div
				ref={pagination.contentRef}
				className="grid min-w-0 grid-rows-[1fr_auto] items-start [overflow-anchor:none]"
			>
				<DetailList
					aria-label="Schedule runs"
					titleLabel="Triggered"
					columns={RUN_COLUMNS}
					actionsWidth="20px"
				>
					{runs.length === 0 ? (
						<div>
							<dt className="sr-only">Run history</dt>
							<dd className="m-0 py-3 text-muted-foreground">
								{scheduleId
									? "No runs yet."
									: "Save this schedule to see its runs."}
							</dd>
						</div>
					) : (
						visibleRuns.map((execution) => {
							const sessionId = execution.sessionId?.trim();
							const triggeredAt = formatDateTime(execution.triggeredAt);
							return (
								<DetailListItem
									key={execution.executionId}
									className="items-start"
									title={triggeredAt}
									primaryAction={
										sessionId && onOpenSession
											? {
													label: `Open session triggered ${triggeredAt}`,
													onClick: () => void onOpenSession(sessionId),
												}
											: undefined
									}
									values={{
										status: (
											<>
												<ScheduleStatusBadge status={execution.status ?? ""} />
												{execution.errorMessage ? (
													<ScheduleRunError message={execution.errorMessage} />
												) : null}
											</>
										),
									}}
									actions={
										sessionId && onOpenSession ? (
											<ChevronRight
												aria-hidden="true"
												className="size-5 shrink-0 text-(--neutral-8)"
											/>
										) : undefined
									}
								/>
							);
						})
					)}
				</DetailList>
				<PaginationFooter
					aria-label="Run pages"
					itemLabel="runs"
					page={pagination.page}
					pageSize={RUN_PAGE_SIZE}
					total={runs.length}
					onPageChange={pagination.onPageChange}
				/>
			</div>
		</section>
	);
}
