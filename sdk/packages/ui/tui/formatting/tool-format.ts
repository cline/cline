/**
 * Tool input/output display formatting shared by terminal surfaces: the
 * interactive TUI transcript and headless CLI printers render tool calls
 * through these summaries.
 */

function safeJsonStringify(value: unknown): string {
	try {
		return JSON.stringify(value) ?? "";
	} catch {
		return "";
	}
}

/**
 * Normalizes an untrusted runtime value into a display string without ever
 * throwing. Tool inputs/outputs cross the model/tool boundary, so they may
 * not match their TypeScript annotations (e.g. `{ command: null }`).
 */
export function toDisplayString(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	if (value === null || value === undefined) {
		return "";
	}
	if (typeof value === "object") {
		return safeJsonStringify(value);
	}
	try {
		return String(value);
	} catch {
		return "";
	}
}

export function truncate(value: unknown, maxLen: number): string {
	const oneLine = toDisplayString(value).replace(/\n/g, " ").trim();
	if (oneLine.length <= maxLen) {
		return oneLine;
	}
	return `${oneLine.slice(0, maxLen - 3)}...`;
}

export function formatStructuredCommand(cmd: unknown): string {
	if (typeof cmd === "string") {
		return cmd;
	}
	if (cmd && typeof cmd === "object" && "command" in cmd) {
		const structured = cmd as { command?: unknown; args?: unknown };
		const command = toDisplayString(structured.command);
		// Drop only nullish entries: they carry no display value, while an
		// empty string is a valid argv entry that must stay in the summary.
		const args = Array.isArray(structured.args)
			? structured.args
					.filter((arg) => arg !== null && arg !== undefined)
					.map(toDisplayString)
			: [];
		if (args.length === 0) {
			return command;
		}
		return `${command} ${args.join(" ")}`;
	}
	return toDisplayString(cmd);
}

function summarizeRunCommandsInput(input: unknown): string {
	if (typeof input === "string") {
		return input;
	}

	if (Array.isArray(input)) {
		return input.map(formatStructuredCommand).filter(Boolean).join("; ");
	}

	if (input && typeof input === "object") {
		const obj = input as Record<string, unknown>;
		if (obj.commands !== undefined) {
			if (Array.isArray(obj.commands)) {
				return obj.commands
					.map(formatStructuredCommand)
					.filter(Boolean)
					.join("; ");
			}
			return formatStructuredCommand(obj.commands);
		}
		if ("command" in obj) {
			return formatStructuredCommand(obj);
		}
	}

	return "";
}

function formatAskQuestionInput(input: Record<string, unknown>): string {
	const question =
		typeof input.question === "string" ? input.question.trim() : "";
	const options = Array.isArray(input.options)
		? input.options
				.map((option) => String(option).trim())
				.filter((option) => option.length > 0)
		: [];

	if (!question && options.length === 0) {
		return "";
	}

	const lines = ["The agent is waiting for your input."];
	if (question) {
		lines.push(question);
	}
	for (const [index, option] of options.entries()) {
		lines.push(`${index + 1}. ${option}`);
	}
	lines.push("> Reply with an option number or type your answer.");
	return lines.join("\n");
}

