import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AgendaTaskManager,
	FactoryGuidanceStore,
	resolveFactoryGuidanceDir,
} from "@cline/core";
import type { AgendaTaskRecord } from "@cline/shared";
import {
	createRepo,
	evalFactoryConfig,
	quietLogger,
	TASK_APP_FILES,
} from "./fixtures";
import type { ScoperOutcome, ScoperTrial } from "./grade";
import { createEvalAgendaRuntime, EvalCore, type ModelChoice } from "./runtime";
import type { ScoperScenario } from "./scenarios";
import { settle, type TrialOptions } from "./trial";

/**
 * One scoping of a fresh card by the real AgendaTaskManager (its designer
 * prompt, split offer, parsing and format retries) on a temporary database,
 * with the designer session run by a real model. Stops when the scoper has
 * answered: before plan review when it selected plan reviewers, and plan
 * approval is required, so nothing runs past the plan.
 */
export async function runScoperTrial(
	scenario: ScoperScenario,
	trial: number,
	model: ModelChoice,
	options: TrialOptions,
): Promise<ScoperTrial> {
	const started = Date.now();
	const root = realpathSync(mkdtempSync(join(tmpdir(), "factory-eval-")));
	let question: string | undefined;
	let planReviewRequested = false;
	let core: EvalCore | undefined;
	let manager: AgendaTaskManager | undefined;
	const base = {
		suite: "scoper" as const,
		scenarioId: scenario.id,
		trial,
		designerRuns: 0,
		formatRetries: 0,
		modelRequests: 0,
		toolCalls: {},
	};
	try {
		const repo = join(root, "tasklist");
		createRepo(repo, TASK_APP_FILES, { bare: join(root, "origin.git") });
		const dbPath = join(root, "tasks.db");
		const guidance = new FactoryGuidanceStore(
			resolveFactoryGuidanceDir(dbPath),
		);
		const evalCore = await EvalCore.create({
			model,
			dryRun: options.dryRun,
			// In the app the card would now wait for the person; the trial ends here.
			onQuestion: (text) => {
				question ??= text;
				void evalCore.abortAll("The scoper asked the person a question");
			},
		});
		core = evalCore;
		const tasks = new AgendaTaskManager({
			runtime: createEvalAgendaRuntime(evalCore, guidance, () => {
				planReviewRequested = true;
			}),
			dbPath,
			globalSpecsDir: join(root, "specs"),
			watchFiles: false,
			automationEnabled: false,
			factoryStorageDir: join(root, "factory"),
			factoryGuidance: guidance,
			logger: quietLogger,
		});
		manager = tasks;
		const card = await tasks.createTask({
			title: scenario.title,
			type: "follow-up",
			instructions: scenario.request,
			scope: "workspace",
			workspaceRoot: repo,
			cwd: repo,
			expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
			requiresApproval: true,
			automationEligible: false,
			queueFactoryDesign: false,
			factory: evalFactoryConfig(
				options.reviewPool
					? {
							agents: {
								planReviewers: Array.from(
									{ length: options.reviewPool.planReviewers },
									() => ({}),
								),
								reviewers: Array.from(
									{ length: options.reviewPool.reviewers },
									() => ({}),
								),
							},
						}
					: {},
			),
			modelSelection: model,
			createdBy: { kind: "user" },
		});
		await tasks.startFactoryDesign(card.taskId);
		const ended = await settle(async () => {
			const task = (await tasks.getTask(card.taskId)) as AgendaTaskRecord;
			const phase = task.factoryDesignProgress?.phase;
			// Plan review requested: the scoper answered with a plan. The
			// decision is made; plan review is not part of this eval.
			return phase === "complete" ||
				planReviewRequested ||
				task.error ||
				question !== undefined ||
				evalCore.captured
				? task
				: undefined;
		}, options);
		const task =
			ended.value ?? ((await tasks.getTask(card.taskId)) as AgendaTaskRecord);
		await evalCore.abortAll("Trial ended");
		const progress = task.factoryDesignProgress;
		const outcome: ScoperOutcome =
			ended.status !== "settled"
				? ended.status
				: question !== undefined
					? "question"
					: planReviewRequested
						? progress?.splitWithdrawn
							? "split_withdrawn_then_plan"
							: "plan"
						: progress?.phase !== "complete"
							? "failed"
							: progress.split
								? "split"
								: progress.conclusion
									? "conclusion"
									: progress.splitWithdrawn
										? "split_withdrawn_then_plan"
										: "plan";
		const designer = [...evalCore.sessions.values()].filter(
			(session) => session.role === "designer",
		);
		const toolCalls: Record<string, number> = {};
		for (const call of designer.flatMap((session) => session.toolCalls))
			toolCalls[call.name] = (toolCalls[call.name] ?? 0) + 1;
		return {
			...base,
			outcome,
			seconds: (Date.now() - started) / 1000,
			designerRuns: designer.length,
			formatRetries: progress?.formatRetries ?? 0,
			modelRequests: designer.reduce((n, s) => n + s.modelRequests, 0),
			toolCalls,
			...(progress?.split
				? {
						parts: progress.split.parts.map((part) => ({
							title: part.title,
							paths: [...part.paths],
							dependsOn: [...part.dependsOn],
						})),
					}
				: {}),
			...(outcome === "plan" || outcome === "split_withdrawn_then_plan"
				? {
						planUnits: task.factory?.implementationUnits?.length ?? 0,
						checks: task.factory?.checks.length ?? 0,
					}
				: {}),
			...(question !== undefined ? { question } : {}),
			...(outcome === "failed" && task.error ? { error: task.error } : {}),
			...(designer.at(-1)?.text ? { finalText: designer.at(-1)?.text } : {}),
			...(evalCore.captured ? { captured: evalCore.captured } : {}),
			usage: await evalCore.usage(),
		};
	} catch (error) {
		return {
			...base,
			outcome: "harness_error",
			seconds: (Date.now() - started) / 1000,
			error:
				error instanceof Error ? (error.stack ?? error.message) : String(error),
		};
	} finally {
		await core?.abortAll("Trial ended").catch(() => {});
		await manager?.dispose().catch(() => {});
		await core?.dispose().catch(() => {});
		rmSync(root, { recursive: true, force: true });
	}
}
