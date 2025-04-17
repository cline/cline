import { drizzle } from "drizzle-orm/libsql"
import { eq } from "drizzle-orm"
import pMap from "p-map"

import { db as sourceDb } from "../src/db.js"
import { schema } from "../src/schema.js"

const copyRun = async (runId: number) => {
	const destDb = drizzle({
		schema,
		connection: { url: process.env.TURSO_CONNECTION_URL!, authToken: process.env.TURSO_AUTH_TOKEN! },
	})

	const run = await sourceDb.query.runs.findFirst({
		where: eq(schema.runs.id, runId),
		with: { taskMetrics: true },
	})

	if (!run) {
		throw new Error(`Run with ID ${runId} not found in source database`)
	}

	if (!run.taskMetrics) {
		throw new Error("Run is not completed")
	}

	console.log(`Copying run ${run.id}`)

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { id: _, ...runTaskMetricsValues } = run.taskMetrics
	const [newRunTaskMetrics] = await destDb.insert(schema.taskMetrics).values(runTaskMetricsValues).returning()

	if (!newRunTaskMetrics) {
		throw new Error("Failed to insert run taskMetrics")
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { id: __, ...runValues } = run

	const [newRun] = await destDb
		.insert(schema.runs)
		.values({ ...runValues, taskMetricsId: newRunTaskMetrics.id })
		.returning()

	if (!newRun) {
		throw new Error("Failed to insert run")
	}

	const tasks = await sourceDb.query.tasks.findMany({
		where: eq(schema.tasks.runId, run.id),
		with: { taskMetrics: true },
	})

	console.log(`Copying ${tasks.length} tasks`)

	await pMap(
		tasks,
		async (task) => {
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			const { id: _, ...newTaskMetricsValues } = task.taskMetrics || {
				duration: 0,
				tokensIn: 0,
				tokensOut: 0,
				tokensContext: 0,
				cacheWrites: 0,
				cacheReads: 0,
				cost: 0,
				createdAt: new Date(),
			}

			const [newTaskMetrics] = await destDb.insert(schema.taskMetrics).values(newTaskMetricsValues).returning()

			if (!newTaskMetrics) {
				throw new Error(`Failed to insert taskMetrics for task ${task.id}`)
			}

			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			const { id: __, ...newTaskValues } = task

			const [newTask] = await destDb
				.insert(schema.tasks)
				.values({ ...newTaskValues, runId: newRun.id, taskMetricsId: newTaskMetrics.id })
				.returning()

			if (!newTask) {
				throw new Error(`Failed to insert task ${task.id}`)
			}
		},
		{ concurrency: 25 },
	)

	console.log(`\nSuccessfully copied run ${runId} with ${tasks.length} tasks`)
}

const main = async () => {
	const runId = parseInt(process.argv[2], 10)

	if (isNaN(runId)) {
		console.error("Run ID must be a number")
		process.exit(1)
	}

	try {
		await copyRun(runId)
		process.exit(0)
	} catch (error) {
		console.error(error)
		process.exit(1)
	}
}

main()
