import {
	createFactoryWorkflowRecipe,
	FACTORY_GUIDANCE_ROLES,
} from "@cline/core";
import {
	type FactoryWorkflowRecipe,
	factoryDesignProgressSchema,
	factoryDesignReviewSchema,
	factoryQuestionSchema,
	factoryRunStateSchema,
	factoryStageSchema,
	factoryTaskConfigSchema,
	factoryVerificationProfileSchema,
	isFactoryHandsOff,
} from "@cline/shared";
import { z } from "zod";
import {
	currentFactoryRunState,
	factoryAttentionOutcome,
	factoryAttentionReasons,
	isFactoryRuleCard,
} from "../webview/lib/factory-attention";
import {
	FACTORY_CONCURRENCY_MAX,
	FACTORY_CONCURRENCY_MIN,
	FACTORY_DAILY_COST_DEFAULT_USD,
	FACTORY_DAILY_COST_MAX_USD,
	type FactoryLimits,
} from "../webview/lib/factory-limits";
import {
	type FactoryPresetSettings,
	factoryPresetSchema,
	HANDS_OFF_PRESET_NAME,
} from "../webview/lib/factory-presets";
import {
	missingDefaultFactoryWorkflow,
	readDesktopSettings,
	resolveDefaultFactoryWorkflow,
	withBuiltInFactoryPresets,
	writeDesktopSettings,
} from "./desktop-settings";
import { readFactoryDiff } from "./factory-review";
import type { JsonRecord, SidecarContext } from "./types";

type FactoryCommand =
	| "factory_save_preset"
	| "factory_attention"
	| "factory_get_diff";
type ReadTask = (
	command: "task.list" | "task.get",
	args: JsonRecord,
) => Promise<unknown>;
/** Sends `task.factory.defaults.set`; `null` clears the Hub's default. */
export type SetFactoryDefaults = (
	workflow: FactoryWorkflowRecipe | null,
) => Promise<unknown>;

/**
 * Tells the Hub which workflow new Factory work uses, so cards started outside
 * the desktop (CLI, agents) follow the user's choice. A default that is missing
 * or invalid is reported through `onInvalidDefault` and replaced by the
 * built-in Hands-off workflow, as Desktop intake does; a failed send rejects.
 */
export async function pushFactoryDefaultWorkflow(
	setDefaults: SetFactoryDefaults,
	settings: FactoryPresetSettings = readDesktopSettings(),
	onInvalidDefault?: (error: unknown) => void,
): Promise<FactoryWorkflowRecipe | null> {
	const missing = missingDefaultFactoryWorkflow(settings);
	if (missing) onInvalidDefault?.(new Error(missing));
	const workflow = resolveDefaultFactoryWorkflow(settings) ?? null;
	await setDefaults(workflow);
	return workflow;
}

/**
 * Runs `push` once per connection key, before the first command that needs
 * it. A failed push is reported and forgotten, so the next command on the
 * same connection retries it. The returned promise never rejects.
 */
export function oncePerConnection<K extends object, C = undefined>(
	push: (key: K, context: C) => Promise<unknown>,
	onError: (error: unknown, context: C) => void,
): (key: K, context: C) => Promise<void> {
	const done = new WeakMap<K, Promise<void>>();
	return (key, context) => {
		let pending = done.get(key);
		if (!pending) {
			const attempt: Promise<void> = Promise.resolve()
				.then(() => push(key, context))
				.then(
					() => undefined,
					(error: unknown) => {
						if (done.get(key) === attempt) done.delete(key);
						onError(error, context);
					},
				);
			pending = attempt;
			done.set(key, pending);
		}
		return pending;
	};
}

/** One Hub command through the shared, trusted Hub client. */
export type SendHubCommand = (
	command:
		| "task.factory.limits.get"
		| "task.factory.limits.set"
		| "task.factory.stages.get"
		| "task.factory.stages.set"
		| FactorySettingsHubCommand,
	input: JsonRecord,
) => Promise<{
	ok: boolean;
	payload?: Record<string, unknown>;
	error?: { code?: string; message?: string };
}>;

const factoryConcurrencySchema = z
	.number()
	.int()
	.min(FACTORY_CONCURRENCY_MIN)
	.max(FACTORY_CONCURRENCY_MAX);

/**
 * The limits the Hub reports (see FactoryLimits for `paused` and cost), and
 * whether new filings are checked for duplicates (absent from older Hubs).
 */
export type FactoryLimitsReply =
	| (Extract<FactoryLimits, { supported: true }> & { duplicateCheck?: boolean })
	| Extract<FactoryLimits, { supported: false }>;

const factoryDailyCostSchema = z
	.number()
	.finite()
	.min(0)
	.max(FACTORY_DAILY_COST_MAX_USD)
	.nullable();

const factoryLimitsSetSchema = z
	.object({
		concurrency: factoryConcurrencySchema.optional(),
		paused: z.boolean().optional(),
		dailyCostUsd: factoryDailyCostSchema.optional(),
		duplicateCheck: z.boolean().optional(),
	})
	.refine(
		(value) =>
			value.concurrency !== undefined ||
			value.paused !== undefined ||
			value.dailyCostUsd !== undefined ||
			value.duplicateCheck !== undefined,
		{
			message:
				"Send concurrency, paused, dailyCostUsd, duplicateCheck or a combination",
		},
	);

