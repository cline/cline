import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import * as schema from "./schema.js"

const pgClient = postgres(process.env.DATABASE_URL!, { prepare: false })

const client = drizzle({ client: pgClient, schema })

let testDb: typeof client | undefined = undefined

if (process.env.NODE_ENV === "test") {
	if (!process.env.DATABASE_URL!.includes("test") || !process.env.DATABASE_URL!.includes("localhost")) {
		throw new Error("DATABASE_URL is not a test database")
	}

	testDb = client
}

const disconnect = async () => {
	await pgClient.end()
}

type DatabaseOrTransaction = typeof client | Parameters<Parameters<typeof client.transaction>[0]>[0]

export { client, testDb, disconnect, type DatabaseOrTransaction }
