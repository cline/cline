import { RecordNotCreatedError } from "./errors.js"
import type { InsertToolError } from "../schema.js"
import { insertToolErrorSchema, toolErrors } from "../schema.js"
import { db } from "../db.js"

export const createToolError = async (args: InsertToolError) => {
	const records = await db
		.insert(toolErrors)
		.values({
			...insertToolErrorSchema.parse(args),
			createdAt: new Date(),
		})
		.returning()

	const record = records[0]

	if (!record) {
		throw new RecordNotCreatedError()
	}

	return record
}
