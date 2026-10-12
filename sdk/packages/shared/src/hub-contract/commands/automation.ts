import { z } from "zod";
import {
	defineHubCommands,
	hubEmptyInput,
	hubObject,
	hubRecord,
} from "../define";

/**
 * Schedule, agenda task, and cron event commands.
 *
 * Handlers: `schedule.*` -> core/src/cron/service/schedule-command-service.ts,
 * `task.*` -> core/src/hub/server/task-command-service.ts (+ AgendaTaskManager
 * and SqliteAgendaTaskStore validation). `cron.event.*` have no Hub handler yet
 * (they fall through to the schedule service and get `unsupported_command`).
 */

// Mirrors HUB_SCHEDULE_MODES in hub.ts (not imported to avoid a cycle).
// readHubScheduleMode throws when `mode` is present but not one of these.
const scheduleMode = z.enum(["act", "plan", "yolo"]);

// Agenda task modes/types are enforced by SQLite CHECK constraints.
const taskMode = z.enum(["act", "plan", "yolo"]);
const taskType = z.enum([
	"suggestion",
	"follow-up",
	"todo",
	"handoff",
	"idea",
	"reminder",
]);
// Store rejects anything outside 0..5.
const taskPriority = z.number().int().min(0).max(5);

// GatewayModelSelection; handlers pass it through without validating keys.
const modelSelection = hubObject({
	providerId: z.string().optional(),
	modelId: z.string().optional(),
});

/** Cross-workspace access flag honored only for token-authorized clients. */
const scheduleScope = {
	allWorkspaces: z.boolean().optional(),
};

const scheduleIdInput = hubObject({
	scheduleId: z.string(),
	...scheduleScope,
});

const scheduleFields = {
	timezone: z.string().optional(),
	prompt: z.string().optional(),
	// Only honored with allWorkspaces; otherwise pinned to the client workspace.
	workspaceRoot: z.string().optional(),
	cwd: z.string().nullish(),
	modelSelection: modelSelection.optional(),
	// Legacy flat model fields; used when modelSelection is absent.
	provider: z.string().optional(),
	model: z.string().optional(),
	enabled: z.boolean().optional(),
	mode: scheduleMode.optional(),
	systemPrompt: z.string().optional(),
	maxIterations: z.number().optional(),
	timeoutSeconds: z.number().optional(),
	maxParallel: z.number().optional(),
	createdBy: z.string().optional(),
	tags: z.array(z.string()).optional(),
	runtimeOptions: hubRecord.optional(),
	// One-off schedules carry `__hubScheduleRunAt` (epoch ms) here.
	metadata: hubRecord.optional(),
	...scheduleScope,
};

const scheduleOutput = hubObject({ schedule: hubRecord.optional() });

const taskIdInput = hubObject({ taskId: z.string() });
const taskRevisionInput = hubObject({
	taskId: z.string(),
	expectedRevision: z.number().int().positive(),
});
const taskOutput = hubObject({ task: hubRecord });

const automationPolicyOutput = hubObject({ policy: hubRecord });