/**
 * Reads or sets how much Factory work the Hub runs at once, whether new work
 * is paused, and the daily spending limit across all Factory work
 * (`dailyCostUsd`, `null` = no limit; `get` also returns `spentTodayUsd`).
 * The Hub owns and persists all of them. A Hub that predates the limits
 * answers `unsupported_command`, which is reported as `supported: false`
 * rather than as an error; a Hub that predates the daily limit omits both
 * cost fields, so the reply omits them too and the app reads the daily limit
 * as unsupported. A Hub that reports spending but no limit field uses the
 * default daily limit.
 */
export async function handleFactoryLimitsCommand(
	command: "factory_get_limits" | "factory_set_limits",
	args: JsonRecord | undefined,
	send: SendHubCommand,
): Promise<FactoryLimitsReply> {
	const setting = command === "factory_set_limits";
	const input: JsonRecord = {};
	if (setting) {
		const { concurrency, paused, dailyCostUsd, duplicateCheck } =
			factoryLimitsSetSchema.parse(args ?? {});
		if (concurrency !== undefined) input.concurrency = concurrency;
		if (duplicateCheck !== undefined) input.duplicateCheck = duplicateCheck;
		if (paused !== undefined) input.paused = paused;
		// One meaning everywhere: null is "no daily limit", and 0 says the same.
		if (dailyCostUsd !== undefined)
			input.dailyCostUsd = dailyCostUsd === 0 ? null : dailyCostUsd;
	}
	const reply = await send(
		setting ? "task.factory.limits.set" : "task.factory.limits.get",
		input,
	);
	if (!reply.ok) {
		if (reply.error?.code === "unsupported_command")
			return { supported: false };
		const reason = reply.error?.message ?? "the Hub did not answer";
		throw new Error(
			setting
				? `Factory could not change ${input.dailyCostUsd !== undefined ? "the daily spending limit" : input.duplicateCheck !== undefined ? "the duplicate check" : "how much work runs at once"}: ${reason}`
				: `Factory could not read how much work runs at once: ${reason}`,
		);
	}
	const { concurrency, paused, dailyCostUsd, spentTodayUsd, duplicateCheck } = z
		.object({
			concurrency: z.number().int().positive(),
			paused: z.boolean().optional(),
			// Malformed cost fields read as unsupported rather than failing.
			dailyCostUsd: z
				.number()
				.finite()
				.min(0)
				.nullable()
				.optional()
				.catch(undefined),
			spentTodayUsd: z.number().finite().min(0).optional().catch(undefined),
			duplicateCheck: z.boolean().optional().catch(undefined),
		})
		.parse(reply.payload);
	const daily =
		dailyCostUsd !== undefined
			? dailyCostUsd
			: spentTodayUsd !== undefined
				? FACTORY_DAILY_COST_DEFAULT_USD
				: undefined;
	return {
		supported: true,
		concurrency,
		...(paused !== undefined ? { paused } : {}),
		...(daily !== undefined ? { dailyCostUsd: daily } : {}),
		...(daily !== undefined && spentTodayUsd !== undefined
			? { spentTodayUsd }
			: {}),
		...(duplicateCheck !== undefined ? { duplicateCheck } : {}),
	};
}

const factoryStagesListingSchema = z.object({
	file: z.enum(["absent", "present", "invalid"]),
	reason: z.string().optional(),
	stages: z.array(
		z.object({
			// Shared schemas use their own zod, so they parse inside a transform.
			stage: z.unknown().transform((value) => factoryStageSchema.parse(value)),
			hash: z.string(),
			status: z.enum(["approved", "needs_approval", "changed", "declined"]),
		}),
	),
});
/** A project's repository stages (`.cline/factory/stages.json`) and their trust status. */
export type FactoryStagesListing =
	| z.infer<typeof factoryStagesListingSchema>
	| { supported: false };

/**
 * Reads a project's repository stages, or records the person's decision
 * on one (`approved`, `declined`, or `undecided` to forget it) for exactly
 * the definition whose hash they saw. The Hub reads the user's checkout
 * and owns the decisions; a Hub that predates stages reports
 * `supported: false`.
 */
export async function handleFactoryStagesCommand(
	command: "factory_get_stages" | "factory_decide_stage",
	args: JsonRecord | undefined,
	send: SendHubCommand,
): Promise<FactoryStagesListing> {
	const deciding = command === "factory_decide_stage";
	const input = deciding
		? z
				.object({
					workspaceRoot: z.string().trim().min(1),
					stageId: z.string().trim().min(1),
					expectedHash: z.string().regex(/^[0-9a-f]{64}$/),
					decision: z.enum(["approved", "declined", "undecided"]),
				})
				.strict()
				.parse(args ?? {})
		: z
				.object({ workspaceRoot: z.string().trim().min(1) })
				.strict()
				.parse(args ?? {});
	const reply = await send(
		deciding ? "task.factory.stages.set" : "task.factory.stages.get",
		input,
	);
	if (!reply.ok) {
		if (reply.error?.code === "unsupported_command")
			return { supported: false };
		throw new Error(
			`Factory could not ${deciding ? "save the decision on the repository stage" : "read the repository stages"}: ${reply.error?.message ?? "the Hub did not answer"}`,
		);
	}
	return factoryStagesListingSchema.parse(
		deciding
			? z.object({ listing: z.unknown() }).parse(reply.payload).listing
			: reply.payload,
	);
}

