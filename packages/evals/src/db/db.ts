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

let _productionPgClient: ReturnType<typeof postgres> | undefined = undefined
let _productionClient: typeof client | undefined = undefined

const getProductionClient = () => {
	if (!process.env.PRODUCTION_DATABASE_URL) {
		throw new Error("PRODUCTION_DATABASE_URL is not set")
	}

	if (!_productionClient) {
		_productionPgClient = postgres(process.env.PRODUCTION_DATABASE_URL, { prepare: false })
		_productionClient = drizzle({ client: _productionPgClient, schema })
	}

	return _productionClient
}

const disconnect = async () => {
	await pgClient.end()

	if (_productionPgClient) {
		await _productionPgClient.end()
	}
}

type DatabaseOrTransaction = typeof client | Parameters<Parameters<typeof client.transaction>[0]>[0]

export { client, testDb, getProductionClient, disconnect, type DatabaseOrTransaction }