export function formatToolInput(toolName: string, input: unknown): string {
	if (!input) {
		return "";
	}

	if (toolName === "run_commands") {
		return truncate(summarizeRunCommandsInput(input), 120);
	}

	if (typeof input !== "object") {
		return "";
	}

	const obj = input as Record<string, unknown>;

	switch (toolName) {
		case "ask_question":
			return formatAskQuestionInput(obj);
		case "read_files":
			if (Array.isArray(obj.file_paths)) {
				return truncate(obj.file_paths.join(", "), 120);
			}
			break;
		case "search_codebase":
			if (Array.isArray(obj.queries)) {
				return truncate(obj.queries.join(", "), 120);
			}
			break;
		case "fetch_web_content":
			if (Array.isArray(obj.requests)) {
				return truncate(
					obj.requests
						.map((r) =>
							r && typeof r === "object" && "url" in r
								? toDisplayString((r as { url?: unknown }).url)
								: "",
						)
						.filter(Boolean)
						.join(", "),
					120,
				);
			}
			break;
		case "spawn_agent":
			return truncate(String(obj.task ?? ""), 50);
		case "skills":
			return truncate(
				`${String(obj.skill ?? "")}${obj.args ? ` ${String(obj.args)}` : ""}`,
				70,
			);
		case "ask_followup_question":
			return truncate(String(obj.question ?? ""), 120);
		case "team_member": {
			const action = String(obj.action ?? "");
			if (action === "spawn") {
				return truncate(
					`spawn ${String(obj.agentId ?? "")}: ${String(obj.rolePrompt ?? "")}`,
					70,
				);
			}
			if (action === "shutdown") {
				return truncate(`shutdown ${String(obj.agentId ?? "")}`, 70);
			}
			break;
		}
		case "team_spawn_teammate":
			return truncate(
				`${String(obj.agentId ?? "")}: ${String(obj.rolePrompt ?? "")}`,
				70,
			);
		case "team_shutdown_teammate":
			return truncate(`shutdown ${String(obj.agentId ?? "")}`, 70);
		case "team_task": {
			const action = String(obj.action ?? "");
			if (action === "create") {
				return truncate(`create ${String(obj.title ?? "")}`, 60);
			}
			if (action === "list") {
				return truncate(
					`list status=${String(obj.status ?? "any")} readyOnly=${String(obj.readyOnly ?? false)}`,
					60,
				);
			}
			if (action === "claim") {
				return truncate(`claim ${String(obj.taskId ?? "")}`, 60);
			}
			if (action === "complete") {
				return truncate(
					`complete ${String(obj.taskId ?? "")}: ${String(obj.summary ?? "")}`,
					70,
				);
			}
			if (action === "block") {
				return truncate(
					`block ${String(obj.taskId ?? "")}: ${String(obj.reason ?? "")}`,
					70,
				);
			}
			break;
		}
		case "team_run_task":
			return truncate(
				`${String(obj.runMode ?? "sync")} ${String(obj.agentId ?? "")}: ${String(obj.task ?? "")}`,
				70,
			);
		case "team_list_runs":
			return truncate(
				`status=${String(obj.status ?? "any")} agent=${String(obj.agentId ?? "any")}`,
				60,
			);
		case "team_cancel_run":
			return truncate(`cancel ${String(obj.runId ?? "")}`, 60);
		case "team_await_run":
			return truncate(String(obj.runId ?? ""), 60);
		case "team_await_all_runs":
			return "all runs";
		case "team_message": {
			const action = String(obj.action ?? "");
			if (action === "send") {
				return truncate(
					`send ${String(obj.toAgentId ?? "")}: ${String(obj.subject ?? "")}`,
					70,
				);
			}
			if (action === "broadcast") {
				return truncate(`broadcast ${String(obj.subject ?? "")}`, 70);
			}
			if (action === "read") {
				return truncate(
					`read unreadOnly=${String(obj.unreadOnly ?? true)} limit=${String(obj.limit ?? "default")}`,
					70,
				);
			}
			break;
		}
		case "team_send_message":
			return truncate(
				`${String(obj.toAgentId ?? "")}: ${String(obj.subject ?? "")}`,
				70,
			);
		case "team_broadcast":
			return truncate(String(obj.subject ?? ""), 70);
		case "team_read_mailbox":
			return truncate(
				`read unreadOnly=${String(obj.unreadOnly ?? true)} limit=${String(obj.limit ?? "default")}`,
				70,
			);
		case "team_create_outcome":
			return truncate(String(obj.title ?? ""), 70);
		case "team_attach_outcome_fragment":
			return truncate(
				`${String(obj.outcomeId ?? "")}/${String(obj.section ?? "")}`,
				70,
			);
		case "team_review_outcome_fragment":
			return truncate(
				`${String(obj.fragmentId ?? "")}: ${String(obj.approved ?? "")}`,
				70,
			);
		case "team_finalize_outcome":
			return truncate(String(obj.outcomeId ?? ""), 70);
		case "team_list_outcomes":
			return "list";
	}

	return truncate(input, 60);
}

export function formatToolOutput(output: unknown): string {
	if (output === null || output === undefined) {
		return "";
	}

	if (typeof output === "string") {
		return truncate(output, 100);
	}

	if (isTeamStatusBoard(output)) {
		const pending = output.taskCounts.pending;
		const inProgress = output.taskCounts.in_progress;
		const blocked = output.taskCounts.blocked;
		const completed = output.taskCounts.completed;
		const outcomes = output.outcomeCounts;
		return truncate(
			`team=${output.teamName} members=${output.members.length} tasks(p:${pending}/ip:${inProgress}/b:${blocked}/c:${completed}) runs(active:${output.activeRuns}/queued:${output.queuedRuns}) outcomes(d:${outcomes.draft}/r:${outcomes.in_review}/f:${outcomes.finalized})`,
			130,
		);
	}

	if (Array.isArray(output)) {
		const results = output
			.map((item) => {
				if (item && typeof item === "object" && "result" in item) {
					const result = item.result;
					const resultStr = Array.isArray(result)
						? result
								.map((part: unknown) =>
									part &&
									typeof part === "object" &&
									"type" in part &&
									(part as { type: string }).type === "text" &&
									"text" in part
										? String((part as { text: unknown }).text)
										: (part as { type?: string })?.type === "image"
											? "[image]"
											: "",
								)
								.filter(Boolean)
								.join(" ") || "Successfully read image"
						: toDisplayString(result);
					return truncate(resultStr, 80);
				}
				return truncate(item, 80);
			})
			.filter((s) => s.length > 0);

		if (results.length === 0) {
			return "";
		}
		if (results.length === 1) {
			return results[0];
		}
		return `${results[0]} (+${results.length - 1} more)`;
	}

	return truncate(output, 100);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object";
}

function isTeamStatusBoard(value: unknown): value is {
	teamName: string;
	members: unknown[];
	taskCounts: Record<
		"pending" | "in_progress" | "blocked" | "completed",
		number
	>;
	activeRuns: number;
	queuedRuns: number;
	outcomeCounts: Record<"draft" | "in_review" | "finalized", number>;
} {
	if (!isRecord(value)) {
		return false;
	}
	const teamName = value.teamName;
	const members = value.members;
	const taskCounts = value.taskCounts;
	const outcomeCounts = value.outcomeCounts;
	return (
		typeof teamName === "string" &&
		Array.isArray(members) &&
		isRecord(taskCounts) &&
		typeof taskCounts.pending === "number" &&
		typeof taskCounts.in_progress === "number" &&
		typeof taskCounts.blocked === "number" &&
		typeof taskCounts.completed === "number" &&
		typeof value.activeRuns === "number" &&
		typeof value.queuedRuns === "number" &&
		isRecord(outcomeCounts) &&
		typeof outcomeCounts.draft === "number" &&
		typeof outcomeCounts.in_review === "number" &&
		typeof outcomeCounts.finalized === "number"
	);
}