const factoryListTaskSchema = z.object({
	taskId: z.string(),
	factoryQuestions: z
		.unknown()
		.transform((value) => factoryQuestionSchema.array().parse(value))
		.optional(),
	originSessionId: z.string().optional(),
	status: z.string(),
	archivedAt: z.string().optional(),
	error: z.string().optional(),
	updatedAt: z.string().optional(),
	factoryDesignProgress: z
		.unknown()
		.transform((value) => factoryDesignProgressSchema.parse(value))
		.optional(),
	factoryDesignReview: z
		.unknown()
		.transform((value) => factoryDesignReviewSchema.parse(value))
		.optional(),
	instructions: z.string(),
	revision: z.number(),
	lastRunId: z.string().optional(),
	currentRunId: z.string().optional(),
	workspaceRoot: z.string().optional(),
	factory: z
		.unknown()
		.transform((value) => factoryTaskConfigSchema.parse(value))
		.optional(),
});
type FactoryListTask = z.infer<typeof factoryListTaskSchema>;
/** Each task is read on its own, so one malformed card cannot hide the rest. */
const tasksReplySchema = z.object({ tasks: z.array(z.unknown()) });

/** A Factory card whose stored data failed validation. */
export type FactoryUnreadableCard = {
	taskId: string;
	revision?: number;
	factoryNumber?: number;
	reason: string;
};

const FACTORY_UNREADABLE_REASON_MAX = 120;

/**
 * A one-line reason for a card that could not be read: the first field that
 * failed and why, never the raw validation output.
 */
export function factoryUnreadableReason(error: unknown): string {
	// Validation errors may come from another copy of zod (@cline/shared), so
	// they are recognised by shape.
	const issues = (error as { issues?: unknown } | undefined)?.issues;
	const issue = Array.isArray(issues)
		? (issues[0] as { path: (string | number)[]; message: string } | undefined)
		: undefined;
	const reason = issue
		? `${issue.path.length ? `${issue.path.join(".")}: ` : ""}${issue.message}`
		: error instanceof Error
			? error.message.split("\n")[0]
			: String(error);
	return reason.length > FACTORY_UNREADABLE_REASON_MAX
		? `${reason.slice(0, FACTORY_UNREADABLE_REASON_MAX - 1)}…`
		: reason;
}

function readFactoryListTasks(
	reply: unknown,
	onUnreadable: (card: FactoryUnreadableCard, error: unknown) => void,
): FactoryListTask[] {
	return tasksReplySchema.parse(reply).tasks.flatMap((raw) => {
		try {
			return [factoryListTaskSchema.parse(raw)];
		} catch (error) {
			const record =
				raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
			// Only live Factory cards with an id are shown; other tasks are not ours.
			if (
				typeof record.taskId === "string" &&
				record.factory !== undefined &&
				!record.archivedAt
			)
				onUnreadable(
					{
						taskId: record.taskId,
						...(typeof record.revision === "number"
							? { revision: record.revision }
							: {}),
						...(typeof record.factoryNumber === "number"
							? { factoryNumber: record.factoryNumber }
							: {}),
						reason: factoryUnreadableReason(error),
					},
					error,
				);
			return [];
		}
	});
}

const runsReplySchema = z.object({
	runs: z
		.array(
			z.object({
				runId: z.string(),
				taskRevision: z.number(),
				createdAt: z.string().optional(),
				status: z.string().optional(),
				factory: z
					.unknown()
					.transform((value) => factoryRunStateSchema.parse(value))
					.optional(),
			}),
		)
		.default([]),
});

type FactoryRuns = z.infer<typeof runsReplySchema>;

/** A card's runs are read again after this long even with no Hub event for it. */
const FACTORY_RUNS_CACHE_MS = 60_000;
const ACTIVE_RUN_STATUSES = new Set(["starting", "running"]);

/**
 * Runs read for the attention sweep, per card. An entry is used while the
 * card's revision, status and run are unchanged, its run is not in progress,
 * and no Hub task event named the card since it was read.
 */
const factoryRunsCache = new Map<
	string,
	{ key: string; runs: FactoryRuns; at: number }
>();
let factoryRunsEpoch = 0;
let factoryRunsClearedAt = 0;
const factoryRunsForgotten = new Map<string, number>();

/** Drops one card's cached runs (a Hub task event), or all of them. */
export function forgetFactoryRuns(taskId?: string): void {
	factoryRunsEpoch++;
	if (taskId === undefined) {
		factoryRunsCache.clear();
		factoryRunsForgotten.clear();
		factoryRunsClearedAt = factoryRunsEpoch;
		return;
	}
	factoryRunsCache.delete(taskId);
	factoryRunsForgotten.set(taskId, factoryRunsEpoch);
}

