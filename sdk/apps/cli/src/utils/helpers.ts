import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	ensureHookLogDir,
	type HookEventPayload,
	parseHookEventPayload,
	resolveHookLogPath,
} from "@clinebot/core";
import { nanoid } from "nanoid";
import { commanderToParsedArgs, createProgram } from "../commands/program";
import type { ParsedArgs } from "./types";

export function sanitizeSessionToken(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export function makeSubSessionId(
	rootSessionId: string,
	agentId: string,
): string {
	const root = sanitizeSessionToken(rootSessionId);
	const agent = sanitizeSessionToken(agentId);
	const joined = `${root}__${agent}`;
	return joined.length > 180 ? joined.slice(0, 180) : joined;
}

export function makeTeamTaskSubSessionId(
	rootSessionId: string,
	agentId: string,
): string {
	const root = sanitizeSessionToken(rootSessionId);
	const agent = sanitizeSessionToken(agentId);
	const nonce = Math.random().toString(36).slice(2, 8);
	return `${root}__teamtask__${agent}__${Date.now()}_${nonce}`;
}

export function nowIso(): string {
	return new Date().toISOString();
}

export function randomSessionId(): string {
	return `${Date.now()}_${nanoid(5)}_cli`;
}

export function resolveWorkspaceRoot(cwd: string): string {
	const result = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
		encoding: "utf8",
	});
	if (result.status === 0) {
		const value = result.stdout.trim();
		if (value) {
			return value;
		}
	}
	return cwd;
}

export function truncate(str: string, maxLen: number): string {
	const oneLine = str.replace(/\n/g, " ").trim();
	if (oneLine.length <= maxLen) {
		return oneLine;
	}
	return `${oneLine.slice(0, maxLen - 3)}...`;
}

function formatStructuredCommand(cmd: unknown): string {
	if (typeof cmd === "string") {
		return cmd;
	}
	if (cmd && typeof cmd === "object" && "command" in cmd) {
		const structured = cmd as { command: string; args?: unknown };
		const args = Array.isArray(structured.args) ? structured.args : [];
		if (args.length === 0) {
			return structured.command;
		}
		return `${structured.command} ${args.join(" ")}`;
	}
	return String(cmd);
}

function summarizeRunCommandsInput(input: unknown): string {
	if (typeof input === "string") {
		return input;
	}

	if (Array.isArray(input)) {
		return input.map(formatStructuredCommand).join("; ");
	}

	if (input && typeof input === "object") {
		const obj = input as Record<string, unknown>;
		if (obj.commands !== undefined) {
			if (Array.isArray(obj.commands)) {
				return obj.commands.map(formatStructuredCommand).join("; ");
			}
			return formatStructuredCommand(obj.commands);
		}
		if ("command" in obj) {
			return formatStructuredCommand(obj);
		}
	}

	return "";
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
						.map((r) => r.url)
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

	return truncate(JSON.stringify(input), 60);
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
						: String(result ?? "");
					return truncate(resultStr, 80);
				}
				return truncate(JSON.stringify(item), 80);
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

	return truncate(JSON.stringify(output), 100);
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

export function unlinkIfExists(filePath: string | null | undefined): void {
	if (!filePath) {
		return;
	}
	if (!existsSync(filePath)) {
		return;
	}
	try {
		unlinkSync(filePath);
	} catch {
		// Best-effort cleanup.
	}
}

export function readStdinUtf8(): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		process.stdin.on("data", (chunk: Buffer) =>
			chunks.push(Buffer.from(chunk)),
		);
		process.stdin.on("end", () =>
			resolve(Buffer.concat(chunks).toString("utf-8")),
		);
		process.stdin.on("error", reject);
	});
}

export function writeHookJson(value: unknown): void {
	try {
		process.stdout.write(JSON.stringify(value));
	} catch (error) {
		if (
			!(
				error &&
				typeof error === "object" &&
				"code" in error &&
				typeof (error as { code?: unknown }).code === "string" &&
				(error as { code: string }).code === "EPIPE"
			)
		) {
			throw error;
		}
	}
}

export function appendHookAudit(event: HookEventPayload): void {
	const payloadHookPath = resolveHookLogPath(event.sessionContext);
	const envHookPath = process.env.CLINE_HOOKS_LOG_PATH?.trim() || undefined;
	const targetHookPath = payloadHookPath ?? envHookPath;
	const line = `${JSON.stringify({
		ts: new Date().toISOString(),
		...event,
	})}\n`;
	if (targetHookPath) {
		ensureHookLogDir(targetHookPath);
		appendFileSync(targetHookPath, line, "utf-8");
		return;
	}
	const dir = ensureHookLogDir();
	appendFileSync(join(dir, "hooks.jsonl"), line, "utf-8");
}

export function isCliHookPayload(value: unknown): value is HookEventPayload {
	return parseHookEventPayload(value) !== undefined;
}

export function parseCliHookPayload(
	value: unknown,
): HookEventPayload | undefined {
	return parseHookEventPayload(value);
}

function isBooleanLikeAutoApproveValue(value: string | undefined): boolean {
	if (!value) {
		return false;
	}
	const normalized = value.trim().toLowerCase();
	return normalized === "true" || normalized === "false";
}

export function normalizeAutoApproveArgs(args: string[]): string[] {
	const normalized: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const token = args[index];
		if (token === "--autoapprove") {
			const nextToken = args[index + 1];
			if (isBooleanLikeAutoApproveValue(nextToken)) {
				normalized.push(token, nextToken);
				index += 1;
				continue;
			}
			normalized.push(token, "true");
			continue;
		}
		normalized.push(token);
	}
	return normalized;
}

export function parseArgs(args: string[]): ParsedArgs {
	const program = createProgram();
	try {
		program.parse(normalizeAutoApproveArgs(args), { from: "user" });
	} catch (_: unknown) {
		// exitOverride throws CommanderError on --help / --version; commander
		// handles output directly, and we treat the thrown error as a signal
		// to exit gracefully in the caller.
	}
	return commanderToParsedArgs(program);
}

export function resolveSandboxDataDir(
	cwd: string,
	explicitDir?: string,
): string {
	const envDir = process.env.CLINE_SANDBOX_DATA_DIR?.trim();
	const baseDir =
		explicitDir?.trim() || envDir || join(tmpdir(), "cline-sandbox");
	return resolve(cwd, baseDir);
}

export function configureSandboxEnvironment(options: {
	enabled: boolean;
	cwd: string;
	explicitDir?: string;
}): string | undefined {
	if (!options.enabled) {
		return undefined;
	}
	const dataDir = resolveSandboxDataDir(options.cwd, options.explicitDir);
	process.env.CLINE_SANDBOX = "1";
	process.env.CLINE_SANDBOX_DATA_DIR = dataDir;
	process.env.CLINE_DATA_DIR = dataDir;
	process.env.CLINE_SESSION_DATA_DIR = join(dataDir, "sessions");
	process.env.CLINE_TEAM_DATA_DIR = join(dataDir, "teams");
	process.env.CLINE_PROVIDER_SETTINGS_PATH = join(
		dataDir,
		"settings",
		"providers.json",
	);
	process.env.CLINE_HOOKS_LOG_PATH = join(dataDir, "hooks", "hooks.jsonl");
	return dataDir;
}
