import { drizzle } from "drizzle-orm/libsql"

import { schema } from "./schema.js"

if ((!process.env.TURSO_CONNECTION_URL || !process.env.TURSO_AUTH_TOKEN) && !process.env.BENCHMARKS_DB_PATH) {
	throw new Error("TURSO_CONNECTION_URL and TURSO_AUTH_TOKEN or BENCHMARKS_DB_PATH must be set")
}

const connection = process.env.BENCHMARKS_DB_PATH
	? { url: process.env.BENCHMARKS_DB_PATH, concurrency: 50 }
	: { url: process.env.TURSO_CONNECTION_URL!, authToken: process.env.TURSO_AUTH_TOKEN! }

export const db = drizzle({ schema, connection })