async function readFactoryRuns(
	task: Pick<
		FactoryListTask,
		"taskId" | "revision" | "status" | "currentRunId" | "lastRunId"
	>,
	readTask: ReadTask,
): Promise<FactoryRuns> {
	const runId = task.currentRunId ?? task.lastRunId;
	const key = `${task.revision}:${task.status}:${runId}`;
	const cached = factoryRunsCache.get(task.taskId);
	if (cached?.key === key && Date.now() - cached.at < FACTORY_RUNS_CACHE_MS)
		return cached.runs;
	const epoch = factoryRunsEpoch;
	const runs = runsReplySchema.parse(
		await readTask("task.get", { taskId: task.taskId, allWorkspaces: true }),
	);
	const run = runs.runs.find((item) => item.runId === runId);
	const forgotten = Math.max(
		factoryRunsClearedAt,
		factoryRunsForgotten.get(task.taskId) ?? 0,
	);
	if (run?.status && !ACTIVE_RUN_STATUSES.has(run.status) && forgotten <= epoch)
		factoryRunsCache.set(task.taskId, { key, runs, at: Date.now() });
	else factoryRunsCache.delete(task.taskId);
	return runs;
}

let factoryAttentionRunning: Promise<unknown> | undefined;
let factoryAttentionNext: Promise<unknown> | undefined;

/**
 * One attention sweep at a time: callers that arrive while one runs (a burst
 * of task events, several views) share the single sweep that follows it.
 */
function coalesceFactoryAttention(
	sweep: () => Promise<unknown>,
): Promise<unknown> {
	if (!factoryAttentionRunning) {
		const running = sweep().finally(() => {
			if (factoryAttentionRunning === running)
				factoryAttentionRunning = undefined;
		});
		factoryAttentionRunning = running;
		return running;
	}
	factoryAttentionNext ??= factoryAttentionRunning
		.catch(() => undefined)
		.then(() => {
			factoryAttentionNext = undefined;
			return coalesceFactoryAttention(sweep);
		});
	return factoryAttentionNext;
}

export async function handleFactoryCommand(
	ctx: Pick<SidecarContext, "pendingQuestions" | "logger">,
	command: FactoryCommand,
	args: JsonRecord | undefined,
	readTask: ReadTask,
	setFactoryDefaults?: SetFactoryDefaults,
): Promise<unknown> {
	if (command === "factory_save_preset") {
		const { useByDefault, ...preset } = factoryPresetSchema
			.extend({ useByDefault: z.boolean().optional() })
			.parse(args);
		// Imported recipes keep their revision only if it matches the config.
		const recipe = createFactoryWorkflowRecipe(preset);
		if (preset.revision && preset.revision !== recipe.revision)
			throw new Error("Workflow revision does not match its configuration");
		const settings = readDesktopSettings();
		const presets = settings.factoryPresets ?? [];
		const next = [
			...presets.filter((item) => item.name !== recipe.name),
			recipe,
		];
		// A profile still on the built-in default keeps it when it saves its
		// first workflow, unless that workflow becomes the default.
		let factoryDefaultPreset =
			withBuiltInFactoryPresets(settings).factoryDefaultPreset;
		if (useByDefault === true) factoryDefaultPreset = preset.name;
		else if (useByDefault === false && factoryDefaultPreset === preset.name)
			factoryDefaultPreset = undefined;
		// Saving a workflow is an explicit choice, so the one-time hands-off
		// upgrade must never rewrite it afterwards.
		const saved = {
			...settings,
			factoryPresets: next,
			factoryDefaultPreset,
			factoryHandsOffUpgradeApplied: true,
		};
		writeDesktopSettings(saved);
		if (setFactoryDefaults)
			try {
				await pushFactoryDefaultWorkflow(setFactoryDefaults, saved);
			} catch (error) {
				throw new Error(
					`Saved “${recipe.name}”, but Factory could not update the default workflow for new work: ${error instanceof Error ? error.message : String(error)}. Save again to retry.`,
				);
			}
		return withBuiltInFactoryPresets(saved).factoryPresets;
	}
	const unreadable: FactoryUnreadableCard[] = [];
	const reportUnreadable = (card: FactoryUnreadableCard, error: unknown) => {
		unreadable.push(card);
		ctx.logger?.log("Factory card could not be read", {
			taskId: card.taskId,
			reason: card.reason,
			error: error instanceof Error ? error.message : String(error),
		});
	};
	const list = async () =>
		readFactoryListTasks(
			await readTask("task.list", {
				allWorkspaces: true,
				includeArchived: true,
				limit: 200,
			}),
			reportUnreadable,
		);
	if (command === "factory_get_diff") {
		const input = z
			.object({
				taskId: z.string().min(1),
				runId: z.string().min(1),
				expectedCommit: z.string().min(1),
			})
			.parse(args);
		return readFactoryDiff(
			await readTask("task.get", {
				taskId: input.taskId,
				allWorkspaces: true,
			}),
			input.runId,
			input.expectedCommit,
		);
	}
	return coalesceFactoryAttention(async () => {
		const pending = [...ctx.pendingQuestions.values()].map(
			(question) => question.item,
		);
		const tasks = (await list()).flatMap(({ factory, ...task }) =>
			factory && !task.archivedAt ? [{ ...task, factory }] : [],
		);
		const items = await Promise.all(
			tasks.map(async (task) => {
				try {
					return await factoryAttentionItem(task);
				} catch (error) {
					// One card's bad run data never hides the others.
					reportUnreadable(
						{
							taskId: task.taskId,
							revision: task.revision,
							reason: factoryUnreadableReason(error),
						},
						error,
					);
					return undefined;
				}
			}),
		);
		return [
			...items.filter((item) => item !== undefined),
			...unreadable.map((card) => ({
				taskId: card.taskId,
				revision: card.revision,
				questions: [],
				needsAttention: false,
				unreadable: { reason: card.reason },
			})),
		];
		async function factoryAttentionItem(task: (typeof tasks)[number]) {
			// An approved hands-off card with an earlier run may be waiting on its
			// automatic retry, which only that run records. Other approved cards
			// have no outcome to read, so they cost no extra request.
			const { runs } =
				(task.currentRunId || task.lastRunId) &&
				([
					"in_progress",
					"completed",
					"failed",
					"cancelled",
					"expired",
				].includes(task.status) ||
					(task.status === "approved" &&
						Boolean(task.lastRunId) &&
						isFactoryHandsOff(task.factory)) ||
					pending.length > 0)
					? await readFactoryRuns(task, readTask)
					: { runs: [] };
			const run = runs.find(
				(run) => run.runId === (task.currentRunId ?? task.lastRunId),
			);
			const state = currentFactoryRunState(task, run);
			const reasons = factoryAttentionReasons(task, state, runs);
			const closed = task.status === "cancelled" || task.status === "expired";
			const sessions = new Set([
				task.originSessionId,
				...(run?.factory?.sessions.map((session) => session.sessionId) ?? []),
			]);
			const questions = closed
				? []
				: [
						...pending.filter((question) => sessions.has(question.sessionId)),
						...reasons.flatMap((reason) =>
							reason.kind === "question"
								? [
										{
											requestId: reason.question.questionId,
											sessionId: reason.question.sessionId,
											createdAt: reason.question.createdAt,
											question: reason.question.question,
											options: reason.question.options ?? [],
										},
									]
								: [],
						),
					];
			const needsAttention = questions.length > 0 || reasons.length > 0;
			return {
				taskId: task.taskId,
				revision: task.revision,
				runId: state ? run?.runId : undefined,
				questions,
				needsAttention,
				// Filed by Factory for a recurring review pattern.
				...(isFactoryRuleCard(task) ? { ruleCard: true } : {}),
				outcome: state ? factoryAttentionOutcome(task, state, runs) : undefined,
			};
		}
	});
}

