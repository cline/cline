import type { ChatMessage } from "@/lib/chat-schema";
import { parseApplyPatchInput } from "@/lib/session-diff";

export type ToolPayload = {
	toolName?: string;
	input?: unknown;
	result?: unknown;
	isError?: boolean;
};

export type ToolSummary = {
	label: string;
	details: string[];
	aggregate?: {
		key: string;
		count: number;
		noun: string;
		pluralNoun?: string;
		completedVerb: string;
		progressVerb: string;
	};
	diff?: {
		additions: number;
		deletions: number;
	};
};

export function parseJsonString(value: string): unknown {
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return value;
	}
}

export function normalizeDisplayValue(value: unknown): unknown {
	if (typeof value !== "string") {
		return value;
	}
	const trimmed = value.trim();
	if (
		(trimmed.startsWith("{") && trimmed.endsWith("}")) ||
		(trimmed.startsWith("[") && trimmed.endsWith("]"))
	) {
		return parseJsonString(trimmed);
	}
	return value;
}

export function formatToolValue(value: unknown): string {
	const normalized = normalizeDisplayValue(value);
	if (normalized == null) {
		return "";
	}
	if (typeof normalized === "string") {
		return normalized;
	}
	if (
		typeof normalized === "object" &&
		"error" in normalized &&
		typeof normalized.error === "string"
	) {
		return normalized.error;
	}
	try {
		return JSON.stringify(normalized, null, 2);
	} catch {
		return String(normalized);
	}
}

export function parseToolPayload(raw: string): ToolPayload | null {
	try {
		return JSON.parse(raw) as ToolPayload;
	} catch {
		return null;
	}
}

export const TOOL_NAME_ALIASES: Record<string, string> = {
	"apply-patch": "apply_patch",
	bash: "run_commands",
	edit: "editor",
	edit_file: "editor",
	"file-read": "read_files",
	file_read: "read_files",
	search: "search_codebase",
	"spawn-agent": "spawn_agent",
	spawn_agent_tool: "spawn_agent",
	"web-fetch": "fetch_web_content",
	web_fetch: "fetch_web_content",
};

export function normalizeToolName(toolName: string): string {
	const normalized = toolName.toLowerCase();
	return TOOL_NAME_ALIASES[normalized] ?? normalized;
}

export function classifyTool(
	toolName: string,
): "exploration" | "file-edit" | "bash" | "spawn" | "tool" {
	const normalized = normalizeToolName(toolName);
	if (
		["search_codebase", "read_files", "fetch_web_content", "skills"].includes(
			normalized,
		)
	)
		return "exploration";
	if (["editor", "apply_patch"].includes(normalized)) return "file-edit";
	if (normalized === "run_commands") return "bash";
	if (normalized === "spawn_agent" || normalized.startsWith("subagent_"))
		return "spawn";
	return "tool";
}

export function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

export function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter(
		(item): item is string => typeof item === "string" && item.length > 0,
	);
}

/**
 * read_files accepts many input shapes: { files: [{ path }] }, { files: path },
 * { file_paths: [...] }, { paths: [...] }, a bare request, an array, or a string.
 */
export function extractReadFilePaths(input: unknown): string[] {
	const out: string[] = [];
	const push = (value: unknown) => {
		if (typeof value === "string" && value.length > 0) {
			out.push(value);
			return;
		}
		const record = asRecord(value);
		if (record && typeof record.path === "string" && record.path.length > 0) {
			out.push(record.path);
		}
	};
	const record = asRecord(input);
	const candidates =
		record?.files ?? record?.file_paths ?? record?.paths ?? record ?? input;
	if (Array.isArray(candidates)) {
		for (const candidate of candidates) {
			push(candidate);
		}
	} else {
		push(candidates);
	}
	return out;
}

/**
 * run_commands entries can be shell strings or structured { command, args }.
 */
export function extractCommands(input: unknown): string[] {
	const inputObject = asRecord(input);
	const raw = Array.isArray(inputObject?.commands)
		? inputObject.commands
		: typeof inputObject?.command === "string"
			? [inputObject.command]
			: typeof input === "string"
				? [input]
				: [];
	const out: string[] = [];
	for (const entry of raw) {
		if (typeof entry === "string" && entry.length > 0) {
			out.push(entry);
			continue;
		}
		const record = asRecord(entry);
		if (record && typeof record.command === "string") {
			const args = asStringArray(record.args);
			out.push([record.command, ...args].join(" "));
		}
	}
	return out;
}

export function toDisplayPath(path: string): string {
	const parts = path.split(/[\\/]/);
	return parts.at(-1) || path;
}

