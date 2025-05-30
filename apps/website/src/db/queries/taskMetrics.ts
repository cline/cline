import { eq } from "drizzle-orm"

import { RecordNotFoundError } from "./errors"
import { taskMetrics } from "../schema"
import { db } from "../db"

const table = taskMetrics

export const findTaskMetrics = async (id: number) => {
	const run = await db.query.taskMetrics.findFirst({ where: eq(table.id, id) })

	if (!run) {
		throw new RecordNotFoundError()
	}

	return run
}
