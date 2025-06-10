import * as fs from "fs"

import { run, command, option, flag, number, boolean } from "cmd-ts"

import { EVALS_REPO_PATH } from "../exercises/index.js"

import { runCi } from "./runCi.js"
import { runEvals } from "./runEvals.js"
import { processTask } from "./runTask.js"

const main = async () => {
	await run(
		command({
			name: "cli",
			description: "Execute an eval run.",
			version: "0.0.0",
			args: {
				ci: flag({ type: boolean, long: "ci", defaultValue: () => false }),
				runId: option({ type: number, long: "runId", short: "r", defaultValue: () => -1 }),
				taskId: option({ type: number, long: "taskId", short: "t", defaultValue: () => -1 }),
			},
			handler: async (args) => {
				const { runId, taskId, ci } = args

				try {
					if (ci) {
						await runCi({ concurrency: 3, exercisesPerLanguage: 5 })
					} else if (runId !== -1) {
						await runEvals(runId)
					} else if (taskId !== -1) {
						await processTask({ taskId })
					} else {
						throw new Error("Either runId or taskId must be provided.")
					}
				} catch (error) {
					console.error(error)
					process.exit(1)
				}
			},
		}),
		process.argv.slice(2),
	)

	process.exit(0)
}

if (!fs.existsSync(EVALS_REPO_PATH)) {
	console.error(
		`Exercises do not exist at ${EVALS_REPO_PATH}. Please run "git clone https://github.com/RooCodeInc/Roo-Code-Evals.git evals".`,
	)

	process.exit(1)
}

main()
