import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import type {
	AgentExtension,
	AgentTool,
	GatewayModelSelection,
	HubScheduleCreateInput,
	HubScheduleUpdateInput,
	ScheduleExecutionRecord,
	ScheduleRecord,
} from "@cline/shared";
import {
	createTool,
	ONE_TIME_SCHEDULE_CRON_PATTERN,
	ONE_TIME_SCHEDULE_RUN_AT_METADATA_KEY,
} from "@cline/shared";
import { z } from "zod";
import type { ListSchedulesOptions } from "./schedule-service";

const ScheduleOperationSchema = z.enum([
	"create",
	"update",
	"list",
	"get",
	"pause",
	"resume",
	"delete",
	"run_now",
]);

const ModelSelectionSchema = z.object({
	provider_id: z.string().min(1),
	model_id: z.string().min(1).optional(),
});

export const SCHEDULE_TOOL_NAME = "schedule";

export const SCHEDULE_SYSTEM_PROMPT_RULE = `# Scheduled work

Use the \`schedule\` tool only when the user explicitly asks Cline to run work at a future time or on a recurrence.

- Keep schedules and Agenda items distinct. \`schedule\` starts autonomous sessions at a time or cadence. When available, \`todo_list\` records durable follow-ups, handoffs, ideas, and reminders that remain subject to Agenda review; \`available_at\` is not a timer.
- A phrase such as "remind me" is ambiguous. Use \`schedule\` when the user wants an agent to execute work at that time. Use \`todo_list\`, when available, when they want a reviewed note on their Agenda. Ask a concise clarifying question if the intended behavior, date, time, or timezone is unclear.
- Never create a schedule proactively and never create both a schedule and an Agenda item unless the user asks for both. Check existing schedules first when a duplicate is plausible.
- For a one-time schedule, provide an exact future ISO 8601 \`run_at\` with an offset or Z. For recurring work, provide a five-field \`cron_pattern\` and an IANA \`timezone\` when the user's timezone matters.
- Make the scheduled \`prompt\` self-contained because it will run in a new unattended session. Include the goal, constraints, expected output, and relevant project context.
- Inherit the current workspace and model unless the user explicitly requests a different model. Only update, pause, resume, delete, or run a schedule immediately when the user asks for that action.`;

export const ScheduleToolInputSchema = z.object({
	operation: ScheduleOperationSchema,
	schedule_id: z.string().min(1).optional(),
	schedule_type: z.enum(["once", "recurring"]).optional(),
	name: z.string().min(1).optional(),
	prompt: z.string().min(1).optional(),
	run_at: z.string().datetime({ offset: true }).optional(),
	cron_pattern: z.string().min(1).optional(),
	timezone: z.string().min(1).nullable().optional(),
	enabled: z.boolean().optional(),
	mode: z.enum(["act", "plan", "yolo"]).optional(),
	system_prompt: z.string().nullable().optional(),
	max_iterations: z.number().int().positive().nullable().optional(),
	timeout_seconds: z.number().int().positive().nullable().optional(),
	max_parallel: z.number().int().positive().max(32).optional(),
	tags: z.array(z.string().min(1)).optional(),
	model_selection: ModelSelectionSchema.optional(),
	limit: z.number().int().positive().max(200).optional(),
});

type ScheduleToolInput = z.infer<typeof ScheduleToolInputSchema>;

export interface ScheduleSessionDefaults {
	workspaceRoot: string;
	cwd?: string;
	modelSelection?: GatewayModelSelection;
	interactive: boolean;
}

export interface AgentScheduleServiceApi {
	createSchedule(input: HubScheduleCreateInput): ScheduleRecord;
	getSchedule(scheduleId: string): ScheduleRecord | undefined;
	listSchedules(options?: ListSchedulesOptions): ScheduleRecord[];
	updateSchedule(
		scheduleId: string,
		updates: HubScheduleUpdateInput,
	): ScheduleRecord | undefined;
	deleteSchedule(scheduleId: string): boolean;
	pauseSchedule(scheduleId: string): ScheduleRecord | undefined;
	resumeSchedule(scheduleId: string): ScheduleRecord | undefined;
	triggerScheduleNowDetached(
		scheduleId: string,
	): ScheduleExecutionRecord | undefined;
}

