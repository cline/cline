import { Badge } from "@cline/ui";
import {
	FAILURE_STATUSES,
	formatExecutionStatus,
	SUCCESS_STATUSES,
} from "./schedule-executions";

export function ScheduleStatusBadge({
	status,
	label,
	descriptionId,
}: {
	status?: string;
	/** Overrides the status label, e.g. when a schedule has no runs to report. */
	label?: string;
	descriptionId?: string;
}) {
	const normalizedStatus = status?.trim().toLowerCase() ?? "";
	return (
		<Badge
			variant="ghost"
			tone={
				SUCCESS_STATUSES.has(normalizedStatus)
					? "success"
					: FAILURE_STATUSES.has(normalizedStatus)
						? "error"
						: "neutral"
			}
			aria-describedby={descriptionId}
		>
			{label ?? formatExecutionStatus(status)}
		</Badge>
	);
}
