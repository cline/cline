import { desc, eq, inArray, sql, sum } from "drizzle-orm"

import { ToolUsage } from "@evals/types"

import { RecordNotFoundError, RecordNotCreatedError } from "./errors.js"
import type { InsertRun, UpdateRun } from "../schema.js"
import { insertRunSchema, schema } from "../schema.js"
import { db } from "../db.js"
import { createTaskMetrics } from "./taskMetrics.js"
import { getTasks } from "./tasks.js"

const table = schema.runs

export const findRun = async (id: number) => {
	const run = await db.query.runs.findFirst({ where: eq(table.id, id) })

	if (!run) {
		throw new RecordNotFoundError()
	}

	return run
}

export const createRun = async (args: InsertRun) => {
	const records = await db
		.insert(table)
		.values({
			...insertRunSchema.parse(args),
			createdAt: new Date(),
		})
		.returning()

	const record = records[0]

	if (!record) {
		throw new RecordNotCreatedError()
	}

	return record
}

export const updateRun = async (id: number, values: UpdateRun) => {
	const records = await db.update(table).set(values).where(eq(table.id, id)).returning()
	const record = records[0]

	if (!record) {
		throw new RecordNotFoundError()
	}

	return record
}

export const getRuns = async () => db.query.runs.findMany({ orderBy: desc(table.id), with: { taskMetrics: true } })

export const finishRun = async (runId: number) => {
	const [values] = await db
		.select({
			tokensIn: sum(schema.taskMetrics.tokensIn).mapWith(Number),
			tokensOut: sum(schema.taskMetrics.tokensOut).mapWith(Number),
			tokensContext: sum(schema.taskMetrics.tokensContext).mapWith(Number),
			cacheWrites: sum(schema.taskMetrics.cacheWrites).mapWith(Number),
			cacheReads: sum(schema.taskMetrics.cacheReads).mapWith(Number),
			cost: sum(schema.taskMetrics.cost).mapWith(Number),
			duration: sum(schema.taskMetrics.duration).mapWith(Number),
			passed: sql<number>`sum(${schema.tasks.passed} = 1)`,
			failed: sql<number>`sum(${schema.tasks.passed} = 0)`,
		})
		.from(schema.taskMetrics)
		.innerJoin(schema.tasks, eq(schema.taskMetrics.id, schema.tasks.taskMetricsId))
		.innerJoin(schema.runs, eq(schema.tasks.runId, schema.runs.id))
		.where(eq(schema.runs.id, runId))

	if (!values) {
		throw new RecordNotFoundError()
	}

	const tasks = await getTasks(runId)

	const toolUsage = tasks.reduce((acc, task) => {
		Object.entries(task.taskMetrics?.toolUsage || {}).forEach(([key, { attempts, failures }]) => {
			const tool = key as keyof ToolUsage
			acc[tool] ??= { attempts: 0, failures: 0 }
			acc[tool].attempts += attempts
			acc[tool].failures += failures
		})

		return acc
	}, {} as ToolUsage)

	const { passed, failed, ...rest } = values
	const taskMetrics = await createTaskMetrics({ ...rest, toolUsage })
	await updateRun(runId, { taskMetricsId: taskMetrics.id, passed, failed })

	const run = await findRun(runId)

	if (!run) {
		throw new RecordNotFoundError()
	}

	return { ...run, taskMetrics }
}

export const deleteRun = async (runId: number) => {
	const run = await db.query.runs.findFirst({
		where: eq(schema.runs.id, runId),
		columns: { taskMetricsId: true },
	})

	if (!run) {
		throw new RecordNotFoundError()
	}

	const tasks = await db.query.tasks.findMany({
		where: eq(schema.tasks.runId, runId),
		columns: { id: true, taskMetricsId: true },
	})

	await db.delete(schema.tasks).where(eq(schema.tasks.runId, runId))
	await db.delete(schema.runs).where(eq(schema.runs.id, runId))

	const taskMetricsIds = tasks
		.map(({ taskMetricsId }) => taskMetricsId)
		.filter((id): id is number => id !== null && id !== undefined)

	taskMetricsIds.push(run.taskMetricsId ?? -1)

	await db.delete(schema.taskMetrics).where(inArray(schema.taskMetrics.id, taskMetricsIds))
}
