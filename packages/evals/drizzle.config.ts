import { defineConfig } from "drizzle-kit"

export default defineConfig({
	out: "./src/db/migrations",
	schema: "./src/db/schema.ts",
	dialect: "postgresql",
	dbCredentials: { url: process.env.DATABASE_URL! },
	verbose: true,
	strict: true,
})
