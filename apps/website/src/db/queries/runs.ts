import { desc, eq } from "drizzle-orm"

import { RecordNotFoundError } from "./errors"
import { schema } from "../schema"
import { db } from "../db"

const table = schema.runs

export const findRun = async (id: number) => {
	const run = await db.query.runs.findFirst({ where: eq(table.id, id) })

	if (!run) {
		throw new RecordNotFoundError()
	}

	return run
}

export const getRuns = async () => db.query.runs.findMany({ orderBy: desc(table.id), with: { taskMetrics: true } })
