import { eq } from "drizzle-orm"

import { RecordNotFoundError, RecordNotCreatedError } from "./errors.js"
import type { InsertTaskMetrics, UpdateTaskMetrics } from "../schema.js"
import { taskMetrics } from "../schema.js"
import { client as db } from "../db.js"

export const findTaskMetrics = async (id: number) => {
	const run = await db.query.taskMetrics.findFirst({ where: eq(taskMetrics.id, id) })

	if (!run) {
		throw new RecordNotFoundError()
	}

	return run
}

export const createTaskMetrics = async (args: InsertTaskMetrics) => {
	const records = await db
		.insert(taskMetrics)
		.values({
			...args,
			createdAt: new Date(),
		})
		.returning()

	const record = records[0]

	if (!record) {
		throw new RecordNotCreatedError()
	}

	return record
}

export const updateTaskMetrics = async (id: number, values: UpdateTaskMetrics) => {
	const records = await db.update(taskMetrics).set(values).where(eq(taskMetrics.id, id)).returning()
	const record = records[0]

	if (!record) {
		throw new RecordNotFoundError()
	}

	return record
}
