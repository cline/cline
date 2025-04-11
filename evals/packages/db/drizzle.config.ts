import { defineConfig } from "drizzle-kit"

if ((!process.env.TURSO_CONNECTION_URL || !process.env.TURSO_AUTH_TOKEN) && !process.env.BENCHMARKS_DB_PATH) {
	throw new Error("TURSO_CONNECTION_URL and TURSO_AUTH_TOKEN or BENCHMARKS_DB_PATH must be set")
}

const dialect = process.env.BENCHMARKS_DB_PATH ? "sqlite" : "turso"

const dbCredentials = process.env.BENCHMARKS_DB_PATH
	? { url: process.env.BENCHMARKS_DB_PATH }
	: { url: process.env.TURSO_CONNECTION_URL!, authToken: process.env.TURSO_AUTH_TOKEN! }

export default defineConfig({
	out: "./drizzle",
	schema: "./src/schema.ts",
	dialect,
	dbCredentials,
})
