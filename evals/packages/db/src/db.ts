import { drizzle } from "drizzle-orm/libsql"

import { schema } from "./schema.js"

export const db = drizzle({ schema, connection: { url: process.env.BENCHMARKS_DB_PATH! } })
