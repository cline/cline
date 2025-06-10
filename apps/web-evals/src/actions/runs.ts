"use server"

import * as path from "path"
import fs from "fs"
import { fileURLToPath } from "url"
import { spawn } from "child_process"

import { revalidatePath } from "next/cache"
import pMap from "p-map"

import {
	type ExerciseLanguage,
	exerciseLanguages,
	createRun as _createRun,
	deleteRun as _deleteRun,
	createTask,
	getExercisesForLanguage,
} from "@roo-code/evals"

import { CreateRun } from "@/lib/schemas"

const EVALS_REPO_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../evals")

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function createRun({ suite, exercises = [], systemPrompt, ...values }: CreateRun) {
	const run = await _createRun({
		...values,
		socketPath: "", // TODO: Get rid of this.
	})

	if (suite === "partial") {
		for (const path of exercises) {
			const [language, exercise] = path.split("/")

			if (!language || !exercise) {
				throw new Error("Invalid exercise path: " + path)
			}

			await createTask({ ...values, runId: run.id, language: language as ExerciseLanguage, exercise })
		}
	} else {
		for (const language of exerciseLanguages) {
			const exercises = await getExercisesForLanguage(EVALS_REPO_PATH, language)

			await pMap(exercises, (exercise) => createTask({ runId: run.id, language, exercise }), {
				concurrency: 10,
			})
		}
	}

	revalidatePath("/runs")

	try {
		const isRunningInDocker = fs.existsSync("/.dockerenv")

		const dockerArgs = [
			`--name evals-controller-${run.id}`,
			// "--rm",
			"--network evals_default",
			"-v /var/run/docker.sock:/var/run/docker.sock",
			"-v /tmp/evals:/var/log/evals",
			"-e HOST_EXECUTION_METHOD=docker",
		]

		const cliCommand = `pnpm --filter @roo-code/evals cli --runId ${run.id}`

		const command = isRunningInDocker
			? `docker run ${dockerArgs.join(" ")} evals-runner sh -c "${cliCommand}"`
			: cliCommand

		console.log("spawn ->", command)

		const childProcess = spawn("sh", ["-c", command], {
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		})

		const logStream = fs.createWriteStream("/tmp/roo-code-evals.log", { flags: "a" })

		if (childProcess.stdout) {
			childProcess.stdout.pipe(logStream)
		}

		if (childProcess.stderr) {
			childProcess.stderr.pipe(logStream)
		}

		childProcess.unref()
	} catch (error) {
		console.error(error)
	}

	return run
}

export async function deleteRun(runId: number) {
	await _deleteRun(runId)
	revalidatePath("/runs")
}
