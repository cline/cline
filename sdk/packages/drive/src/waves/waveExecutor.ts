import { AdaptiveConcurrency } from "./adaptiveConcurrency";
import { evaluateReviews } from "./reviewGates";
import type { DriveWorkMailbox } from "./workMailbox";
import type { DriveWorkScratch } from "./workScratch";
import { TokenQueue } from "./tokenQueue";
import {
	createWorkItem,
	nowIso,
	type DriveReviewGate,
	type DriveReviewDecision,
	type DriveWorkExecutor,
	type DriveWaveLogEntry,
	type DriveWorkItem,
	type DriveWorkInput,
} from "./types";

export type DriveWaveExecutorOptions = {
	host: DriveWorkExecutor;
	concurrency: AdaptiveConcurrency;
	tokenQueue: TokenQueue;
	scratch: DriveWorkScratch;
	workMailbox: DriveWorkMailbox;
	gates: DriveReviewGate[];
	logs: DriveWaveLogEntry[];
	signal?: AbortSignal;
};

export type DriveWaveExecution = {
	tasks: DriveWorkItem[];
	spawned: DriveWorkInput[];
	gate: DriveReviewDecision;
	hadFailure: boolean;
};

function depsSatisfied(task: DriveWorkItem, byId: Map<string, DriveWorkItem>): boolean {
	return task.dependsOn.every((depId) => {
		const dep = byId.get(depId);
		return dep?.status === "succeeded";
	});
}

function selectReady(tasks: DriveWorkItem[], limit: number): DriveWorkItem[] {
	const byId = new Map(tasks.map((task) => [task.id, task]));
	return tasks
		.filter(
			(task) => task.status === "pending" && depsSatisfied(task, byId),
		)
		.sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt))
		.slice(0, limit);
}

function log(
	logs: DriveWaveLogEntry[],
	level: DriveWaveLogEntry["level"],
	message: string,
	data?: Record<string, unknown>,
): void {
	logs.push({ at: nowIso(), level, message, data });
}

/**
 * Runs one Drive work wave: emergency/pre reviews → parallel batch → post review.
 */
export class DriveWaveExecutor {
	constructor(private readonly options: DriveWaveExecutorOptions) {}

	async runWave(input: {
		wave: number;
		tasks: DriveWorkItem[];
	}): Promise<DriveWaveExecution> {
		const { host, concurrency, tokenQueue, scratch, workMailbox, gates, logs, signal } =
			this.options;
		const tasks = input.tasks;

		const emergency = await evaluateReviews(gates, {
			kind: "emergency",
			wave: input.wave,
			tasks,
			scratch: scratch.snapshot(),
			workMailbox: workMailbox.messages,
		});
		if (emergency.action !== "continue") {
			return {
				tasks,
				spawned: emergency.inject ?? [],
				gate: emergency,
				hadFailure: false,
			};
		}

		const pre = await evaluateReviews(gates, {
			kind: "pre",
			wave: input.wave,
			tasks,
			scratch: scratch.snapshot(),
			workMailbox: workMailbox.messages,
		});
		if (pre.action !== "continue") {
			return {
				tasks,
				spawned: pre.inject ?? [],
				gate: pre,
				hadFailure: false,
			};
		}

		const ready = selectReady(tasks, concurrency.window);
		log(logs, "info", `wave ${input.wave}: running ${ready.length} task(s)`, {
			window: concurrency.window,
			readyIds: ready.map((task) => task.id),
		});

		const spawned: DriveWorkInput[] = [];
		let hadFailure = false;

		await Promise.all(
			ready.map(async (task) => {
				if (signal?.aborted) {
					task.status = "cancelled";
					task.updatedAt = nowIso();
					return;
				}
				await tokenQueue.acquire(signal);
				task.status = "running";
				task.attempts += 1;
				task.updatedAt = nowIso();
				try {
					const outcome = await host.runTask({
						task,
						scratch: scratch.snapshot(),
						workMailbox: workMailbox.messages,
						signal,
					});
					if (outcome.scratchWrites) {
						scratch.writeAll(outcome.scratchWrites);
					}
					if (outcome.messages) {
						for (const message of outcome.messages) {
							workMailbox.send({
								from: message.from ?? task.id,
								to: message.to,
								topic: message.topic,
								body: message.body,
							});
						}
					}
					if (outcome.spawn?.length) {
						spawned.push(...outcome.spawn);
						for (const child of outcome.spawn) {
							const childTask = createWorkItem(child);
							task.spawnedIds.push(childTask.id);
							tasks.push(childTask);
						}
					}
					if (outcome.ok) {
						task.status = "succeeded";
						task.result = outcome.result;
						concurrency.onSuccess();
					} else {
						task.status = "failed";
						task.error = outcome.error ?? "task failed";
						hadFailure = true;
						concurrency.onFailure();
					}
				} catch (error) {
					task.status = "failed";
					task.error =
						error instanceof Error ? error.message : String(error);
					hadFailure = true;
					if (/429|rate.?limit/i.test(task.error)) {
						concurrency.onRateLimited();
					} else {
						concurrency.onFailure();
					}
					log(logs, "error", `task ${task.id} threw`, { error: task.error });
				}
				task.updatedAt = nowIso();
			}),
		);

		const post = await evaluateReviews(gates, {
			kind: "post",
			wave: input.wave,
			tasks,
			scratch: scratch.snapshot(),
			workMailbox: workMailbox.messages,
		});

		if (post.action === "inject" && post.inject?.length) {
			spawned.push(...post.inject);
			for (const item of post.inject) {
				tasks.push(createWorkItem(item));
			}
		}
		if (post.action === "redirect" && post.redirect?.length) {
			for (const task of tasks) {
				if (task.status === "pending") {
					task.status = "cancelled";
					task.updatedAt = nowIso();
				}
			}
			for (const item of post.redirect) {
				tasks.push(createWorkItem(item));
			}
		}

		return { tasks, spawned, gate: post, hadFailure };
	}
}
