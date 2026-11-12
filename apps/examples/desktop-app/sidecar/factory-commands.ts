import { createFactoryWorkflowRecipe } from "@cline/core";
import {
	type FactoryWorkflowRecipe,
	factoryDesignProgressSchema,
	factoryDesignReviewSchema,
	factoryQuestionSchema,
	factoryRunStateSchema,
	factoryStageSchema,
	factoryTaskConfigSchema,
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
} from "../webview/lib/factory-presets";
import {
	missingDefaultFactoryWorkflow,
	readDesktopSettings,
	resolveDefaultFactoryWorkflow,
	withBuiltInFactoryPresets,
	writeDesktopSettings,
} from "./desktop-settings";
import { readFactoryIssue } from "./factory-issue-import";
import { readFactoryDiff } from "./factory-review";
import type { JsonRecord, SidecarContext } from "./types";

type FactoryCommand =
	| "factory_save_preset"
	| "factory_import_issue"
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
		| "task.factory.stages.set",
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

/** The limits the Hub reports (see FactoryLimits for `paused` and cost). */
export type FactoryLimitsReply = FactoryLimits;

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
	})
	.refine(
		(value) =>
			value.concurrency !== undefined ||
			value.paused !== undefined ||
			value.dailyCostUsd !== undefined,
		{ message: "Send concurrency, paused, dailyCostUsd or a combination" },
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
		const { concurrency, paused, dailyCostUsd } = factoryLimitsSetSchema.parse(
			args ?? {},
		);
		if (concurrency !== undefined) input.concurrency = concurrency;
		if (paused !== undefined) input.paused = paused;
		if (dailyCostUsd !== undefined) input.dailyCostUsd = dailyCostUsd;
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
				? `Factory could not change ${input.dailyCostUsd !== undefined ? "the daily spending limit" : "how much work runs at once"}: ${reason}`
				: `Factory could not read how much work runs at once: ${reason}`,
		);
	}
	const { concurrency, paused, dailyCostUsd, spentTodayUsd } = z
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
	if (command === "factory_import_issue") {
		const input = z
			.object({ url: z.string().min(1), cwd: z.string().min(1) })
			.parse(args);
		const issue = await readFactoryIssue(input);
		const existing = (await list()).find(
			(task) =>
				task.workspaceRoot === input.cwd &&
				task.factory?.sourceIssue?.provider === issue.source.provider &&
				task.factory.sourceIssue.id === issue.source.id,
		);
		return { ...issue, existingTaskId: existing?.taskId };
	}
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
			(["in_progress", "completed", "failed", "cancelled", "expired"].includes(
				task.status,
			) ||
				(task.status === "approved" &&
					Boolean(task.lastRunId) &&
					isFactoryHandsOff(task.factory)) ||
				pending.length > 0)
				? runsReplySchema.parse(
						await readTask("task.get", {
							taskId: task.taskId,
							allWorkspaces: true,
						}),
					)
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
}
