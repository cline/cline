import { drizzle } from "drizzle-orm/libsql"

import { schema } from "./schema.js"

const connection = {
	url: process.env.BENCHMARKS_DB_PATH!,
	concurrency: 50,
}

export const db = drizzle({ schema, connection })
