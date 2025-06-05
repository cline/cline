import { execa } from "execa"
import PQueue from "p-queue"

import { findRun, finishRun, getTasks } from "../db/index.js"
import { exercisesPath } from "../exercises/index.js"

import { getTag, isDockerContainer } from "./utils.js"
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

	const cwd = exercisesPath
	await execa({ cwd })`git config user.name "Roo Code"`
	await execa({ cwd })`git config user.email "support@roocode.com"`
	await execa({ cwd })`git checkout -f`
	await execa({ cwd })`git clean -fd`
	await execa({ cwd })`git checkout -b runs/${run.id}-${crypto.randomUUID().slice(0, 8)} main`

	const heartbeat = await startHeartbeat(run.id)
	const queue = new PQueue({ concurrency: run.concurrency })

	try {
		const containerize = isDockerContainer()

		await queue.addAll(
			tasks
				.filter((task) => task.finishedAt === null)
				.map((task) => () => (containerize ? processTaskInContainer(task.id) : processTask(task.id))),
		)

		console.log(`[${Date.now()} | ${tag}] finishRun`)
		const result = await finishRun(run.id)
		console.log(`[${Date.now()} | ${tag}] result ->`, result)

		await execa({ cwd: exercisesPath })`git add .`
		await execa({ cwd: exercisesPath })`git commit -m ${`Run #${run.id}`} --no-verify`
	} finally {
		console.log(`[${Date.now()} | ${tag}] cleaning up`)
		stopHeartbeat(run.id, heartbeat)
	}
}