// ---------------------------------------------------------------------------
// Factory settings: pass-throughs to the Hub's task.factory.* settings
// commands. Each answers `{ supported: false }` on a Hub that predates it.
// Writes answer `{ supported: true, ok: true, ... }`, or for a refusal the
// person can act on (a stale hash, a refused or invalid text, ...)
// `{ supported: true, ok: false, error: { code, message, currentHash? } }`;
// any other failure throws.

export type FactorySettingsCommand =
	| "factory_get_guidance"
	| "factory_get_guidance_history"
	| "factory_set_guidance"
	| "factory_resolve_guidance"
	| "factory_get_verification"
	| "factory_set_verification"
	| "factory_get_storage"
	| "factory_clean_storage"
	| "factory_reset"
	| "factory_get_projects";

export type FactorySettingsHubCommand =
	| "task.factory.guidance.get"
	| "task.factory.guidance.history"
	| "task.factory.guidance.set"
	| "task.factory.guidance.resolve"
	| "task.factory.verification.get"
	| "task.factory.verification.set"
	| "task.factory.storage.get"
	| "task.factory.storage.clean"
	| "task.factory.reset"
	| "task.factory.projects.get";

export const FACTORY_SETTINGS_COMMANDS: readonly FactorySettingsCommand[] = [
	"factory_get_guidance",
	"factory_get_guidance_history",
	"factory_set_guidance",
	"factory_resolve_guidance",
	"factory_get_verification",
	"factory_set_verification",
	"factory_get_storage",
	"factory_clean_storage",
	"factory_reset",
	"factory_get_projects",
];

export function isFactorySettingsCommand(
	command: string,
): command is FactorySettingsCommand {
	return (FACTORY_SETTINGS_COMMANDS as readonly string[]).includes(command);
}

const guidanceRoleSchema = z.enum(FACTORY_GUIDANCE_ROLES);
const guidanceHashSchema = z.string().regex(/^[0-9a-f]{16}$/);
const profileHashSchema = z.string().regex(/^[0-9a-f]{64}$/);
/** A project path; the Hub accepts only a project Factory knows. */
const workspaceRootSchema = z.string().trim().min(1).max(4096);
/** Shared schemas use their own zod, so they parse inside a transform. */
const verificationProfileSchema = z
	.unknown()
	.transform((value) => factoryVerificationProfileSchema.parse(value));