export interface CreateScheduleToolOptions {
	schedules: AgentScheduleServiceApi;
	resolveSessionDefaults: (
		sessionId: string,
	) => Promise<ScheduleSessionDefaults | undefined>;
	publish?: (
		event:
			| "schedule.created"
			| "schedule.updated"
			| "schedule.deleted"
			| "schedule.triggered",
		payload: Record<string, unknown>,
		sessionId: string,
	) => void;
}

type ScheduleToolResult =
	| {
			ok: true;
			operation: ScheduleToolInput["operation"];
			schedule?: ScheduleRecord;
			schedules?: ScheduleRecord[];
			execution?: ScheduleExecutionRecord;
			deleted?: boolean;
	  }
	| {
			ok: false;
			operation?: ScheduleToolInput["operation"];
			error: { code: string; message: string };
	  };

const MUTATING_OPERATIONS = new Set<ScheduleToolInput["operation"]>([
	"create",
	"update",
	"pause",
	"resume",
	"delete",
	"run_now",
]);

function requiredString(value: string | undefined, field: string): string {
	const normalized = value?.trim();
	if (!normalized) throw new Error(`${field} is required for this operation`);
	return normalized;
}

function canonicalExistingPath(value: string, field: string): string {
	try {
		const canonical = realpathSync.native(value);
		if (!statSync(canonical).isDirectory()) {
			throw new Error("not a directory");
		}
		return canonical;
	} catch {
		throw new Error(`${field} does not resolve to an existing safe path`);
	}
}

function sameWorkspace(left: string, right: string): boolean {
	try {
		return realpathSync.native(left) === realpathSync.native(right);
	} catch {
		return false;
	}
}

function assertPathWithin(
	workspaceRoot: string,
	candidate: string,
	field: string,
): void {
	const relativePath = relative(workspaceRoot, candidate);
	if (
		relativePath === ".." ||
		relativePath.startsWith(`..${sep}`) ||
		isAbsolute(relativePath)
	) {
		throw new Error(`${field} is outside the workspace scope`);
	}
}

function canonicalWorkspacePath(
	workspaceRoot: string,
	value: string,
	field: string,
): string {
	return canonicalExistingPath(
		isAbsolute(value) ? value : `${workspaceRoot}${sep}${value}`,
		field,
	);
}

function canonicalSessionDefaults(
	defaults: ScheduleSessionDefaults,
): ScheduleSessionDefaults {
	const workspaceRoot = canonicalExistingPath(
		defaults.workspaceRoot,
		"workspaceRoot",
	);
	const cwd = defaults.cwd
		? canonicalWorkspacePath(workspaceRoot, defaults.cwd, "cwd")
		: workspaceRoot;
	assertPathWithin(workspaceRoot, cwd, "cwd");
	return { ...defaults, workspaceRoot, cwd };
}

function assertScheduleScope(
	schedule: ScheduleRecord | undefined,
	defaults: ScheduleSessionDefaults,
): asserts schedule is ScheduleRecord {
	if (!schedule) throw new Error("schedule does not exist");
	if (!sameWorkspace(schedule.workspaceRoot, defaults.workspaceRoot)) {
		throw new Error("schedule is outside this session's workspace scope");
	}
	const scheduleWorkspaceRoot = canonicalExistingPath(
		schedule.workspaceRoot,
		"schedule workspaceRoot",
	);
	if (schedule.cwd) {
		const scheduleCwd = canonicalWorkspacePath(
			scheduleWorkspaceRoot,
			schedule.cwd,
			"schedule cwd",
		);
		assertPathWithin(scheduleWorkspaceRoot, scheduleCwd, "schedule cwd");
	}
}

function modelSelectionOf(
	value: ScheduleToolInput["model_selection"],
): GatewayModelSelection | undefined {
	if (!value) return undefined;
	return {
		providerId: value.provider_id.trim(),
		modelId: value.model_id?.trim() || undefined,
	};
}

function normalizedTags(tags: string[] | undefined): string[] | undefined {
	if (!tags) return undefined;
	return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}

function parseRunAt(value: string | undefined): number {
	const runAt = Date.parse(requiredString(value, "run_at"));
	if (!Number.isFinite(runAt))
		throw new Error("run_at must be an ISO timestamp");
	if (runAt <= Date.now()) throw new Error("run_at must be in the future");
	return runAt;
}

