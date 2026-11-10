import {
	factoryDesignProgressSchema,
	factoryQuestionSchema,
	factoryRunStateSchema,
	factoryTaskConfigSchema,
} from "@cline/shared";
import { z } from "zod";
import { factoryPresetSchema } from "../webview/lib/factory-presets";
import { readDesktopSettings, writeDesktopSettings } from "./desktop-settings";
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
const tasksReplySchema = z.object({
	tasks: z.array(
		z.object({
			taskId: z.string(),
			factoryQuestions: z
				.unknown()
				.transform((value) => factoryQuestionSchema.array().parse(value))
				.optional(),
			originSessionId: z.string().optional(),
			status: z.string(),
			archivedAt: z.string().optional(),
			error: z.string().optional(),
			factoryDesignProgress: z
				.unknown()
				.transform((value) => factoryDesignProgressSchema.parse(value))
				.optional(),
			revision: z.number(),
			lastRunId: z.string().optional(),
			currentRunId: z.string().optional(),
			workspaceRoot: z.string().optional(),
			factory: z
				.unknown()
				.transform((value) => factoryTaskConfigSchema.parse(value))
				.optional(),
		}),
	),
});
const runsReplySchema = z.object({
	runs: z
		.array(
			z.object({
				runId: z.string(),
				taskRevision: z.number(),
				factory: z
					.unknown()
					.transform((value) => factoryRunStateSchema.parse(value))
					.optional(),
			}),
		)
		.default([]),
});

export async function handleFactoryCommand(
	ctx: Pick<SidecarContext, "pendingQuestions">,
	command: FactoryCommand,
	args: JsonRecord | undefined,
	readTask: ReadTask,
): Promise<unknown> {
	if (command === "factory_save_preset") {
		const { useByDefault, ...preset } = factoryPresetSchema
			.extend({ useByDefault: z.boolean().optional() })
			.parse(args);
		const settings = readDesktopSettings();
		const presets = settings.factoryPresets ?? [];
		const next = [
			...presets.filter((item) => item.name !== preset.name),
			preset,
		];
		let factoryDefaultPreset = settings.factoryDefaultPreset;
		if (useByDefault === true) factoryDefaultPreset = preset.name;
		else if (useByDefault === false && factoryDefaultPreset === preset.name)
			factoryDefaultPreset = undefined;
		writeDesktopSettings({
			...settings,
			factoryPresets: next,
			factoryDefaultPreset,
		});
		return next;
	}
	const list = async () =>
		tasksReplySchema.parse(
			await readTask("task.list", {
				allWorkspaces: true,
				includeArchived: true,
				limit: 200,
			}),
		).tasks;
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
			.object({ taskId: z.string().min(1), runId: z.string().min(1) })
			.parse(args);
		return readFactoryDiff(
			await readTask("task.get", {
				taskId: input.taskId,
				allWorkspaces: true,
			}),
			input.runId,
		);
	}
	const pending = [...ctx.pendingQuestions.values()].map(
		(question) => question.item,
	);
	const tasks = (await list()).filter((task) => task.factory && !task.archivedAt);
	return Promise.all(
		tasks.map(async (task) => {
			const { runs } =
				(task.currentRunId || task.lastRunId) &&
				([
					"in_progress",
					"completed",
					"failed",
					"cancelled",
					"expired",
				].includes(task.status) ||
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
			const sessions = new Set([
				task.originSessionId,
				...(run?.factory?.sessions.map((session) => session.sessionId) ?? []),
			]);
			const questions = pending.filter((question) =>
				sessions.has(question.sessionId),
			);
			questions.push(
				...(task.factoryQuestions ?? [])
					.filter(
						(question) =>
							question.status === "pending" &&
							question.revision === task.revision &&
							task.status !== "cancelled" &&
							task.status !== "expired",
					)
					.map((question) => ({
						requestId: question.questionId,
						sessionId: question.sessionId,
						createdAt: question.createdAt,
						question: question.question,
						options: question.options ?? [],
					})),
			);
			const state =
				run?.taskRevision === task.revision ? run.factory : undefined;
			const design =
				task.factoryDesignProgress?.revision === task.revision
					? task.factoryDesignProgress
					: undefined;
			const closed = task.status === "cancelled" || task.status === "expired";
			const needsAttention =
				!closed &&
				(questions.length > 0 ||
					!!task.error ||
					task.status === "failed" ||
					!!state?.audit?.finding ||
					(task.status === "pending_approval" &&
						task.factory?.approval === "required" &&
						(design
							? design.phase === "complete"
							: task.factory.checks.length > 0)) ||
					(!state?.humanApproval &&
						(state?.phase === "blocked" ||
							state?.pullRequestWatch?.paused === true ||
							(task.status === "completed" &&
								(state?.phase === "ready" ||
									(state?.phase === "watching" &&
										!state.pullRequestWatch?.pending &&
										state.pullRequestChecks?.status === "passed" &&
										state.pullRequestChecks.headCommit ===
											state.candidate?.commit))))));
			return {
				taskId: task.taskId,
				revision: task.revision,
				runId: state ? run?.runId : undefined,
				questions: closed ? [] : questions,
				needsAttention,
				outcome: state
					? {
							phase: state.phase,
							activeRoles: (state.attempts ?? [])
								.filter(
									(attempt) =>
										attempt.status === "intent" || attempt.status === "running",
								)
								.map((attempt) => attempt.role),
							followupPaused: state.pullRequestWatch?.paused === true,
							humanApproval: state.humanApproval,
							audit: state.audit,
							usage: state.usage,
							repairRound: state.repairRound,
						}
					: undefined,
			};
		}),
	);
}
