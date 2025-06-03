import { and, eq } from "drizzle-orm"

import { RecordNotFoundError } from "./errors"
import { tasks } from "../schema"
import { db } from "../db"

export const findTask = async (id: number) => {
	const run = await db.query.tasks.findFirst({ where: eq(tasks.id, id) })

	if (!run) {
		throw new RecordNotFoundError()
	}

	return run
}

type GetTask = {
	runId: number
	language: string
	exercise: string
}

export const getTask = async ({ runId, language, exercise }: GetTask) =>
	db.query.tasks.findFirst({
		where: and(eq(tasks.runId, runId), eq(tasks.language, language), eq(tasks.exercise, exercise)),
	})

export const getTasks = async (runId: number) =>
	db.query.tasks.findMany({ where: eq(tasks.runId, runId), with: { taskMetrics: true } })
