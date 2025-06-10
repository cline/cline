import PQueue from "p-queue"

import { findRun, finishRun, getTasks } from "../db/index.js"
import { EVALS_REPO_PATH } from "../exercises/index.js"

import { Logger, getTag, isDockerContainer, resetEvalsRepo, commitEvalsRepoChanges } from "./utils.js"
import { startHeartbeat, stopHeartbeat } from "./redis.js"
import { processTask, processTaskInContainer } from "./runTask.js"

export const runEvals = async (runId: number) => {
	const run = await findRun(runId)

	if (run.taskMetricsId) {
		throw new Error(`Run ${run.id} already finished.`)
	}

	const tasks = await getTasks(runId)

	if (tasks.length === 0) {
		throw new Error(`Run ${run.id} has no tasks.`)
	}

	const logger = new Logger({
		logDir: `/var/log/evals/runs/${run.id}`,
		filename: `controller.log`,
		tag: getTag("runEvals", { run }),
	})

	logger.info(`running ${tasks.length} task(s)`)

	const containerized = isDockerContainer()

	if (!containerized) {
		await resetEvalsRepo({ run, cwd: EVALS_REPO_PATH })
	}

	const heartbeat = await startHeartbeat(run.id)
	const queue = new PQueue({ concurrency: run.concurrency })

	try {
		await queue.addAll(
			tasks
				.filter((task) => task.finishedAt === null)
				.map((task) => async () => {
					try {
						if (containerized) {
							await processTaskInContainer({ taskId: task.id, logger })
						} else {
							await processTask({ taskId: task.id, logger })
						}
					} catch (error) {
						logger.error("error processing task", error)
					}
				}),
		)

		logger.info("finishRun")
		const result = await finishRun(run.id)
		logger.info("result ->", result)

		// There's no need to commit the changes in the container since they
		// will lost when the container is destroyed. I think we should
		// store the diffs in the database instead.
		if (!containerized) {
			await commitEvalsRepoChanges({ run, cwd: EVALS_REPO_PATH })
		}
	} finally {
		logger.info("cleaning up")
		stopHeartbeat(run.id, heartbeat)
		logger.close()
	}
}
