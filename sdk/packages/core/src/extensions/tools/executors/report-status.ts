import type {
	StatusPriority,
	StatusPublishInput,
	StatusState,
	StatusUpdate,
} from "@cline/shared";
import { getStatusService, type StatusService } from "../../../status";
import type { StatusReportExecutor } from "../types";

/**
 * Binds the `report_status` tool to the Status Hub (ARD-0005).
 *
 * Attribution (session, agent, workspace) is filled from the tool context
 * rather than trusted from the model — an agent should not be able to file a
 * status update as some other agent.
 */

export interface ReportStatusExecutorOptions {
	/** Defaults to the process-wide Status Hub service. */
	service?: StatusService;
	/** Publisher label recorded on every update from this executor. */
	source?: string;
	/**
	 * Optional side channel used by the hub to broadcast `status.updated` and
	 * to raise `ui.notify` for high/critical updates. When absent the update is
	 * still durably stored, it just is not pushed live.
	 */
	onPublished?: (update: StatusUpdate) => void;
}

function contextValue(context: unknown, key: string): string | undefined {
	if (!context || typeof context !== "object") return undefined;
	const value = (context as Record<string, unknown>)[key];
	return typeof value === "string" && value.trim().length > 0
		? value
		: undefined;
}

export function createReportStatusExecutor(
	options: ReportStatusExecutorOptions = {},
): StatusReportExecutor {
	const source = options.source ?? "agent";

	return async (input, context) => {
		const service = options.service ?? getStatusService();

		const publishInput: StatusPublishInput = {
			subject: input.subject,
			state: input.state as StatusState,
			headline: input.headline,
			detail: input.detail,
			priority: (input.priority as StatusPriority | undefined) ?? "normal",
			progress: input.progress,
			source,
			sessionId: contextValue(context, "sessionId"),
			agentId: contextValue(context, "agentId"),
			agentName: contextValue(context, "agentName"),
			workspaceRoot:
				contextValue(context, "workspaceRoot") ?? contextValue(context, "cwd"),
		};

		const update = service.publish(publishInput);
		options.onPublished?.(update);

		const pushed = service.isPushWorthy(update)
			? " and surfaced to the user"
			: "";
		return `Status recorded for "${update.subject}" as ${update.state} (seq ${update.seq})${pushed}.`;
	};
}
