import { sql } from "drizzle-orm"

import { testDb, disconnect } from "./src/db/db.js"

async function resetTestDatabase() {
	const db = testDb

	if (!db) {
		console.log("No database connection available, skipping database reset")
		return
	}

	try {
		const tables = await db.execute<{ table_name: string }>(sql`
			SELECT table_name
			FROM information_schema.tables
			WHERE table_schema = 'public'
			AND table_type = 'BASE TABLE';
		`)

		const tableNames = tables.map((t) => t.table_name)

		for (const tableName of tableNames) {
			await db.execute(sql`TRUNCATE TABLE "${sql.raw(tableName)}" CASCADE;`)
		}

		console.log(`[${process.env.DATABASE_URL}] TRUNCATE ${tableNames.join(", ")}`)
	} catch (error) {
		console.error("Error resetting database:", error)
		throw error
	}
}

export default async function () {
	await resetTestDatabase()

	return async () => {
		await disconnect()
	}
}
