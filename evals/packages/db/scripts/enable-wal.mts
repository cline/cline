import { db } from "../src/db.js"

const main = async () => {
	// Enable WAL mode for better performance and concurrency.
	// https://til.simonwillison.net/sqlite/enabling-wal-mode
	try {
		const { rows } = await db.$client.execute("PRAGMA journal_mode = WAL;")
		const row = rows[0]

		if (row) {
			console.log(`SQLite journal mode set to: ${row[0]}`)
			process.exit(0)
		} else {
			console.error("Failed to enable WAL mode: no rows returned")
			process.exit(1)
		}
	} catch (error) {
		console.error(error)
		process.exit(1)
	}
}

main()
