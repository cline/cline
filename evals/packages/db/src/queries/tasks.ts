import { and, eq } from "drizzle-orm"

import type { ExerciseLanguage } from "@evals/types"

import { RecordNotFoundError, RecordNotCreatedError } from "./errors.js"
import type { InsertTask, UpdateTask } from "../schema.js"
import { insertTaskSchema, tasks } from "../schema.js"
import { db } from "../db.js"

export const findTask = async (id: number) => {
	const run = await db.query.tasks.findFirst({ where: eq(tasks.id, id) })

	if (!run) {
		throw new RecordNotFoundError()
	}

	return run
}

export const createTask = async (args: InsertTask) => {
	const records = await db
		.insert(tasks)
		.values({
			...insertTaskSchema.parse(args),
			createdAt: new Date(),
		})
		.returning()

	const record = records[0]

	if (!record) {
		throw new RecordNotCreatedError()
	}

	return record
}

export const updateTask = async (id: number, values: UpdateTask) => {
	const records = await db.update(tasks).set(values).where(eq(tasks.id, id)).returning()
	const record = records[0]

	if (!record) {
		throw new RecordNotFoundError()
	}

	return record
}

type GetTask = {
	runId: number
	language: ExerciseLanguage
	exercise: string
}

export const getTask = async ({ runId, language, exercise }: GetTask) =>
	db.query.tasks.findFirst({
		where: and(eq(tasks.runId, runId), eq(tasks.language, language), eq(tasks.exercise, exercise)),
	})

export const getTasks = async (runId: number) =>
	db.query.tasks.findMany({ where: eq(tasks.runId, runId), with: { taskMetrics: true } })
