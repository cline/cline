"use server"

import { spawn } from "child_process"
import path from "path"
import os from "os"
import fs from "fs"

import { revalidatePath } from "next/cache"
import pMap from "p-map"

import { ExerciseLanguage, exerciseLanguages } from "@evals/types"
import * as db from "@evals/db"

import { CreateRun } from "@/lib/schemas"
import { getExercisesForLanguage } from "./exercises"

export async function createRun({ suite, exercises = [], ...values }: CreateRun) {
	const run = await db.createRun({
		...values,
		socketPath: path.join(os.tmpdir(), `roo-code-evals-${crypto.randomUUID()}.sock`),
	})

	if (suite === "partial") {
		for (const path of exercises) {
			const [language, exercise] = path.split("/")

			if (!language || !exercise) {
				throw new Error("Invalid exercise path: " + path)
			}

			await db.createTask({ ...values, runId: run.id, language: language as ExerciseLanguage, exercise })
		}
	} else {
		for (const language of exerciseLanguages) {
			const exercises = await getExercisesForLanguage(language)

			await pMap(exercises, (exercise) => db.createTask({ ...values, runId: run.id, language, exercise }), {
				concurrency: 10,
			})
		}
	}

	revalidatePath("/runs")

	try {
		const logFile = fs.openSync(`/tmp/roo-code-evals-${run.id}.log`, "a")

		const process = spawn("pnpm", ["--filter", "@evals/cli", "dev", "run", "all", "--runId", run.id.toString()], {
			detached: true,
			stdio: ["ignore", logFile, logFile],
		})

		process.unref()
		await db.updateRun(run.id, { pid: process.pid })
	} catch (error) {
		console.error(error)
	}

	return run
}