const guidanceScopeSchema = z.object({
	status: z.enum(["none", "current", "changed", "invalid"]),
	content: z.string(),
	hash: z.string(),
	path: z.string().optional(),
	truncated: z.literal(true).optional(),
	reason: z.string().optional(),
	acceptedHash: z.string().optional(),
	acceptedContent: z.string().optional(),
});
const guidanceTargetSchema = z.object({
	role: guidanceRoleSchema,
	user: guidanceScopeSchema,
	repository: guidanceScopeSchema
		.extend({
			accepted: z.boolean(),
			inUse: z.boolean(),
			needsAcceptance: z.boolean(),
		})
		.optional(),
});
const guidanceSettingsSchema = z.object({
	maxChars: z.number(),
	userScope: z.boolean(),
	managerReadmeDefault: z.string(),
	workspaceRoot: z.string().optional(),
	targets: z.array(guidanceTargetSchema),
});
const guidanceHistoryEntrySchema = z.object({
	id: z.string(),
	time: z.string(),
	role: guidanceRoleSchema,
	scope: z.enum(["user", "repository"]),
	workspaceRoot: z.string().optional(),
	note: z.string(),
	hashBefore: z.string(),
	hashAfter: z.string(),
	before: z.string(),
	after: z.string(),
	source: z
		.union([
			z.object({
				kind: z.literal("feedback"),
				taskId: z.string(),
				factoryNumber: z.number().optional(),
			}),
			z.object({ kind: z.literal("settings") }),
		])
		.optional(),
});
const verificationSettingsSchema = z.object({
	workspaceRoot: z.string(),
	file: z.enum(["absent", "present", "invalid"]),
	reason: z.string().optional(),
	status: z.enum(["none", "proposed", "in_use", "changed", "invalid"]),
	profile: verificationProfileSchema.optional(),
	hash: z.string().optional(),
	origin: z.enum(["repository", "approved_local", "proposed"]).optional(),
	approved: z
		.object({
			profile: verificationProfileSchema,
			hash: z.string(),
			provenAt: z.string().optional(),
		})
		.optional(),
	proposedBy: z
		.object({
			taskId: z.string(),
			title: z.string(),
			factoryNumber: z.number().optional(),
		})
		.optional(),
	proposals: z
		.array(
			z.object({
				taskId: z.string(),
				title: z.string(),
				factoryNumber: z.number().optional(),
				hash: z.string(),
				profile: verificationProfileSchema,
			}),
		)
		.default([]),
});
const storageSummarySchema = z.object({
	dataDir: z.string(),
	worktreesDir: z.string(),
	artifactsDir: z.string(),
	logsDir: z.string(),
	worktrees: z.object({
		count: z.number(),
		bytes: z.number(),
		finishedCount: z.number(),
		finishedBytes: z.number(),
		unknownCount: z.number(),
	}),
	artifactsBytes: z.number(),
	logsBytes: z.number(),
	approximate: z.boolean(),
	measuredAt: z.string(),
	cleaning: z.literal(true).optional(),
});
const resetWhatSchema = z.enum([
	"stage_trust",
	"verification_trust",
	"user_guidance",
	"settings",
]);
const resetResultSchema = z.object({
	what: resetWhatSchema,
	dryRun: z.boolean(),
	stages: z.number().optional(),
	projects: z.number().optional(),
	roles: z.array(guidanceRoleSchema).optional(),
	concurrency: z.number().optional(),
	dailyCostUsd: z.number().optional(),
	duplicateCheck: z.boolean().optional(),
});
const projectSummarySchema = z.object({
	workspaceRoot: z.string(),
	name: z.string(),
	remote: z.string().optional(),
	defaultBranch: z.string().optional(),
	cards: z.object({ open: z.number(), archived: z.number() }),
	stages: z.object({
		file: z.enum(["absent", "present", "invalid"]),
		total: z.number(),
		inUse: z.number(),
		awaiting: z.number(),
	}),
	verification: z.enum(["none", "proposed", "in_use", "changed", "invalid"]),
	guidance: z.object({
		roles: z.array(guidanceRoleSchema),
		changed: z.array(guidanceRoleSchema),
	}),
	taskFiles: z.number(),
});

