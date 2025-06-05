import PQueue from "p-queue"

import { findRun, finishRun, getTasks } from "../db/index.js"
import { exercisesPath } from "../exercises/index.js"

import { getTag, isDockerContainer, resetEvalsRepo, commitEvalsRepoChanges } from "./utils.js"
import { processTask, processTaskInContainer } from "./processTask.js"
import { startHeartbeat, stopHeartbeat } from "./redis.js"

export const runEvals = async (runId: number) => {
	const run = await findRun(runId)

	if (run.taskMetricsId) {
		throw new Error(`Run ${run.id} already finished.`)
	}

	const tasks = await getTasks(runId)

	if (tasks.length === 0) {
		throw new Error(`Run ${run.id} has no tasks.`)
	}

	const tag = getTag("runEvals", { run })
	console.log(`[${Date.now()} | ${tag}] running ${tasks.length} task(s)`)

	const containerized = isDockerContainer()

	if (!containerized) {
		await resetEvalsRepo({ run, cwd: exercisesPath })
	}

	const heartbeat = await startHeartbeat(run.id)
	const queue = new PQueue({ concurrency: run.concurrency })

	try {
		await queue.addAll(
			tasks
				.filter((task) => task.finishedAt === null)
				.map((task) => () => (containerized ? processTaskInContainer(task.id) : processTask(task.id))),
		)

		console.log(`[${Date.now()} | ${tag}] finishRun`)
		const result = await finishRun(run.id)
		console.log(`[${Date.now()} | ${tag}] result ->`, result)

		// There's no need to commit the changes in the container since they
		// will lost when the container is destroyed. I think we should
		// store the diffs in the database instead.
		if (!containerized) {
			await commitEvalsRepoChanges({ run, cwd: exercisesPath })
		}
	} finally {
		console.log(`[${Date.now()} | ${tag}] cleaning up`)
		stopHeartbeat(run.id, heartbeat)
	}
}
