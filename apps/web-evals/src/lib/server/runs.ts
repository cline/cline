"use server"

import { spawn } from "child_process"
import path from "path"
import os from "os"
import fs from "fs"

import { revalidatePath } from "next/cache"
import pMap from "p-map"

import {
	type ExerciseLanguage,
	exerciseLanguages,
	createRun as _createRun,
	updateRun as _updateRun,
	deleteRun as _deleteRun,
	createTask,
} from "@roo-code/evals"

import { CreateRun } from "@/lib/schemas"

import { getExercisesForLanguage } from "./exercises"

export async function createRun({ suite, exercises = [], systemPrompt, ...values }: CreateRun) {
	const run = await _createRun({
		...values,
		socketPath: path.join(os.tmpdir(), `roo-code-evals-${crypto.randomUUID()}.sock`),
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
			const exercises = await getExercisesForLanguage(language)

			await pMap(exercises, (exercise) => createTask({ ...values, runId: run.id, language, exercise }), {
				concurrency: 10,
			})
		}
	}

	revalidatePath("/runs")

	try {
		const logFile = fs.openSync(`/tmp/roo-code-evals-${run.id}.log`, "a")

		const env: NodeJS.ProcessEnv = systemPrompt
			? { ...process.env, FOOTGUN_SYSTEM_PROMPT: systemPrompt }
			: process.env

		const childProcess = spawn("pnpm", ["--filter", "@roo-code/evals", "cli", run.id.toString()], {
			detached: true,
			stdio: ["ignore", logFile, logFile],
			env,
		})

		childProcess.unref()
		await _updateRun(run.id, { pid: childProcess.pid })
	} catch (error) {
		console.error(error)
	}

	return run
}

export async function deleteRun(runId: number) {
	await _deleteRun(runId)
	revalidatePath("/runs")
}