/** Per sidecar command: the Hub command, the strict input and the reply. */
const FACTORY_SETTINGS_ROUTES = {
	factory_get_guidance: {
		hub: "task.factory.guidance.get",
		write: false,
		input: z.object({ workspaceRoot: workspaceRootSchema.optional() }).strict(),
		reply: guidanceSettingsSchema,
	},
	factory_get_guidance_history: {
		hub: "task.factory.guidance.history",
		write: false,
		input: z
			.object({
				role: guidanceRoleSchema.optional(),
				workspaceRoot: workspaceRootSchema.optional(),
				limit: z.number().int().min(1).max(50).optional(),
				before: z.string().max(300).optional(),
			})
			.strict(),
		reply: z.object({
			entries: z.array(guidanceHistoryEntrySchema),
			more: z.boolean(),
		}),
	},
	factory_set_guidance: {
		hub: "task.factory.guidance.set",
		write: true,
		input: z
			.object({
				role: guidanceRoleSchema,
				scope: z.enum(["user", "repository"]),
				workspaceRoot: workspaceRootSchema.optional(),
				expectedHash: guidanceHashSchema,
				content: z.string().max(16_000),
				note: z.string().max(200).optional(),
			})
			.strict(),
		reply: z.object({
			target: guidanceTargetSchema,
			entry: guidanceHistoryEntrySchema,
		}),
	},
	factory_resolve_guidance: {
		hub: "task.factory.guidance.resolve",
		write: true,
		input: z
			.object({
				role: guidanceRoleSchema,
				scope: z.enum(["user", "repository"]),
				workspaceRoot: workspaceRootSchema.optional(),
				decision: z.enum(["accept", "discard"]),
				expectedHash: guidanceHashSchema,
			})
			.strict(),
		reply: z.object({ target: guidanceTargetSchema }),
	},
	factory_get_verification: {
		hub: "task.factory.verification.get",
		write: false,
		input: z.object({ workspaceRoot: workspaceRootSchema }).strict(),
		reply: verificationSettingsSchema,
	},
	factory_set_verification: {
		hub: "task.factory.verification.set",
		write: true,
		input: z
			.object({
				workspaceRoot: workspaceRootSchema,
				decision: z.enum(["approve", "remove"]),
				expectedHash: profileHashSchema.optional(),
				profile: z.record(z.unknown()).optional(),
			})
			.strict(),
		reply: verificationSettingsSchema,
	},
	factory_get_storage: {
		hub: "task.factory.storage.get",
		write: false,
		input: z.object({ refresh: z.boolean().optional() }).strict(),
		reply: storageSummarySchema,
	},
	factory_clean_storage: {
		hub: "task.factory.storage.clean",
		write: true,
		input: z
			.object({
				what: z.literal("finished_worktrees").default("finished_worktrees"),
			})
			.strict(),
		reply: z.object({
			removed: z.number(),
			bytes: z.number(),
			skipped: z
				.array(z.object({ path: z.string(), reason: z.string() }))
				.default([]),
			storage: storageSummarySchema,
			running: z.literal(true).optional(),
		}),
	},
	factory_reset: {
		hub: "task.factory.reset",
		write: true,
		input: z
			.object({
				what: resetWhatSchema,
				workspaceRoot: workspaceRootSchema.optional(),
				dryRun: z.boolean().optional(),
			})
			.strict(),
		reply: resetResultSchema,
	},
	factory_get_projects: {
		hub: "task.factory.projects.get",
		write: false,
		input: z.object({}).strict(),
		reply: z.object({
			projects: z.array(projectSummarySchema),
			userGuidanceChanged: z.array(guidanceRoleSchema),
		}),
	},
} as const satisfies Record<
	FactorySettingsCommand,
	{
		hub: FactorySettingsHubCommand;
		write: boolean;
		input: z.ZodTypeAny;
		reply: z.ZodTypeAny;
	}
>;

/** The reply of a Factory settings command (see the section comment). */
export type FactorySettingsReply =
	| { supported: false }
	| ({ supported: true } & Record<string, unknown>);

/**
 * Resets the desktop's part of "Reset Factory settings": Hands-off becomes
 * the default workflow (saved workflows are kept) and the Hub learns it.
 */
export async function resetFactoryDefaultWorkflow(
	setFactoryDefaults?: SetFactoryDefaults,
): Promise<void> {
	const settings = readDesktopSettings();
	const saved = {
		...settings,
		factoryDefaultPreset: HANDS_OFF_PRESET_NAME,
		factoryHandsOffUpgradeApplied: true,
	};
	writeDesktopSettings(saved);
	if (setFactoryDefaults)
		await pushFactoryDefaultWorkflow(setFactoryDefaults, saved);
}

/**
 * Factory settings commands. The trusted-connection check is the caller's
 * (commands.ts); the Hub checks the client's authority again and accepts
 * only projects Factory knows. `factory_reset` with `what: "settings"` also
 * makes Hands-off the desktop's default workflow.
 */
export async function handleFactorySettingsCommand(
	command: FactorySettingsCommand,
	args: JsonRecord | undefined,
	send: SendHubCommand,
	setFactoryDefaults?: SetFactoryDefaults,
): Promise<FactorySettingsReply> {
	const route = FACTORY_SETTINGS_ROUTES[command];
	const input = route.input.parse(args ?? {}) as JsonRecord;
	if (
		command === "factory_set_guidance" ||
		command === "factory_resolve_guidance"
	) {
		if (input.scope === "user" && input.workspaceRoot !== undefined)
			throw new Error("Your guidance is not tied to a project.");
		if (input.scope === "repository" && input.workspaceRoot === undefined)
			throw new Error("Repository guidance needs the project.");
	}
	const reply = await send(route.hub, input);
	if (!reply.ok) {
		const code = reply.error?.code;
		if (code === "unsupported_command") return { supported: false };
		const message = reply.error?.message ?? "the Hub did not answer";
		if (route.write && code?.startsWith("factory_")) {
			const details = (reply.error as { details?: unknown } | undefined)
				?.details as { currentHash?: unknown } | undefined;
			return {
				supported: true,
				ok: false,
				error: {
					code,
					message,
					...(typeof details?.currentHash === "string"
						? { currentHash: details.currentHash }
						: {}),
				},
			};
		}
		throw new Error(
			`Factory could not ${FACTORY_SETTINGS_VERBS[command]}: ${message}`,
		);
	}
	const payload = route.reply.parse(reply.payload ?? {}) as Record<
		string,
		unknown
	>;
	if (
		command === "factory_reset" &&
		input.what === "settings" &&
		input.dryRun !== true
	)
		await resetFactoryDefaultWorkflow(setFactoryDefaults);
	return route.write
		? { supported: true, ok: true, ...payload }
		: { supported: true, ...payload };
}

