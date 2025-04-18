import { createRun, finishRun } from "../runs.js"
import { createTask } from "../tasks.js"
import { createTaskMetrics } from "../taskMetrics.js"

describe("finishRun", () => {
	it("aggregates task metrics, including tool usage", async () => {
		const run = await createRun({ model: "gpt-4.1-mini", socketPath: "/tmp/roo.sock" })

		await createTask({
			runId: run.id,
			taskMetricsId: (
				await createTaskMetrics({
					duration: 45_000,
					tokensIn: 100_000,
					tokensOut: 2_000,
					tokensContext: 102_000,
					cacheWrites: 0,
					cacheReads: 0,
					cost: 0.05,
					toolUsage: {
						read_file: {
							attempts: 3,
							failures: 0,
						},
						apply_diff: {
							attempts: 3,
							failures: 1,
						},
					},
				})
			).id,
			language: "go",
			exercise: "go/say",
			passed: true,
			startedAt: new Date(),
			finishedAt: new Date(),
		})

		await createTask({
			runId: run.id,
			taskMetricsId: (
				await createTaskMetrics({
					duration: 30_000,
					tokensIn: 75_000,
					tokensOut: 1_000,
					tokensContext: 76_000,
					cacheWrites: 0,
					cacheReads: 0,
					cost: 0.04,
					toolUsage: {
						read_file: {
							attempts: 3,
							failures: 0,
						},
						apply_diff: {
							attempts: 2,
							failures: 0,
						},
					},
				})
			).id,
			language: "go",
			exercise: "go/octal",
			passed: true,
			startedAt: new Date(),
			finishedAt: new Date(),
		})

		const { taskMetrics } = await finishRun(run.id)

		expect(taskMetrics).toEqual({
			id: expect.any(Number),
			tokensIn: 175000,
			tokensOut: 3000,
			tokensContext: 178000,
			cacheWrites: 0,
			cacheReads: 0,
			cost: 0.09,
			duration: 75000,
			toolUsage: {
				read_file: { attempts: 6, failures: 0 },
				apply_diff: { attempts: 5, failures: 1 },
			},
			createdAt: expect.any(Date),
		})
	})
})
