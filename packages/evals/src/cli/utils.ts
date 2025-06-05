import * as fs from "fs"

import type { Run, Task } from "../db/index.js"

export const getTag = (caller: string, { run, task }: { run: Run; task?: Task }) =>
	task
		? `${caller} | pid:${process.pid} | run:${run.id} | task:${task.id} | ${task.language}/${task.exercise}`
		: `${caller} | pid:${process.pid} | run:${run.id}`

export const isDockerContainer = () => {
	try {
		return fs.existsSync("/.dockerenv")
	} catch (_error) {
		return false
	}
}