export function parseDiffCounts(
	value: unknown,
): { additions: number; deletions: number } | null {
	if (typeof value !== "string") return null;
	const lines = value.split("\n");
	let additions = 0;
	let deletions = 0;

	for (const line of lines) {
		if (/^\+\d+:/.test(line)) additions += 1;
		if (/^-\d+:/.test(line)) deletions += 1;
	}

	if (additions === 0 && deletions === 0) return null;
	return { additions, deletions };
}

export function pluralize(
	count: number,
	singular: string,
	plural = `${singular}s`,
): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

export function resultRecords(result: unknown): Record<string, unknown>[] {
	const normalized = normalizeDisplayValue(result);
	if (Array.isArray(normalized)) {
		return normalized.map(asRecord).filter((item) => item !== null);
	}
	const record = asRecord(normalized);
	return record ? [record] : [];
}

export function recordString(
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
): ToolSummary | null {
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
	const inputRecord = asRecord(input);
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
	): ToolSummary => ({
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
				? resultRecord.members.map(asRecord).filter((item) => item !== null)
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
				? resultRecord.tasks.map(asRecord).filter((item) => item !== null)
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

export function buildToolSummary(
	toolName: string,
	input: unknown,
	result: unknown,
	inProgress: boolean,
	isError = false,
): ToolSummary {
	const normalized = normalizeToolName(toolName);
	const inputObject = asRecord(input);
	const teamToolSummary = teamSummary(
		normalized,
		input,
		result,
		inProgress,
		isError,
	);
	if (teamToolSummary) return teamToolSummary;

	if (normalized === "read_files") {
		const files = extractReadFilePaths(input);
		if (files.length > 0) {
			return {
				label: `${inProgress ? "Reading" : "Read"} ${pluralize(files.length, "file")}`,
				aggregate: {
					key: "read-files",
					count: files.length,
					noun: "file",
					completedVerb: "Read",
					progressVerb: "Reading",
				},
				details: files.map(
					(file) => `${inProgress ? "Reading" : "Read"} ${toDisplayPath(file)}`,
				),
			};
		}
	}

	if (normalized === "search_codebase") {
		const queries = asStringArray(inputObject?.queries);
		if (queries.length > 0) {
			return {
				label: `${inProgress ? "Exploring" : "Explored"} ${pluralize(queries.length, "search")}`,
				aggregate: {
					key: "searches",
					count: queries.length,
					noun: "search",
					completedVerb: "Explored",
					progressVerb: "Exploring",
				},
				details: queries.map((query) => query),
			};
		}
	}

	if (normalized === "run_commands") {
		const commands = extractCommands(input);
		if (commands.length > 0) {
			return {
				label: `${inProgress ? "Running" : "Ran"} ${pluralize(commands.length, "command")}`,
				aggregate: {
					key: "commands",
					count: commands.length,
					noun: "command",
					completedVerb: "Ran",
					progressVerb: "Running",
				},
				details: commands.map((command) => command.trim()),
			};
		}
	}

	if (normalized === "fetch_web_content") {
		const requests = Array.isArray(inputObject?.requests)
			? inputObject.requests
			: [];
		const urls = requests
			.map((request) => {
				const requestObject = asRecord(request);
				return typeof requestObject?.url === "string"
					? requestObject.url
					: null;
			})
			.filter((url): url is string => Boolean(url));
		if (urls.length > 0) {
			return {
				label: `${inProgress ? "Exploring" : "Explored"} ${pluralize(urls.length, "link")}`,
				aggregate: {
					key: "links",
					count: urls.length,
					noun: "link",
					completedVerb: "Explored",
					progressVerb: "Exploring",
				},
				details: urls.map(
					(url) => `${inProgress ? "Fetching" : "Fetched"} ${url}`,
				),
			};
		}
	}

	if (normalized === "apply_patch") {
		const patchText =
			typeof input === "string"
				? input
				: typeof inputObject?.input === "string"
					? inputObject.input
					: "";
		const fileDiffs = patchText ? parseApplyPatchInput(patchText) : [];
		if (fileDiffs.length > 0) {
			const additions = fileDiffs.reduce((sum, d) => sum + d.additions, 0);
			const deletions = fileDiffs.reduce((sum, d) => sum + d.deletions, 0);
			return {
				label: `${inProgress ? "Editing" : "Edited"} ${pluralize(fileDiffs.length, "file")}`,
				aggregate: {
					key: "edited-files",
					count: fileDiffs.length,
					noun: "file",
					completedVerb: "Edited",
					progressVerb: "Editing",
				},
				diff: { additions, deletions },
				details: fileDiffs.map(
					(d) =>
						`${inProgress ? "Editing" : "Edited"} ${toDisplayPath(d.path)} +${d.additions} -${d.deletions}`,
				),
			};
		}
		return {
			label: inProgress ? "Applying patch" : "Applied patch",
			details: [],
		};
	}

	if (normalized === "editor") {
		// Current editor schema has no `command`; derive it from the input shape.
		const command =
			typeof inputObject?.command === "string"
				? inputObject.command
				: inputObject?.insert_line != null
					? "insert"
					: typeof inputObject?.old_text === "string"
						? "str_replace"
						: typeof inputObject?.new_text === "string"
							? "create"
							: "edit";
		const path =
			typeof inputObject?.path === "string"
				? toDisplayPath(inputObject.path)
				: "file";
		const diff = parseDiffCounts(asRecord(result)?.result);
		const action = inProgress
			? command === "str_replace"
				? "Editing"
				: command === "create"
					? "Creating"
					: command === "insert"
						? "Inserting"
						: "Editing"
			: command === "str_replace"
				? "Edited"
				: command === "create"
					? "Created"
					: command === "insert"
						? "Inserted"
						: "Edited";
		// The label already carries all the information; no expandable details.
		const detail = `${action} ${path}`;
		const aggregate = {
			key: "edited-files",
			count: 1,
			noun: "file",
			completedVerb: "Edited",
			progressVerb: "Editing",
		};
		if (diff) {
			return { label: detail, aggregate, diff, details: [] };
		}
		return { label: detail, aggregate, details: [] };
	}

	const query =
		typeof asRecord(result)?.query === "string"
			? (asRecord(result)?.query as string)
			: "";
	const displayToolName = normalized.startsWith("subagent_")
		? "spawn_agent"
		: toolName;
	const fallback =
		query ||
		(inProgress ? `Running ${displayToolName}` : displayToolName) ||
		"Tool";
	return { label: fallback, details: [fallback] };
}

export function buildToolSummaryFromMeta(
	toolName: string,
	kind: "exploration" | "file-edit" | "bash" | "spawn" | "tool",
	inProgress: boolean,
): ToolSummary {
	if (kind === "exploration") {
		return { label: inProgress ? "Exploring" : "Explored", details: [] };
	}
	if (kind === "file-edit") {
		return { label: inProgress ? "Editing" : "Edited", details: [] };
	}
	if (kind === "bash") {
		return {
			label: inProgress ? "Running command" : "Ran command",
			details: [],
		};
	}
	if (kind === "spawn") {
		return {
			label: inProgress ? "Spawning agent" : "Spawned agent",
			details: [],
		};
	}
	return { label: inProgress ? `Running ${toolName}` : toolName, details: [] };
}

export type ToolPresentation = {
	message: ChatMessage;
	payload: ToolPayload | null;
	toolName: string;
	kind: ReturnType<typeof classifyTool>;
	inProgress: boolean;
	summary: ToolSummary;
};

export function buildToolPresentation(message: ChatMessage): ToolPresentation {
	const payload = parseToolPayload(message.content);
	const toolName = message.meta?.toolName || payload?.toolName || "tool";
	const hookEventName = message.meta?.hookEventName;
	const inProgress =
		hookEventName === "tool_call_start" ||
		hookEventName === "history_tool_use" ||
		(Boolean(payload) && payload?.result == null && !payload?.isError);
	const kind = classifyTool(toolName);
	const summary = payload
		? buildToolSummary(
				toolName,
				payload.input,
				payload.result,
				inProgress,
				Boolean(payload.isError),
			)
		: buildToolSummaryFromMeta(toolName, kind, inProgress);
	return { message, payload, toolName, kind, inProgress, summary };
}

export function buildGroupedToolLabel(
	presentations: ToolPresentation[],
): string {
	if (presentations.length === 1) {
		return presentations[0]?.summary.label ?? "Tool";
	}

	type Segment =
		| { type: "label"; label: string }
		| {
				type: "aggregate";
				aggregate: NonNullable<ToolSummary["aggregate"]> & {
					inProgress: boolean;
				};
		  };
	const segments: Segment[] = [];
	for (const presentation of presentations) {
		const aggregate = presentation.summary.aggregate;
		if (!aggregate) {
			segments.push({ type: "label", label: presentation.summary.label });
			continue;
		}

		const previous = segments.at(-1);
		if (
			previous?.type === "aggregate" &&
			previous.aggregate.key === aggregate.key
		) {
			segments[segments.length - 1] = {
				type: "aggregate",
				aggregate: {
					...previous.aggregate,
					count: previous.aggregate.count + aggregate.count,
					inProgress: previous.aggregate.inProgress || presentation.inProgress,
				},
			};
			continue;
		}

		segments.push({
			type: "aggregate",
			aggregate: { ...aggregate, inProgress: presentation.inProgress },
		});
	}

	return segments
		.map((segment) => {
			if (segment.type === "label") return segment.label;
			const { aggregate } = segment;
			const verb = aggregate.inProgress
				? aggregate.progressVerb
				: aggregate.completedVerb;
			return `${verb} ${pluralize(
				aggregate.count,
				aggregate.noun,
				aggregate.pluralNoun,
			)}`;
		})
		.join(". ");
}
