import { eq } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"

import type { InsertRun, InsertTask, InsertTaskMetrics, InsertToolError } from "../schema.js"
import { schema } from "../schema.js"

import { RecordNotFoundError, RecordNotCreatedError } from "./errors.js"

export const copyRun = async ({
	sourceDb,
	targetDb,
	runId,
}: {
	sourceDb: NodePgDatabase<typeof schema>
	targetDb: NodePgDatabase<typeof schema>
	runId: number
}) => {
	const sourceRun = await sourceDb.query.runs.findFirst({
		where: eq(schema.runs.id, runId),
		with: { taskMetrics: true },
	})

	if (!sourceRun) {
		throw new RecordNotFoundError(`Run with ID ${runId} not found`)
	}

	let newRunTaskMetricsId: number | null = null

	if (sourceRun.taskMetrics) {
		const runTaskMetricsData: InsertTaskMetrics = {
			tokensIn: sourceRun.taskMetrics.tokensIn,
			tokensOut: sourceRun.taskMetrics.tokensOut,
			tokensContext: sourceRun.taskMetrics.tokensContext,
			cacheWrites: sourceRun.taskMetrics.cacheWrites,
			cacheReads: sourceRun.taskMetrics.cacheReads,
			cost: sourceRun.taskMetrics.cost,
			duration: sourceRun.taskMetrics.duration,
			toolUsage: sourceRun.taskMetrics.toolUsage,
		}

		const newRunTaskMetrics = await targetDb
			.insert(schema.taskMetrics)
			.values({
				...runTaskMetricsData,
				createdAt: new Date(),
			})
			.returning()

		const createdRunTaskMetrics = newRunTaskMetrics[0]

		if (!createdRunTaskMetrics) {
			throw new RecordNotCreatedError("Failed to create run taskMetrics")
		}

		newRunTaskMetricsId = createdRunTaskMetrics.id
	}

	const runData: InsertRun = {
		taskMetricsId: newRunTaskMetricsId,
		model: sourceRun.model,
		description: sourceRun.description,
		settings: sourceRun.settings,
		pid: sourceRun.pid,
		socketPath: sourceRun.socketPath,
		concurrency: sourceRun.concurrency,
		passed: sourceRun.passed,
		failed: sourceRun.failed,
	}

	const newRuns = await targetDb
		.insert(schema.runs)
		.values({ ...runData, createdAt: new Date() })
		.returning()

	const newRun = newRuns[0]

	if (!newRun) {
		throw new RecordNotCreatedError("Failed to create run")
	}

	const newRunId = newRun.id

	const sourceTasks = await sourceDb.query.tasks.findMany({
		where: eq(schema.tasks.runId, runId),
		with: { taskMetrics: true },
	})

	const taskIdMapping = new Map<number, number>()

	for (const sourceTask of sourceTasks) {
		let newTaskMetricsId: number | null = null

		if (sourceTask.taskMetrics) {
			const taskMetricsData: InsertTaskMetrics = {
				tokensIn: sourceTask.taskMetrics.tokensIn,
				tokensOut: sourceTask.taskMetrics.tokensOut,
				tokensContext: sourceTask.taskMetrics.tokensContext,
				cacheWrites: sourceTask.taskMetrics.cacheWrites,
				cacheReads: sourceTask.taskMetrics.cacheReads,
				cost: sourceTask.taskMetrics.cost,
				duration: sourceTask.taskMetrics.duration,
				toolUsage: sourceTask.taskMetrics.toolUsage,
			}

			const newTaskMetrics = await targetDb
				.insert(schema.taskMetrics)
				.values({ ...taskMetricsData, createdAt: new Date() })
				.returning()

			const createdTaskMetrics = newTaskMetrics[0]

			if (!createdTaskMetrics) {
				throw new RecordNotCreatedError("Failed to create task taskMetrics")
			}

			newTaskMetricsId = createdTaskMetrics.id
		}

		const taskData: InsertTask = {
			runId: newRunId,
			taskMetricsId: newTaskMetricsId,
			language: sourceTask.language,
			exercise: sourceTask.exercise,
			passed: sourceTask.passed,
			startedAt: sourceTask.startedAt,
			finishedAt: sourceTask.finishedAt,
		}

		const newTasks = await targetDb
			.insert(schema.tasks)
			.values({ ...taskData, createdAt: new Date() })
			.returning()

		const newTask = newTasks[0]

		if (!newTask) {
			throw new RecordNotCreatedError("Failed to create task")
		}

		taskIdMapping.set(sourceTask.id, newTask.id)
	}

	for (const [oldTaskId, newTaskId] of taskIdMapping) {
		const sourceTaskToolErrors = await sourceDb.query.toolErrors.findMany({
			where: eq(schema.toolErrors.taskId, oldTaskId),
		})

		for (const sourceToolError of sourceTaskToolErrors) {
			const toolErrorData: InsertToolError = {
				runId: newRunId,
				taskId: newTaskId,
				toolName: sourceToolError.toolName,
				error: sourceToolError.error,
			}

			await targetDb.insert(schema.toolErrors).values({
				...toolErrorData,
				createdAt: new Date(),
			})
		}
	}

	const sourceRunToolErrors = await sourceDb.query.toolErrors.findMany({
		where: eq(schema.toolErrors.runId, runId),
	})

	for (const sourceToolError of sourceRunToolErrors) {
		if (sourceToolError.taskId && taskIdMapping.has(sourceToolError.taskId)) {
			continue
		}

		const toolErrorData: InsertToolError = {
			runId: newRunId,
			taskId: sourceToolError.taskId ? taskIdMapping.get(sourceToolError.taskId) || null : null,
			toolName: sourceToolError.toolName,
			error: sourceToolError.error,
		}

		await targetDb.insert(schema.toolErrors).values({ ...toolErrorData, createdAt: new Date() })
	}

	return newRunId
}
