import { RooCodeEventName, type TaskEvent } from "@roo-code/types"

import { findTask, updateTask, findRun } from "../db/index.js"

import { getTag } from "./utils.js"
import { redisClient, getPubSubKey, registerRunner, deregisterRunner } from "./redis.js"
import { runTask } from "./runTask.js"
import { runUnitTest } from "./runUnitTest.js"
import { execa } from "execa"

export const processTask = async (taskId: number) => {
	const task = await findTask(taskId)
	const run = await findRun(task.runId)
	await registerRunner({ runId: run.id, taskId })

	try {
		const tag = getTag("processTask", { run, task })

		const publish = async (e: TaskEvent) => {
			const redis = await redisClient()
			await redis.publish(getPubSubKey(run.id), JSON.stringify(e))
		}

		console.log(`[${Date.now()} | ${tag}] running task ${task.id} (${task.language}/${task.exercise})...`)
		await runTask({ run, task, publish })

		console.log(`[${Date.now()} | ${tag}] testing task ${task.id} (${task.language}/${task.exercise})...`)
		const passed = await runUnitTest({ task })

		console.log(`[${Date.now()} | ${tag}] task ${task.id} (${task.language}/${task.exercise}) -> ${passed}`)
		await updateTask(task.id, { passed })

		await publish({
			eventName: passed ? RooCodeEventName.EvalPass : RooCodeEventName.EvalFail,
			taskId: task.id,
		})
	} finally {
		await deregisterRunner({ runId: run.id, taskId })
	}
}

export const processTaskInContainer = async (taskId: number) => {
	const args = [
		`--name evals-task-${taskId}`,
		"--rm",
		"--network evals_default",
		"-v /var/run/docker.sock:/var/run/docker.sock",
		"-e HOST_EXECUTION_METHOD=docker",
	]

	const command = `pnpm --filter @roo-code/evals cli --taskId ${taskId}`
	const subprocess = execa(`docker run ${args.join(" ")} evals-runner sh -c "${command}"`, { shell: true })
	// subprocess.stdout?.on("data", (data) => console.log(data.toString()))
	// subprocess.stderr?.on("data", (data) => console.error(data.toString()))
	await subprocess
}
