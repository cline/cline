import { isRecord, normalizeValue } from "./parsers.js";

export type ToolAggregate = {
	key: string;
	count: number;
	noun: string;
	pluralNoun?: string;
	completedVerb: string;
	progressVerb: string;
};

export type TeamSummaryResult = {
	label: string;
	details: string[];
	aggregate?: ToolAggregate;
};

export function pluralize(
	count: number,
	singular: string,
	plural = `${singular}s`,
): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return isRecord(value) ? value : null;
}

function resultRecords(result: unknown): Record<string, unknown>[] {
	const normalized = normalizeValue(result);
	if (Array.isArray(normalized)) {
		return normalized
			.map(asRecord)
			.filter((item): item is Record<string, unknown> => item !== null);
	}
	const record = asRecord(normalized);
	return record ? [record] : [];
}

function recordString(
	record: Record<string, unknown> | null | undefined,
	key: string,
	fallback = "",
): string {
	const value = record?.[key];
	return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function teamSummary(
	toolName: string,
	input: unknown,
	result: unknown,
	inProgress: boolean,
	isError: boolean,
): TeamSummaryResult | null {
	if (!toolName.startsWith("team_")) return null;
	if (isError) {
		const failureLabels: Record<string, string> = {
			team_attach_outcome_fragment: "Failed to attach outcome fragment",
			team_await_runs: "Failed while waiting for teammates",
			team_broadcast: "Failed to broadcast message to teammates",
			team_cancel_run: "Failed to cancel teammate run",
			team_cleanup: "Failed to clean up team",
			team_create_outcome: "Failed to create team outcome",
			team_finalize_outcome: "Failed to finalize team outcome",
			team_list_outcomes: "Failed to list team outcomes",
			team_list_runs: "Failed to list teammate runs",
			team_mission_log: "Failed to update mission log",
			team_read_mailbox: "Failed to read team mailbox",
			team_review_outcome_fragment: "Failed to review outcome fragment",
			team_run_task: "Failed to assign team task",
			team_send_message: "Failed to send message",
			team_shutdown_teammate: "Failed to stop teammate",
			team_spawn_teammate: "Failed to spawn teammate",
			team_status: "Failed to check team status",
			team_task: "Failed to update team task",
		};
		return {
			label: failureLabels[toolName] ?? `Failed ${toolName}`,
			details: [],
		};
	}
	const inputRecord = asRecord(normalizeValue(input));
	const records = resultRecords(result);
	const resultRecord = records[0];
	const aggregate = (
		key: string,
		noun: string,
		completedVerb: string,
		progressVerb: string,
		details: string[],
		pluralNoun?: string,
		count = 1,
	): TeamSummaryResult => ({
		label: `${inProgress ? progressVerb : completedVerb} ${pluralize(
			count,
			noun,
			pluralNoun,
		)}`,
		aggregate: {
			key,
			count,
			noun,
			pluralNoun,
			completedVerb,
			progressVerb,
		},
		details,
	});
	const agentId = recordString(
		resultRecord,
		"agentId",
		recordString(inputRecord, "agentId"),
	);

	switch (toolName) {
		case "team_spawn_teammate":
			return aggregate(
				"team-spawn",
				"teammate",
				"Spawned",
				"Spawning",
				agentId ? [agentId] : [],
			);
		case "team_run_task": {
			const mode = recordString(
				resultRecord,
				"mode",
				recordString(inputRecord, "runMode", "sync"),
			);
			const status = inProgress
				? "assigning"
				: recordString(resultRecord, "status", "assigned");
			return aggregate(
				"team-run-task",
				"team task",
				"Assigned",
				"Assigning",
				[mode, agentId, status].filter(Boolean).join(" ")
					? [[mode, agentId, status].filter(Boolean).join(" ")]
					: [],
				"team tasks",
			);
		}
		case "team_await_runs": {
			const details = records.map((run) =>
				[
					recordString(run, "agentId", recordString(run, "id")),
					recordString(run, "status"),
				]
					.filter(Boolean)
					.join(" "),
			);
			return {
				label: inProgress ? "Waiting for teammates" : "Waited for teammates",
				details,
			};
		}
		case "team_shutdown_teammate":
			return aggregate(
				"team-shutdown",
				"teammate",
				"Stopped",
				"Stopping",
				agentId ? [agentId] : [],
			);
		case "team_status": {
			const members = Array.isArray(resultRecord?.members)
				? resultRecord.members
						.map(asRecord)
						.filter((item): item is Record<string, unknown> => item !== null)
				: [];
			return {
				label: inProgress ? "Checking team status" : "Checked team status",
				details: members.map((member) =>
					[recordString(member, "agentId"), recordString(member, "status")]
						.filter(Boolean)
						.join(" "),
				),
			};
		}
		case "team_task": {
			const action = recordString(
				inputRecord,
				"action",
				recordString(resultRecord, "action", "update"),
			);
			const verbs: Record<string, [string, string]> = {
				create: ["Created", "Creating"],
				list: ["Listed", "Listing"],
				claim: ["Claimed", "Claiming"],
				complete: ["Completed", "Completing"],
				block: ["Blocked", "Blocking"],
			};
			const [completedVerb, progressVerb] = verbs[action] ?? [
				"Updated",
				"Updating",
			];
			const tasks = Array.isArray(resultRecord?.tasks)
				? resultRecord.tasks
						.map(asRecord)
						.filter((item): item is Record<string, unknown> => item !== null)
				: records;
			const details = tasks.map((task) =>
				[
					recordString(
						task,
						"taskId",
						recordString(task, "id", recordString(inputRecord, "taskId")),
					),
					recordString(task, "title", recordString(inputRecord, "title")),
					recordString(task, "status"),
				]
					.filter(Boolean)
					.join(" "),
			);
			return aggregate(
				`team-task-${action}`,
				"team task",
				completedVerb,
				progressVerb,
				details,
				undefined,
				action === "list" ? tasks.length : 1,
			);
		}
		case "team_list_runs":
			return {
				label: inProgress
					? "Listing teammate runs"
					: `Listed ${pluralize(records.length, "teammate run")}`,
				details: records.map((run) =>
					[recordString(run, "agentId"), recordString(run, "status")]
						.filter(Boolean)
						.join(" "),
				),
			};
		case "team_cancel_run":
			return {
				label: inProgress
					? "Cancelling teammate run"
					: "Cancelled teammate run",
				details: [
					[
						recordString(
							resultRecord,
							"runId",
							recordString(inputRecord, "runId"),
						),
						recordString(resultRecord, "status"),
					]
						.filter(Boolean)
						.join(" "),
				].filter(Boolean),
			};
		case "team_send_message": {
			const recipient = recordString(
				resultRecord,
				"toAgentId",
				recordString(inputRecord, "toAgentId"),
			);
			return aggregate(
				"team-send-message",
				"message",
				"Sent",
				"Sending",
				[recipient, recordString(inputRecord, "subject")].filter(Boolean).length
					? [
							[recipient, recordString(inputRecord, "subject")]
								.filter(Boolean)
								.join(" "),
						]
					: [],
			);
		}
		case "team_broadcast": {
			const delivered = resultRecord?.delivered;
			return {
				label: inProgress
					? "Broadcasting message to teammates"
					: `Broadcast message to ${pluralize(typeof delivered === "number" ? delivered : 0, "teammate")}`,
				details: recordString(inputRecord, "subject")
					? [recordString(inputRecord, "subject")]
					: [],
			};
		}
		case "team_read_mailbox":
			return {
				label: inProgress
					? "Reading team mailbox"
					: `Read ${pluralize(records.length, "team message")}`,
				details: records.map((message) =>
					[
						recordString(message, "fromAgentId"),
						recordString(message, "subject"),
					]
						.filter(Boolean)
						.join(" "),
				),
			};
		case "team_mission_log":
			return {
				label: inProgress ? "Updating mission log" : "Updated mission log",
				details: [
					[
						recordString(inputRecord, "kind"),
						recordString(inputRecord, "summary"),
					]
						.filter(Boolean)
						.join(" "),
				].filter(Boolean),
			};
		case "team_cleanup":
			return {
				label: inProgress ? "Cleaning up team" : "Cleaned up team",
				details: recordString(resultRecord, "status")
					? [recordString(resultRecord, "status")]
					: [],
			};
		case "team_create_outcome":
			return {
				label: inProgress ? "Creating team outcome" : "Created team outcome",
				details: [
					[
						recordString(resultRecord, "outcomeId"),
						recordString(inputRecord, "title"),
						recordString(resultRecord, "status"),
					]
						.filter(Boolean)
						.join(" "),
				].filter(Boolean),
			};
		case "team_attach_outcome_fragment":
			return {
				label: inProgress
					? "Attaching outcome fragment"
					: "Attached outcome fragment",
				details: [
					[
						recordString(inputRecord, "section"),
						recordString(resultRecord, "status"),
					]
						.filter(Boolean)
						.join(" "),
				].filter(Boolean),
			};
		case "team_review_outcome_fragment":
			return {
				label: inProgress
					? "Reviewing outcome fragment"
					: "Reviewed outcome fragment",
				details: [
					[
						recordString(inputRecord, "fragmentId"),
						typeof inputRecord?.approved === "boolean"
							? inputRecord.approved
								? "approved"
								: "rejected"
							: recordString(resultRecord, "status"),
					]
						.filter(Boolean)
						.join(" "),
				].filter(Boolean),
			};
		case "team_finalize_outcome":
			return {
				label: inProgress
					? "Finalizing team outcome"
					: "Finalized team outcome",
				details: [
					[
						recordString(
							resultRecord,
							"outcomeId",
							recordString(inputRecord, "outcomeId"),
						),
						recordString(resultRecord, "status"),
					]
						.filter(Boolean)
						.join(" "),
				].filter(Boolean),
			};
		case "team_list_outcomes":
			return {
				label: inProgress
					? "Listing team outcomes"
					: `Listed ${pluralize(records.length, "team outcome")}`,
				details: records.map((outcome) =>
					[
						recordString(outcome, "title", recordString(outcome, "id")),
						recordString(outcome, "status"),
					]
						.filter(Boolean)
						.join(" "),
				),
			};
		default:
			return null;
	}
}