export const automationCommands = defineHubCommands({
	"schedule.create": {
		description:
			"Create a recurring or one-off schedule in the client workspace.",
		input: hubObject({
			// hubScheduleInputToCronSpec calls name.trim() / cronPattern.trim().
			name: z.string(),
			// "0" means one-off (requires metadata.__hubScheduleRunAt in the future).
			cronPattern: z.string(),
			...scheduleFields,
		}),
		output: hubObject({ schedule: hubRecord }),
	},
	"schedule.list": {
		description: "List schedules in the client workspace (or all workspaces).",
		input: hubObject({
			enabled: z.boolean().optional(),
			limit: z.number().optional(),
			tags: z.array(z.string()).optional(),
			...scheduleScope,
		}),
		output: hubObject({ schedules: z.array(hubRecord) }),
	},
	"schedule.get": {
		description: "Get one schedule by id.",
		input: scheduleIdInput,
		output: hubObject({ schedule: hubRecord }),
	},
	"schedule.update": {
		description: "Update fields of an existing schedule.",
		input: hubObject({
			scheduleId: z.string(),
			...scheduleFields,
			name: z.string().optional(),
			cronPattern: z.string().optional(),
			timezone: z.string().nullish(),
			systemPrompt: z.string().nullish(),
			maxIterations: z.number().nullish(),
			timeoutSeconds: z.number().nullish(),
			createdBy: z.string().nullish(),
		}),
		output: scheduleOutput,
	},
	"schedule.delete": {
		description: "Delete a schedule.",
		input: scheduleIdInput,
		output: hubObject({ deleted: z.boolean() }),
	},
	"schedule.enable": {
		description: "Resume (enable) a schedule.",
		input: scheduleIdInput,
		output: scheduleOutput,
	},
	"schedule.disable": {
		description: "Pause (disable) a schedule.",
		input: scheduleIdInput,
		output: scheduleOutput,
	},
	"schedule.trigger": {
		description:
			"Run a schedule now, optionally without waiting for completion.",
		input: hubObject({
			scheduleId: z.string(),
			// false queues the run and returns immediately.
			wait: z.boolean().optional(),
			...scheduleScope,
		}),
		output: hubObject({ execution: hubRecord.nullish() }),
	},
	"schedule.list_executions": {
		description: "List schedule executions, optionally for one schedule.",
		input: hubObject({
			scheduleId: z.string().optional(),
			// TODO(contract): ScheduleExecutionStatus values; handler passes any string.
			status: z.string().optional(),
			limit: z.number().optional(),
			...scheduleScope,
		}),
		output: hubObject({ executions: z.array(hubRecord) }),
	},
	"schedule.stats": {
		description: "Get execution statistics for one schedule.",
		input: scheduleIdInput,
		output: hubObject({ stats: hubRecord.nullish() }),
	},
	"schedule.active": {
		description: "List currently running schedule executions.",
		input: hubObject({ ...scheduleScope }),
		output: hubObject({ executions: z.array(hubRecord) }),
	},
	"schedule.upcoming": {
		description: "List upcoming scheduled runs.",
		input: hubObject({
			limit: z.number().optional(),
			...scheduleScope,
		}),
		output: hubObject({ runs: z.array(hubRecord) }),
	},
	"task.create": {
		description: "Create a user-authored agenda task in the client workspace.",
		input: hubObject({
			taskId: z.string().optional(),
			type: taskType,
			title: z.string(),
			description: z.string().optional(),
			instructions: z.string(),
			// scope/workspaceRoot/cwd/requiresApproval/createdBy are overridden by the Hub.
			scope: z.string().optional(),
			workspaceRoot: z.string().optional(),
			cwd: z.string().optional(),
			resourcePaths: z.array(z.string()).optional(),
			priority: taskPriority.optional(),
			assignee: z.string().optional(),
			modelSelection: modelSelection.optional(),
			mode: taskMode.optional(),
			systemPrompt: z.string().optional(),
			maxIterations: z.number().nullish(),
			timeoutSeconds: z.number().nullish(),
			availableAt: z.string().optional(),
			// Must be a future ISO-8601 timestamp.
			expiresAt: z.string(),
			automationEligible: z.boolean().optional(),
			requiresApproval: z.boolean().optional(),
			originSessionId: z.string().optional(),
			originTaskId: z.string().optional(),
			specPath: z.string().optional(),
		}),
		output: taskOutput,
	},
	"task.list": {
		description: "List workspace and global agenda tasks.",
		input: hubObject({
			// TODO(contract): AgendaTaskStatus / AgendaTaskType values; kept as
			// strings so newer peers' filter values do not fail validation.
			statuses: z.array(z.string()).optional(),
			types: z.array(z.string()).optional(),
			// scope/workspaceRoot are overridden by the Hub.
			scope: z.string().optional(),
			workspaceRoot: z.string().optional(),
			priorities: z.array(z.number()).optional(),
			automationEligible: z.boolean().optional(),
			availableBefore: z.string().optional(),
			includeArchived: z.boolean().optional(),
			limit: z.number().optional(),
		}),
		output: hubObject({ tasks: z.array(hubRecord) }),
	},
	"task.get": {
		description: "Get one agenda task by id.",
		input: taskIdInput,
		output: hubObject({ task: hubRecord.optional() }),
	},
	"task.update": {
		description: "Edit an agenda task at an expected revision.",
		input: hubObject({
			taskId: z.string(),
			expectedRevision: z.number(),
			type: taskType.optional(),
			title: z.string().optional(),
			description: z.string().nullish(),
			instructions: z.string().optional(),
			// scope/workspaceRoot/cwd/updatedBy are overridden by the Hub.
			scope: z.string().optional(),
			workspaceRoot: z.string().nullish(),
			cwd: z.string().nullish(),
			resourcePaths: z.array(z.string()).optional(),
			priority: taskPriority.optional(),
			assignee: z.string().nullish(),
			modelSelection: modelSelection.nullish(),
			mode: taskMode.nullish(),
			systemPrompt: z.string().nullish(),
			maxIterations: z.number().nullish(),
			timeoutSeconds: z.number().nullish(),
			availableAt: z.string().optional(),
			expiresAt: z.string().optional(),
			automationEligible: z.boolean().optional(),
		}),
		output: taskOutput,
	},
	"task.approve": {
		description: "Approve an agenda task at an expected revision.",
		input: taskRevisionInput,
		output: taskOutput,
	},
	"task.cancel": {
		description: "Cancel an agenda task at an expected revision.",
		input: hubObject({
			taskId: z.string(),
			expectedRevision: z.number().int().positive(),
			reason: z.string().optional(),
		}),
		output: taskOutput,
	},
	"task.run": {
		description: "Start a run of an approved agenda task.",
		input: taskRevisionInput,
		output: hubObject({ task: hubRecord, run: hubRecord.optional() }),
	},
	"task.automation.get": {
		description: "Get the agenda automation policy for the client workspace.",
		input: hubEmptyInput,
		output: automationPolicyOutput,
	},
	"task.automation.set": {
		description: "Set the agenda automation policy for the client workspace.",
		input: hubObject({
			policy: hubObject({
				// scopeKey is overridden by the Hub; enabledBy/enabledAt by the manager.
				scopeKey: z.string().optional(),
				// NOT NULL columns: missing values fail the SQLite insert.
				mode: z.enum(["manual", "auto_start", "unattended"]),
				applyToAgentCreated: z.boolean().optional(),
				maxConcurrentRuns: z.number().int().positive(),
				maxChainDepth: z.number().int().positive(),
				maxStartsPerHour: z.number().int().positive(),
				enabledBy: hubRecord.optional(),
				enabledAt: z.string().optional(),
			}),
		}),
		output: automationPolicyOutput,
	},
	"cron.event.ingest": {
		description: "Ingest a normalized automation event (no Hub handler yet).",
		// TODO(contract): no Hub handler or sender exists; shape follows
		// AutomationEventEnvelope but nothing is required until one does.
		input: hubObject({
			eventId: z.string().optional(),
			eventType: z.string().optional(),
			source: z.string().optional(),
			subject: z.string().optional(),
			occurredAt: z.string().optional(),
			workspaceRoot: z.string().optional(),
			payload: z.unknown().optional(),
			attributes: hubRecord.optional(),
			dedupeKey: z.string().optional(),
		}),
	},
	"cron.event.list": {
		description: "List ingested automation events (no Hub handler yet).",
		// TODO(contract): no Hub handler or sender exists.
		input: hubObject({
			limit: z.number().optional(),
		}),
	},
	"cron.event.get": {
		description: "Get one ingested automation event (no Hub handler yet).",
		// TODO(contract): no Hub handler or sender exists.
		input: hubObject({
			eventId: z.string().optional(),
		}),
	},
});
