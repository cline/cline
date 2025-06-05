import * as fs from "fs"

import { command, run, number, option } from "cmd-ts"

import { exercisesPath } from "../exercises/index.js"

import { runEvals } from "./runEvals.js"
import { processTask } from "./processTask.js"

const main = async () => {
	const result = await run(
		command({
			name: "cli",
			description: "Execute an eval run.",
			version: "0.0.0",
			args: {
				runId: option({ type: number, long: "runId", short: "r", defaultValue: () => -1 }),
				taskId: option({ type: number, long: "taskId", short: "t", defaultValue: () => -1 }),
			},
			handler: async (args) => {
				const { runId, taskId } = args

				if (runId === -1 && taskId === -1) {
					throw new Error("Either runId or taskId must be provided.")
				}

				if (runId !== -1 && taskId !== -1) {
					throw new Error("Only one of runId or taskId must be provided.")
				}

				try {
					if (runId !== -1) {
						await runEvals(runId)
					} else {
						await processTask(taskId)
					}
				} catch (error) {
					console.error(error)
					process.exit(1)
				}
			},
		}),
		process.argv.slice(2),
	)

	console.log(result)
	process.exit(0)
}

if (!fs.existsSync(exercisesPath)) {
	console.error(
		`Exercises do not exist at ${exercisesPath}. Please run "git clone https://github.com/RooCodeInc/Roo-Code-Evals.git evals".`,
	)

	process.exit(1)
}

main()
