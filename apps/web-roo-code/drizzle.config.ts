import { defineConfig } from "drizzle-kit"

const dialect = process.env.BENCHMARKS_DB_PATH ? "sqlite" : "turso"

const dbCredentials = process.env.BENCHMARKS_DB_PATH
	? { url: process.env.BENCHMARKS_DB_PATH }
	: { url: process.env.TURSO_CONNECTION_URL!, authToken: process.env.TURSO_AUTH_TOKEN! }

export default defineConfig({
	out: "./drizzle",
	schema: "./src/db/schema.ts",
	dialect,
	dbCredentials,
})