function createTiming(
	input: ScheduleToolInput,
): Pick<HubScheduleCreateInput, "cronPattern" | "timezone" | "metadata"> {
	if (input.schedule_type === "once") {
		if (input.cron_pattern) {
			throw new Error("cron_pattern cannot be used with a one-time schedule");
		}
		if (input.timezone) {
			throw new Error("timezone is encoded in run_at for a one-time schedule");
		}
		return {
			cronPattern: ONE_TIME_SCHEDULE_CRON_PATTERN,
			metadata: {
				[ONE_TIME_SCHEDULE_RUN_AT_METADATA_KEY]: parseRunAt(input.run_at),
			},
		};
	}
	if (input.schedule_type === "recurring") {
		if (input.run_at) {
			throw new Error("run_at cannot be used with a recurring schedule");
		}
		return {
			cronPattern: requiredString(input.cron_pattern, "cron_pattern"),
			timezone: input.timezone?.trim() || undefined,
		};
	}
	throw new Error("schedule_type is required for create");
}

function updateTiming(
	input: ScheduleToolInput,
): Pick<HubScheduleUpdateInput, "cronPattern" | "timezone" | "metadata"> {
	if (input.run_at && input.cron_pattern) {
		throw new Error("run_at and cron_pattern cannot be updated together");
	}
	if (input.schedule_type === "once" || input.run_at) {
		if (input.cron_pattern) {
			throw new Error("cron_pattern cannot be used with a one-time schedule");
		}
		if (input.timezone) {
			throw new Error("timezone is encoded in run_at for a one-time schedule");
		}
		return {
			cronPattern: ONE_TIME_SCHEDULE_CRON_PATTERN,
			timezone: null,
			metadata: {
				[ONE_TIME_SCHEDULE_RUN_AT_METADATA_KEY]: parseRunAt(input.run_at),
			},
		};
	}
	if (input.schedule_type === "recurring" || input.cron_pattern) {
		return {
			cronPattern: requiredString(input.cron_pattern, "cron_pattern"),
			timezone:
				input.timezone === null ? null : input.timezone?.trim() || undefined,
		};
	}
	return {
		timezone:
			input.timezone === null ? null : input.timezone?.trim() || undefined,
	};
}

function requireScheduleId(input: ScheduleToolInput): string {
	return requiredString(input.schedule_id, "schedule_id");
}

/**
 * Creates the Hub-backed scheduling tool available to interactive agent
 * sessions. The existing Hub schedule service remains the sole scheduler and
 * persistence boundary, so agent-created entries appear in Routine settings.
 */