const FACTORY_SETTINGS_VERBS: Record<FactorySettingsCommand, string> = {
	factory_get_guidance: "read the guidance",
	factory_get_guidance_history: "read the guidance history",
	factory_set_guidance: "save the guidance",
	factory_resolve_guidance: "resolve the guidance change",
	factory_get_verification: "read the test setup",
	factory_set_verification: "save the test setup",
	factory_get_storage: "read its storage",
	factory_clean_storage: "remove finished working copies",
	factory_reset: "reset",
	factory_get_projects: "read the projects",
};

// ---------------------------------------------------------------------------
// Saved workflows: delete and rename

export type FactoryPresetCommand =
	| "factory_delete_preset"
	| "factory_rename_preset";

/**
 * Deletes or renames a saved workflow in the desktop settings and returns
 * the workflow list (as `factory_save_preset` does). The built-in Hands-off
 * workflow can be neither. The default workflow can be deleted only with
 * `newDefault`, another saved workflow that becomes the default. A rename
 * keeps the workflow's revision (it is the configuration's hash) and moves
 * the default with it. The Hub learns a changed default.
 */
export async function handleFactoryPresetCommand(
	command: FactoryPresetCommand,
	args: JsonRecord | undefined,
	setFactoryDefaults?: SetFactoryDefaults,
): Promise<unknown> {
	const nameSchema = factoryPresetSchema.shape.name;
	const settings = readDesktopSettings();
	const presets = settings.factoryPresets ?? [];
	const effectiveDefault =
		withBuiltInFactoryPresets(settings).factoryDefaultPreset;
	let next: typeof settings;
	if (command === "factory_delete_preset") {
		const { name, newDefault } = z
			.object({ name: nameSchema, newDefault: nameSchema.optional() })
			.strict()
			.parse(args ?? {});
		if (name === HANDS_OFF_PRESET_NAME)
			throw new Error(
				`“${HANDS_OFF_PRESET_NAME}” is built in and cannot be deleted.`,
			);
		if (!presets.some((preset) => preset.name === name))
			throw new Error(`There is no saved workflow “${name}”.`);
		let factoryDefaultPreset = settings.factoryDefaultPreset;
		if (effectiveDefault === name) {
			if (!newDefault || newDefault === name)
				throw new Error(
					`“${name}” is the default workflow. Choose another default before deleting it.`,
				);
			if (
				newDefault !== HANDS_OFF_PRESET_NAME &&
				!presets.some((preset) => preset.name === newDefault)
			)
				throw new Error(`There is no saved workflow “${newDefault}”.`);
			factoryDefaultPreset = newDefault;
		} else if (newDefault !== undefined)
			throw new Error(
				"newDefault is only for deleting the default workflow; use Make default.",
			);
		next = {
			...settings,
			factoryPresets: presets.filter((preset) => preset.name !== name),
			...(factoryDefaultPreset ? { factoryDefaultPreset } : {}),
			factoryHandsOffUpgradeApplied: true,
		};
	} else {
		const { name, newName } = z
			.object({ name: nameSchema, newName: nameSchema })
			.strict()
			.parse(args ?? {});
		if (name === HANDS_OFF_PRESET_NAME || newName === HANDS_OFF_PRESET_NAME)
			throw new Error(
				`“${HANDS_OFF_PRESET_NAME}” is built in; choose another name.`,
			);
		const preset = presets.find((item) => item.name === name);
		if (!preset) throw new Error(`There is no saved workflow “${name}”.`);
		if (newName === name)
			return withBuiltInFactoryPresets(settings).factoryPresets;
		if (presets.some((item) => item.name === newName))
			throw new Error(`A workflow named “${newName}” already exists.`);
		const renamed = createFactoryWorkflowRecipe({
			name: newName,
			config: preset.config,
		});
		next = {
			...settings,
			factoryPresets: presets.map((item) => (item === preset ? renamed : item)),
			...(settings.factoryDefaultPreset === name
				? { factoryDefaultPreset: newName }
				: {}),
			factoryHandsOffUpgradeApplied: true,
		};
	}
	writeDesktopSettings(next);
	const nextDefault = withBuiltInFactoryPresets(next).factoryDefaultPreset;
	if (setFactoryDefaults && nextDefault !== effectiveDefault)
		try {
			await pushFactoryDefaultWorkflow(setFactoryDefaults, next);
		} catch (error) {
			throw new Error(
				`Saved, but Factory could not update the default workflow for new work: ${error instanceof Error ? error.message : String(error)}. Make it the default again to retry.`,
			);
		}
	return withBuiltInFactoryPresets(next).factoryPresets;
}
