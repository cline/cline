import { factoryRunStateSchema, factoryTaskConfigSchema } from "@cline/shared";
import { z } from "zod";
import { readFactoryIssue } from "./factory-issue-import";
import { readFactoryDiff } from "./factory-review";
import type { JsonRecord, SidecarContext } from "./types";

type FactoryCommand =
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
			originSessionId: z.string().optional(),
			status: z.string(),
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
	const tasks = (await list()).filter((task) => task.factory);
	return Promise.all(
		tasks.map(async (task) => {
			const { runs } =
				(task.currentRunId || task.lastRunId) &&
				(task.status === "completed" || pending.length > 0)
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
			const needsAttention =
				questions.length > 0 ||
				(task.status === "pending_approval" &&
					task.factory?.approval === "required") ||
				task.status === "failed" ||
				(task.status === "completed" &&
					run?.taskRevision === task.revision &&
					["ready", "blocked"].includes(run.factory?.phase ?? ""));
			return { taskId: task.taskId, questions, needsAttention };
		}),
	);
}
