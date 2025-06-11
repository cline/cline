// npx vitest run src/db/queries/__tests__/copyRun.spec.ts

import { eq } from "drizzle-orm"

import { copyRun } from "../copyRun.js"
import { createRun } from "../runs.js"
import { createTask } from "../tasks.js"
import { createTaskMetrics } from "../taskMetrics.js"
import { createToolError } from "../toolErrors.js"
import { RecordNotFoundError } from "../errors.js"
import { schema } from "../../schema.js"
import { client as db } from "../../db.js"

describe("copyRun", () => {
	let sourceRunId: number
	let sourceTaskIds: number[] = []
	let sourceTaskMetricsIds: number[] = []
	let sourceToolErrorIds: number[] = []

	beforeEach(async () => {
		const run = await createRun({
			model: "gpt-4.1-mini",
			socketPath: "/tmp/roo.sock",
			description: "Test run for copying",
			concurrency: 4,
		})

		sourceRunId = run.id

		const runTaskMetrics = await createTaskMetrics({
			duration: 120_000,
			tokensIn: 200_000,
			tokensOut: 5_000,
			tokensContext: 205_000,
			cacheWrites: 10,
			cacheReads: 5,
			cost: 0.15,
			toolUsage: {
				read_file: { attempts: 10, failures: 1 },
				apply_diff: { attempts: 8, failures: 2 },
			},
		})

		sourceTaskMetricsIds.push(runTaskMetrics.id)

		await db
			.update(schema.runs)
			.set({ taskMetricsId: runTaskMetrics.id, passed: 2, failed: 1 })
			.where(eq(schema.runs.id, sourceRunId))

		const task1TaskMetrics = await createTaskMetrics({
			duration: 45_000,
			tokensIn: 100_000,
			tokensOut: 2_000,
			tokensContext: 102_000,
			cacheWrites: 0,
			cacheReads: 0,
			cost: 0.05,
			toolUsage: {
				read_file: { attempts: 3, failures: 0 },
				apply_diff: { attempts: 3, failures: 1 },
			},
		})

		sourceTaskMetricsIds.push(task1TaskMetrics.id)

		const task1 = await createTask({
			runId: sourceRunId,
			taskMetricsId: task1TaskMetrics.id,
			language: "go",
			exercise: "go/say",
			passed: true,
			startedAt: new Date("2023-01-01T10:00:00Z"),
			finishedAt: new Date("2023-01-01T10:45:00Z"),
		})

		sourceTaskIds.push(task1.id)

		const task2TaskMetrics = await createTaskMetrics({
			duration: 30_000,
			tokensIn: 75_000,
			tokensOut: 1_000,
			tokensContext: 76_000,
			cacheWrites: 0,
			cacheReads: 0,
			cost: 0.04,
			toolUsage: {
				read_file: { attempts: 3, failures: 0 },
				apply_diff: { attempts: 2, failures: 0 },
			},
		})

		sourceTaskMetricsIds.push(task2TaskMetrics.id)

		const task2 = await createTask({
			runId: sourceRunId,
			taskMetricsId: task2TaskMetrics.id,
			language: "python",
			exercise: "python/hello-world",
			passed: false,
			startedAt: new Date("2023-01-01T11:00:00Z"),
			finishedAt: new Date("2023-01-01T11:30:00Z"),
		})

		sourceTaskIds.push(task2.id)

		const task3 = await createTask({
			runId: sourceRunId,
			taskMetricsId: null,
			language: "rust",
			exercise: "rust/hello-world",
			passed: true,
			startedAt: new Date("2023-01-01T12:00:00Z"),
			finishedAt: new Date("2023-01-01T12:15:00Z"),
		})

		sourceTaskIds.push(task3.id)

		const toolError1 = await createToolError({
			runId: sourceRunId,
			taskId: task1.id,
			toolName: "apply_diff",
			error: "Syntax error in diff",
		})

		sourceToolErrorIds.push(toolError1.id)

		const toolError2 = await createToolError({
			runId: sourceRunId,
			taskId: task2.id,
			toolName: "execute_command",
			error: "Command failed with exit code 1",
		})

		sourceToolErrorIds.push(toolError2.id)

		const toolError3 = await createToolError({
			runId: sourceRunId,
			taskId: null,
			toolName: "browser_action",
			error: "Browser connection timeout",
		})

		sourceToolErrorIds.push(toolError3.id)
	})

	afterEach(async () => {
		if (sourceToolErrorIds.length > 0) {
			await db.delete(schema.toolErrors).where(eq(schema.toolErrors.runId, sourceRunId))
		}

		if (sourceTaskIds.length > 0) {
			await db.delete(schema.tasks).where(eq(schema.tasks.runId, sourceRunId))
		}

		await db.delete(schema.runs).where(eq(schema.runs.id, sourceRunId))

		if (sourceTaskMetricsIds.length > 0) {
			for (const id of sourceTaskMetricsIds) {
				await db.delete(schema.taskMetrics).where(eq(schema.taskMetrics.id, id))
			}
		}

		sourceTaskIds = []
		sourceTaskMetricsIds = []
		sourceToolErrorIds = []
	})

	it("should copy a complete run with all related data", async () => {
		const newRunId = await copyRun({ sourceDb: db, targetDb: db, runId: sourceRunId })

		expect(newRunId).toBeDefined()
		expect(newRunId).not.toBe(sourceRunId)

		const copiedRun = await db.query.runs.findFirst({
			where: eq(schema.runs.id, newRunId),
			with: { taskMetrics: true },
		})

		expect(copiedRun).toBeDefined()
		expect(copiedRun!.model).toBe("gpt-4.1-mini")
		expect(copiedRun!.description).toBe("Test run for copying")
		expect(copiedRun!.concurrency).toBe(4)
		expect(copiedRun!.passed).toBe(2)
		expect(copiedRun!.failed).toBe(1)
		expect(copiedRun!.taskMetrics).toBeDefined()

		expect(copiedRun!.taskMetrics!.duration).toBe(120_000)
		expect(copiedRun!.taskMetrics!.tokensIn).toBe(200_000)
		expect(copiedRun!.taskMetrics!.toolUsage).toEqual({
			read_file: { attempts: 10, failures: 1 },
			apply_diff: { attempts: 8, failures: 2 },
		})

		const copiedTasks = await db.query.tasks.findMany({
			where: eq(schema.tasks.runId, newRunId),
			with: { taskMetrics: true },
			orderBy: (tasks, { asc }) => [asc(tasks.language)],
		})

		expect(copiedTasks).toHaveLength(3)

		const goTask = copiedTasks.find((t) => t.language === "go")!
		expect(goTask.exercise).toBe("go/say")
		expect(goTask.passed).toBe(true)
		expect(goTask.taskMetrics).toBeDefined()
		expect(goTask.taskMetrics!.duration).toBe(45_000)
		expect(goTask.taskMetrics!.toolUsage).toEqual({
			read_file: { attempts: 3, failures: 0 },
			apply_diff: { attempts: 3, failures: 1 },
		})

		const pythonTask = copiedTasks.find((t) => t.language === "python")!
		expect(pythonTask.exercise).toBe("python/hello-world")
		expect(pythonTask.passed).toBe(false)
		expect(pythonTask.taskMetrics).toBeDefined()
		expect(pythonTask.taskMetrics!.duration).toBe(30_000)

		const rustTask = copiedTasks.find((t) => t.language === "rust")!
		expect(rustTask.exercise).toBe("rust/hello-world")
		expect(rustTask.passed).toBe(true)
		expect(rustTask.taskMetrics).toBeNull()

		const copiedToolErrors = await db.query.toolErrors.findMany({
			where: eq(schema.toolErrors.runId, newRunId),
		})

		expect(copiedToolErrors).toHaveLength(3)

		const taskToolErrors = copiedToolErrors.filter((te) => te.taskId !== null)
		const runToolErrors = copiedToolErrors.filter((te) => te.taskId === null)

		expect(taskToolErrors).toHaveLength(2)
		expect(runToolErrors).toHaveLength(1)

		const browserError = runToolErrors.find((te) => te.toolName === "browser_action")!
		expect(browserError.error).toBe("Browser connection timeout")

		await db.delete(schema.toolErrors).where(eq(schema.toolErrors.runId, newRunId))
		await db.delete(schema.tasks).where(eq(schema.tasks.runId, newRunId))

		const copiedRunForCleanup = await db.query.runs.findFirst({
			where: eq(schema.runs.id, newRunId),
			columns: { taskMetricsId: true },
		})

		await db.delete(schema.runs).where(eq(schema.runs.id, newRunId))

		const copiedTasksForCleanup = await db.query.tasks.findMany({
			where: eq(schema.tasks.runId, newRunId),
			columns: { taskMetricsId: true },
		})

		const taskMetricsToDelete = copiedTasksForCleanup
			.map((t) => t.taskMetricsId)
			.filter((id): id is number => id !== null)

		if (copiedRunForCleanup?.taskMetricsId) {
			taskMetricsToDelete.push(copiedRunForCleanup.taskMetricsId)
		}

		if (taskMetricsToDelete.length > 0) {
			for (const id of taskMetricsToDelete) {
				await db.delete(schema.taskMetrics).where(eq(schema.taskMetrics.id, id))
			}
		}
	})

	it("should throw RecordNotFoundError for non-existent run", async () => {
		await expect(copyRun({ sourceDb: db, targetDb: db, runId: 999999 })).rejects.toThrow(RecordNotFoundError)
	})

	it("should copy run without task metrics", async () => {
		const minimalRun = await createRun({ model: "gpt-3.5-turbo", socketPath: "/tmp/minimal.sock" })

		const newRunId = await copyRun({ sourceDb: db, targetDb: db, runId: minimalRun.id })

		const copiedRun = await db.query.runs.findFirst({ where: eq(schema.runs.id, newRunId) })

		expect(copiedRun).toBeDefined()
		expect(copiedRun!.model).toBe("gpt-3.5-turbo")
		expect(copiedRun!.taskMetricsId).toBeNull()

		await db.delete(schema.runs).where(eq(schema.runs.id, minimalRun.id))
		await db.delete(schema.runs).where(eq(schema.runs.id, newRunId))
	})
})
