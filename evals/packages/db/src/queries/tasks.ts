import { and, eq } from "drizzle-orm"

import type { ExerciseLanguage } from "@evals/types"

import { RecordNotFoundError, RecordNotCreatedError } from "./errors.js"
import type { InsertTask, UpdateTask } from "../schema.js"
import { insertTaskSchema, tasks } from "../schema.js"
import { db } from "../db.js"

const table = tasks

export const findTask = async (id: number) => {
	const run = await db.query.tasks.findFirst({ where: eq(table.id, id) })

	if (!run) {
		throw new RecordNotFoundError()
	}

	return run
}

export const createTask = async (args: InsertTask) => {
	const records = await db
		.insert(table)
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
	const records = await db.update(table).set(values).where(eq(table.id, id)).returning()
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
		where: and(eq(table.runId, runId), eq(table.language, language), eq(table.exercise, exercise)),
	})

export const getTasks = async (runId: number) =>
	db.query.tasks.findMany({ where: eq(table.runId, runId), with: { taskMetrics: true } })