export function createScheduleTool(
	options: CreateScheduleToolOptions,
): AgentTool<ScheduleToolInput, ScheduleToolResult> {
	return createTool({
		name: SCHEDULE_TOOL_NAME,
		description:
			"Create and manage timed or recurring agent runs in the current workspace. " +
			"Use only for explicit requests to execute work later; use todo_list for reviewed Agenda notes and follow-ups. " +
			"One-time schedules require an exact future ISO run_at. Recurring schedules require a five-field cron_pattern and may include an IANA timezone.",
		inputSchema: ScheduleToolInputSchema,
		retryable: false,
		maxRetries: 0,
		execute: async (rawInput, context) => {
			const parsed = ScheduleToolInputSchema.safeParse(rawInput);
			if (!parsed.success) {
				return {
					ok: false,
					error: {
						code: "invalid_schedule_input",
						message:
							parsed.error.issues[0]?.message ?? "Invalid schedule input",
					},
				};
			}
			const input = parsed.data;
			try {
				if (!context.sessionId) {
					throw new Error("schedule requires a Hub session");
				}
				const resolvedDefaults = await options.resolveSessionDefaults(
					context.sessionId,
				);
				if (!resolvedDefaults?.workspaceRoot.trim()) {
					throw new Error("schedule could not resolve the current workspace");
				}
				const defaults = canonicalSessionDefaults(resolvedDefaults);
				if (MUTATING_OPERATIONS.has(input.operation) && !defaults.interactive) {
					throw new Error(
						"schedule mutations require an interactive user session",
					);
				}

				switch (input.operation) {
					case "create": {
						const schedule = options.schedules.createSchedule({
							name: requiredString(input.name, "name"),
							...createTiming(input),
							prompt: requiredString(input.prompt, "prompt"),
							workspaceRoot: defaults.workspaceRoot,
							cwd: defaults.cwd,
							modelSelection:
								modelSelectionOf(input.model_selection) ??
								defaults.modelSelection,
							enabled: input.enabled,
							mode: input.mode ?? "yolo",
							systemPrompt: input.system_prompt ?? undefined,
							maxIterations: input.max_iterations ?? undefined,
							timeoutSeconds: input.timeout_seconds ?? undefined,
							maxParallel: input.max_parallel ?? 1,
							createdBy: `agent:${context.agentId}`,
							tags: normalizedTags(input.tags),
						});
						options.publish?.(
							"schedule.created",
							{ schedule },
							context.sessionId,
						);
						return { ok: true, operation: input.operation, schedule };
					}
					case "update": {
						const scheduleId = requireScheduleId(input);
						assertScheduleScope(
							options.schedules.getSchedule(scheduleId),
							defaults,
						);
						const schedule = options.schedules.updateSchedule(scheduleId, {
							scheduleId,
							...updateTiming(input),
							name: input.name?.trim() || undefined,
							prompt: input.prompt?.trim() || undefined,
							modelSelection: modelSelectionOf(input.model_selection),
							enabled: input.enabled,
							mode: input.mode,
							systemPrompt: input.system_prompt,
							maxIterations: input.max_iterations,
							timeoutSeconds: input.timeout_seconds,
							maxParallel: input.max_parallel,
							tags: normalizedTags(input.tags),
						});
						if (!schedule) throw new Error("schedule does not exist");
						options.publish?.(
							"schedule.updated",
							{ schedule },
							context.sessionId,
						);
						return { ok: true, operation: input.operation, schedule };
					}
					case "list": {
						const schedules = options.schedules
							.listSchedules({
								enabled: input.enabled,
								tags: normalizedTags(input.tags),
								workspaceRoot: defaults.workspaceRoot,
								limit: input.limit ?? 50,
							})
							.filter((schedule) => {
								try {
									assertScheduleScope(schedule, defaults);
									return true;
								} catch {
									return false;
								}
							})
							.slice(0, input.limit ?? 50);
						return { ok: true, operation: input.operation, schedules };
					}
					case "get": {
						const schedule = options.schedules.getSchedule(
							requireScheduleId(input),
						);
						assertScheduleScope(schedule, defaults);
						return { ok: true, operation: input.operation, schedule };
					}
					case "pause":
					case "resume": {
						const scheduleId = requireScheduleId(input);
						assertScheduleScope(
							options.schedules.getSchedule(scheduleId),
							defaults,
						);
						const schedule =
							input.operation === "pause"
								? options.schedules.pauseSchedule(scheduleId)
								: options.schedules.resumeSchedule(scheduleId);
						if (!schedule) throw new Error("schedule does not exist");
						options.publish?.(
							"schedule.updated",
							{ schedule },
							context.sessionId,
						);
						return { ok: true, operation: input.operation, schedule };
					}
					case "delete": {
						const scheduleId = requireScheduleId(input);
						assertScheduleScope(
							options.schedules.getSchedule(scheduleId),
							defaults,
						);
						const deleted = options.schedules.deleteSchedule(scheduleId);
						if (!deleted) throw new Error("schedule does not exist");
						options.publish?.(
							"schedule.deleted",
							{ deleted, scheduleId },
							context.sessionId,
						);
						return { ok: true, operation: input.operation, deleted };
					}
					case "run_now": {
						const scheduleId = requireScheduleId(input);
						assertScheduleScope(
							options.schedules.getSchedule(scheduleId),
							defaults,
						);
						const execution =
							options.schedules.triggerScheduleNowDetached(scheduleId);
						if (!execution) throw new Error("schedule does not exist");
						options.publish?.(
							"schedule.triggered",
							{ execution },
							context.sessionId,
						);
						return { ok: true, operation: input.operation, execution };
					}
				}
			} catch (error) {
				return {
					ok: false,
					operation: input.operation,
					error: {
						code: "schedule_operation_failed",
						message: error instanceof Error ? error.message : String(error),
					},
				};
			}
		},
	});
}

/** Adds scheduling guidance only when the paired schedule tool is enabled. */
export function createSchedulePromptExtension(): AgentExtension {
	return {
		name: "hub-schedule-guidance",
		manifest: { capabilities: ["rules"] },
		setup: (api) => {
			api.registerRule({
				id: "hub:schedule-guidance",
				content: SCHEDULE_SYSTEM_PROMPT_RULE,
				whenToolAvailable: SCHEDULE_TOOL_NAME,
			});
		},
	};
}
