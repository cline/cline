import type { ScheduledTask } from "@shared/scheduled-next-task"
import type { Mode } from "@shared/storage/types"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { StateManager } from "@/core/storage/StateManager"
import {
	buildAutoNextTaskPrompt,
	buildScheduledTaskPrompt,
	MAX_AUTO_NEXT_TASK_CHAIN_DEPTH,
	SdkAutoNextTaskCoordinator,
	type SdkAutoNextTaskCoordinatorOptions,
} from "./sdk-auto-next-task-coordinator"

const { summarizeConversation } = vi.hoisted(() => ({ summarizeConversation: vi.fn() }))
vi.mock("@cline/core", () => ({
	summarizeConversation: (input: unknown) => summarizeConversation(input),
}))
vi.mock("@/shared/services/Logger", () => ({
	Logger: { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: vi.fn() },
}))

interface FakeState {
	autoStartNextTask: boolean
	includePreviousTaskSummary: boolean
	autoNextTaskChainDepth: number
	autoNextTaskParentTaskId: string | undefined
	mode: Mode
	scheduledTasks: ScheduledTask[]
	scheduledTasksPaused: boolean
}

/** One queue row, with the two fields every test would otherwise repeat. */
function row(id: string, overrides: Partial<ScheduledTask> = {}): ScheduledTask {
	return { id, message: "", mode: "act", includeSummary: true, createdAt: 1_700_000_000_000, ...overrides }
}

/**
 * Mirrors the persisted-global-state semantics the coordinator relies on: writes
 * land in a plain object, and a new coordinator over the same object sees them —
 * which is what an extension restart does.
 */
function makeStateManager(overrides: Partial<FakeState> = {}) {
	const values: FakeState = {
		autoStartNextTask: true,
		includePreviousTaskSummary: true,
		autoNextTaskChainDepth: 0,
		autoNextTaskParentTaskId: undefined,
		mode: "act",
		scheduledTasks: [],
		scheduledTasksPaused: false,
		...overrides,
	}
	return {
		values,
		stateManager: {
			getGlobalSettingsKey: (key: string) => (values as unknown as Record<string, unknown>)[key],
			getGlobalStateKey: (key: string) => (values as unknown as Record<string, unknown>)[key],
			setGlobalState: (key: string, value: unknown) => {
				;(values as unknown as Record<string, unknown>)[key] = value
			},
		} as unknown as StateManager,
	}
}

function makeCoordinator(overrides: Partial<FakeState> = {}) {
	const { values, stateManager } = makeStateManager(overrides)
	const readMessages = vi.fn(async () => [{ role: "user", content: "Implement authentication" }])
	const stop = vi.fn(async () => {})
	const del = vi.fn(async () => true)
	const sdkHost = { readMessages, stop, delete: del }
	let activeSession:
		| {
				sessionId: string
				sdkHost: typeof sdkHost
				isRunning: boolean
				queuedPromptCount: number
				unsubscribe: () => void
		  }
		| undefined = {
		sessionId: "task-1",
		sdkHost,
		isRunning: false,
		queuedPromptCount: 0,
		unsubscribe: () => {},
	}
	const sessionConfig = {
		providerId: "anthropic",
		modelId: "claude-sonnet-4-5",
		apiKey: "secret-key",
		baseUrl: undefined,
		headers: undefined,
		providerConfig: { providerId: "anthropic" },
	}
	const options = {
		stateManager,
		sessions: { getActiveSession: () => activeSession },
		rebuilds: { runExclusive: (operation: () => Promise<unknown>) => operation() as Promise<void> },
		sessionConfigBuilder: { build: vi.fn(async () => sessionConfig) },
		getWorkspaceRoot: vi.fn(async () => "/workspace/repo"),
		getCurrentMode: () => "act",
		initTask: vi.fn(async () => "task-2"),
		clearTask: vi.fn(async () => {}),
		showChatView: vi.fn(async () => {}),
		notify: vi.fn(),
	} as unknown as SdkAutoNextTaskCoordinatorOptions
	const coordinator = new SdkAutoNextTaskCoordinator(options)
	return {
		coordinator,
		options,
		values,
		summary: {
			summarizeConversation,
			readMessages,
			stop,
			delete: del,
			deactivate: () => {
				activeSession = undefined
			},
			setActiveSession: (sessionId: string, state: { isRunning?: boolean; queuedPromptCount?: number } = {}) => {
				activeSession = {
					sessionId,
					sdkHost,
					isRunning: state.isRunning ?? false,
					queuedPromptCount: state.queuedPromptCount ?? 0,
					unsubscribe: () => {},
				}
			},
		},
	}
}

describe("SdkAutoNextTaskCoordinator", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("leaves behavior untouched when automatic chaining is disabled", async () => {
		const { coordinator, options } = makeCoordinator({ autoStartNextTask: false })
		summarizeConversation.mockResolvedValue("should not run")

		await coordinator.handleTaskCompleted("task-1")

		expect(options.initTask).not.toHaveBeenCalled()
		expect(options.clearTask).not.toHaveBeenCalled()
		expect(options.notify).not.toHaveBeenCalled()
		expect(summarizeConversation).not.toHaveBeenCalled()
	})

	it("starts a new chat carrying the completed task's summary", async () => {
		const { coordinator, options } = makeCoordinator()
		summarizeConversation.mockResolvedValue(
			"- Implemented JWT authentication.\n- Added login and logout endpoints.\n- Remaining: integration tests.",
		)

		await coordinator.handleTaskCompleted("task-1")

		expect(summarizeConversation).toHaveBeenCalledOnce()
		expect(options.initTask).toHaveBeenCalledOnce()
		const prompt = (options.initTask as unknown as { mock: { calls: string[][] } }).mock.calls[0][0]
		expect(prompt).toBe(
			buildAutoNextTaskPrompt(
				"- Implemented JWT authentication.\n- Added login and logout endpoints.\n- Remaining: integration tests.",
			),
		)
		expect(prompt).toContain("Continue from the previous task.")
		expect(prompt).toContain("Summary:")
		expect(options.notify).toHaveBeenCalledWith(
			"Task completed. Starting a new chat with the previous task summary.",
			"information",
		)
		expect(options.showChatView).toHaveBeenCalledOnce()
	})

	it("formats the handoff prompt with the objective, work and next steps", () => {
		expect(buildAutoNextTaskPrompt("  did the thing  ")).toBe("Continue from the previous task.\n\nSummary:\ndid the thing")
	})

	it("starts an empty new chat and summarizes nothing when summary transfer is off", async () => {
		const { coordinator, options } = makeCoordinator({ includePreviousTaskSummary: false })

		await coordinator.handleTaskCompleted("task-1")

		expect(summarizeConversation).not.toHaveBeenCalled()
		expect(options.initTask).not.toHaveBeenCalled()
		expect(options.clearTask).toHaveBeenCalledOnce()
		expect(options.notify).toHaveBeenCalledWith("Task completed. Started a new chat.", "information")
	})

	it("keeps the workspace, mode and provider/model configuration of the completed task", async () => {
		const { coordinator, options } = makeCoordinator()
		summarizeConversation.mockResolvedValue("summary")

		await coordinator.handleTaskCompleted("task-1")

		const builder = options.sessionConfigBuilder as unknown as { build: ReturnType<typeof vi.fn> }
		expect(builder.build).toHaveBeenCalledWith({ cwd: "/workspace/repo", mode: "act" })
		expect(summarizeConversation).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: [{ role: "user", content: "Implement authentication" }],
				config: expect.objectContaining({
					providerId: "anthropic",
					modelId: "claude-sonnet-4-5",
					apiKey: "secret-key",
					providerConfig: { providerId: "anthropic" },
				}),
			}),
		)
		// The new chat is created with no task-settings override, so it inherits
		// the current provider/model selection exactly like a typed prompt would.
		expect(options.initTask).toHaveBeenCalledWith(expect.any(String), undefined)
	})

	it("never tears down the completed task or its history", async () => {
		const { coordinator, summary } = makeCoordinator()
		summarizeConversation.mockResolvedValue("summary")

		await coordinator.handleTaskCompleted("task-1")

		expect(summary.stop).not.toHaveBeenCalled()
		expect(summary.delete).not.toHaveBeenCalled()
		expect(summary.readMessages).toHaveBeenCalledWith("task-1")
	})

	it("creates exactly one new chat for duplicate completion events of one task", async () => {
		const { coordinator, options } = makeCoordinator()
		summarizeConversation.mockResolvedValue("summary")

		await Promise.all([coordinator.handleTaskCompleted("task-1"), coordinator.handleTaskCompleted("task-1")])
		await coordinator.handleTaskCompleted("task-1")

		expect(options.initTask).toHaveBeenCalledOnce()
		expect(options.clearTask).not.toHaveBeenCalled()
	})

	it("creates only one chained chat for one task across an extension restart", async () => {
		const { coordinator, options } = makeCoordinator()
		summarizeConversation.mockResolvedValue("summary")

		await coordinator.handleTaskCompleted("task-1")
		expect(options.initTask).toHaveBeenCalledOnce()

		// A fresh coordinator over the same persisted state models a reload of the
		// extension host, where the in-memory duplicate claim starts out empty.
		const restarted = new SdkAutoNextTaskCoordinator(options)
		await restarted.handleTaskCompleted("task-1")

		expect(options.initTask).toHaveBeenCalledOnce()
		expect(options.notify).toHaveBeenCalledOnce()
	})

	it("keeps the completed task visible and warns when the summary cannot be created", async () => {
		const { coordinator, options } = makeCoordinator()
		summarizeConversation.mockRejectedValue(new Error("provider rejected the summarizer request"))

		await coordinator.handleTaskCompleted("task-1")

		expect(options.initTask).not.toHaveBeenCalled()
		expect(options.clearTask).not.toHaveBeenCalled()
		expect(options.notify).toHaveBeenCalledWith(
			"Task completed, but a new chat was not started because its summary could not be created.",
			"warning",
		)
		// A failed handoff must not be credited to the chain either.
		expect(coordinator.chainDepth).toBe(0)
	})

	it("does not open a half-populated chat when the summarizer returns nothing", async () => {
		const { coordinator, options } = makeCoordinator()
		summarizeConversation.mockResolvedValue("   ")

		await coordinator.handleTaskCompleted("task-1")

		expect(options.initTask).not.toHaveBeenCalled()
		expect(options.notify).toHaveBeenCalledWith(
			"Task completed, but a new chat was not started because its summary could not be created.",
			"warning",
		)
	})

	it("does not chain once the completed task is no longer the one in view", async () => {
		const { coordinator, options, summary } = makeCoordinator()
		summarizeConversation.mockResolvedValue("summary")
		summary.deactivate()

		await coordinator.handleTaskCompleted("task-1")

		expect(summarizeConversation).not.toHaveBeenCalled()
		expect(options.initTask).not.toHaveBeenCalled()
		expect(options.clearTask).not.toHaveBeenCalled()
		expect(options.notify).not.toHaveBeenCalled()
	})

	it("does not chain when the user queued a follow-up on the completed task", async () => {
		const { coordinator, options, summary } = makeCoordinator()
		summarizeConversation.mockResolvedValue("summary")
		summary.setActiveSession("task-1", { queuedPromptCount: 1 })

		await coordinator.handleTaskCompleted("task-1")

		expect(summarizeConversation).not.toHaveBeenCalled()
		expect(options.initTask).not.toHaveBeenCalled()
	})

	it("drops the handoff when the user takes the task over while its summary is written", async () => {
		const { coordinator, options, summary, values } = makeCoordinator()
		summarizeConversation.mockImplementation(async () => {
			// A follow-up message lands mid-handoff: the user's transition wins.
			summary.setActiveSession("task-1", { isRunning: true })
			return "summary"
		})

		await coordinator.handleTaskCompleted("task-1")

		expect(summarizeConversation).toHaveBeenCalledOnce()
		expect(options.initTask).not.toHaveBeenCalled()
		expect(options.notify).not.toHaveBeenCalled()
		expect(values.autoNextTaskChainDepth).toBe(0)
	})

	it("never chains a cloud sandbox task into a local chat", async () => {
		const { coordinator, options } = makeCoordinator()
		summarizeConversation.mockResolvedValue("summary")

		await coordinator.handleTaskCompleted("ses-12345")

		expect(options.initTask).not.toHaveBeenCalled()
		expect(options.notify).not.toHaveBeenCalled()
	})

	it("records the chain link and depth after each automatic handoff", async () => {
		const { coordinator, options, values } = makeCoordinator()
		summarizeConversation.mockResolvedValue("summary")

		await coordinator.handleTaskCompleted("task-1")

		expect(values.autoNextTaskChainDepth).toBe(1)
		expect(values.autoNextTaskParentTaskId).toBe("task-1")
		expect(options.initTask).toHaveBeenCalledOnce()
	})

	it("stops chaining at the maximum depth and tells the user", async () => {
		const { coordinator, options } = makeCoordinator({ autoNextTaskChainDepth: MAX_AUTO_NEXT_TASK_CHAIN_DEPTH })
		summarizeConversation.mockResolvedValue("summary")

		await coordinator.handleTaskCompleted("task-1")

		expect(summarizeConversation).not.toHaveBeenCalled()
		expect(options.initTask).not.toHaveBeenCalled()
		expect(options.clearTask).not.toHaveBeenCalled()
		expect(options.notify).toHaveBeenCalledWith(
			`Automatic next chats stopped after ${MAX_AUTO_NEXT_TASK_CHAIN_DEPTH} tasks in a row. Start a new task to begin a fresh chain.`,
			"warning",
		)
	})

	it("carries the chain ceiling across an extension restart", async () => {
		// First window: five chained tasks exhaust the ceiling.
		const firstWindow = makeCoordinator()
		summarizeConversation.mockResolvedValue("summary")
		for (let index = 1; index <= MAX_AUTO_NEXT_TASK_CHAIN_DEPTH; index += 1) {
			firstWindow.summary.setActiveSession(`task-${index}`)
			await firstWindow.coordinator.handleTaskCompleted(`task-${index}`)
		}
		expect(firstWindow.values.autoNextTaskChainDepth).toBe(MAX_AUTO_NEXT_TASK_CHAIN_DEPTH)
		expect(firstWindow.options.initTask).toHaveBeenCalledTimes(MAX_AUTO_NEXT_TASK_CHAIN_DEPTH)

		// A fresh coordinator over the same persisted state (the restarted
		// extension) still refuses to chain a sixth task.
		const restarted = new SdkAutoNextTaskCoordinator({
			...firstWindow.options,
			notify: vi.fn(),
		})
		await restarted.handleTaskCompleted("task-after-restart")
		expect(firstWindow.options.initTask).toHaveBeenCalledTimes(MAX_AUTO_NEXT_TASK_CHAIN_DEPTH)
		expect(restarted.chainDepth).toBe(MAX_AUTO_NEXT_TASK_CHAIN_DEPTH)
	})

	it("marks its own start so the controller keeps the chain, and resets on a manual start", async () => {
		// The controller's task-start entry point consumes the marker: an
		// auto-chained start is not treated as a manual one.
		let startWasMarkedAsAutomatic: boolean | undefined
		const { options, values } = makeCoordinator()
		const chained = new SdkAutoNextTaskCoordinator({
			...options,
			initTask: async () => {
				startWasMarkedAsAutomatic = chained.consumeChainHandoff()
				return "task-2"
			},
		})
		summarizeConversation.mockResolvedValue("summary")

		await chained.handleTaskCompleted("task-1")

		expect(startWasMarkedAsAutomatic).toBe(true)
		expect(values.autoNextTaskChainDepth).toBe(1)
		expect(chained.consumeChainHandoff()).toBe(false)

		// The user starts an unrelated task: the chain is broken.
		chained.resetChainDepth("manual task start")
		expect(values.autoNextTaskChainDepth).toBe(0)
		expect(values.autoNextTaskParentTaskId).toBeUndefined()
	})

	it("clears the chain marker when the chained start fails", async () => {
		const { coordinator, options, values } = makeCoordinator()
		const failing = new SdkAutoNextTaskCoordinator({
			...options,
			initTask: vi.fn(async () => undefined) as unknown as SdkAutoNextTaskCoordinatorOptions["initTask"],
		})
		summarizeConversation.mockResolvedValue("summary")

		await failing.handleTaskCompleted("task-1")

		expect(failing.consumeChainHandoff()).toBe(false)
		expect(values.autoNextTaskChainDepth).toBe(0)
		expect(coordinator.chainDepth).toBe(0)
	})

	it("formats a queued message on its own, with a summary, or not at all", () => {
		expect(buildScheduledTaskPrompt(row("a", { message: "Add the tests" }))).toBe("Add the tests")
		expect(buildScheduledTaskPrompt(undefined, "did the thing")).toBe(buildAutoNextTaskPrompt("did the thing"))
		expect(buildScheduledTaskPrompt(row("a", { message: "Add the tests" }), "did the thing")).toBe(
			"Continue from the previous task.\n\nSummary:\ndid the thing\n\nNext step you asked for:\nAdd the tests",
		)
		expect(buildScheduledTaskPrompt(row("a", { message: "   " }), "  ")).toBe("")
	})

	it("starts the queued chat at completion even with the setting off", async () => {
		const { coordinator, options, values } = makeCoordinator({ autoStartNextTask: false })
		values.scheduledTasks = [row("row-1", { message: "Add the tests", mode: "plan" })]
		summarizeConversation.mockResolvedValue("wrote the parser")

		await coordinator.handleTaskCompleted("task-1")

		expect(options.initTask).toHaveBeenCalledWith(
			"Continue from the previous task.\n\nSummary:\nwrote the parser\n\nNext step you asked for:\nAdd the tests",
			undefined,
		)
		// The row's mode choice is applied to the new chat, and the row is spent.
		expect(values.mode).toBe("plan")
		expect(values.scheduledTasks).toEqual([])
		expect(options.notify).toHaveBeenCalledWith("Started the scheduled chat.", "information")
	})

	it("uses only the queued message when the row turns the summary off", async () => {
		const { coordinator, options, values } = makeCoordinator({ autoStartNextTask: false })
		values.scheduledTasks = [row("row-1", { message: "Add the tests", includeSummary: false })]

		await coordinator.handleTaskCompleted("task-1")

		expect(summarizeConversation).not.toHaveBeenCalled()
		expect(options.initTask).toHaveBeenCalledWith("Add the tests", undefined)
	})

	it("runs the queue in order, one row per completion", async () => {
		const { coordinator, options, values, summary } = makeCoordinator({ autoStartNextTask: false })
		values.scheduledTasks = [
			row("row-1", { message: "First", includeSummary: false }),
			row("row-2", { message: "Second", includeSummary: false }),
			row("row-3", { message: "Third", includeSummary: false }),
		]

		// The chat a row starts completes in turn, which is what runs the next row:
		// the order the user arranged is the order the chats run in.
		for (const sessionId of ["task-1", "task-2", "task-3"]) {
			summary.setActiveSession(sessionId)
			await coordinator.handleTaskCompleted(sessionId)
			// A scheduled chat is user intent, so it never credits the safeguard.
			expect(coordinator.chainDepth).toBe(0)
		}

		const prompts = (options.initTask as unknown as { mock: { calls: string[][] } }).mock.calls.map((call) => call[0])
		expect(prompts).toEqual(["First", "Second", "Third"])
		expect(values.scheduledTasks).toEqual([])
	})

	it("starts the queued chat when a chat only finished answering", async () => {
		// The reported gap: ask a question in a new chat, the assistant answers
		// without ever using the completion tool, and the queued chat should run.
		// The automatic setting is off because the row itself is the intent.
		const { coordinator, options, values } = makeCoordinator({ autoStartNextTask: false })
		values.scheduledTasks = [row("row-1", { message: "Add the tests", includeSummary: false })]

		await coordinator.handleTaskAwaitingFollowup("task-1", 7)

		expect(options.initTask).toHaveBeenCalledWith("Add the tests", undefined)
		expect(values.scheduledTasks).toEqual([])
		expect(options.notify).toHaveBeenCalledWith("Started the scheduled chat.", "information")
	})

	it("does not chain automatically when a chat only finished answering", async () => {
		// `autoStartNextTask` still means "after a real completion": a turn that
		// merely stopped talking must not start a summary chat on its own.
		const { coordinator, options } = makeCoordinator({ autoStartNextTask: true })
		summarizeConversation.mockResolvedValue("summary")

		await coordinator.handleTaskAwaitingFollowup("task-1", 7)

		expect(summarizeConversation).not.toHaveBeenCalled()
		expect(options.initTask).not.toHaveBeenCalled()
		expect(options.clearTask).not.toHaveBeenCalled()
		expect(options.notify).not.toHaveBeenCalled()
	})

	it("runs the next row on a later turn of the same chat, never twice for one turn", async () => {
		// The `done` agent event and the session `ended` event both end the same
		// turn, so one turn is claimed once — while a chat the user keeps talking
		// in legitimately finishes several turns and reaches the next row each time.
		const { coordinator, options, values } = makeCoordinator({ autoStartNextTask: false })
		values.scheduledTasks = [
			row("row-1", { message: "First", includeSummary: false }),
			row("row-2", { message: "Second", includeSummary: false }),
		]

		await Promise.all([
			coordinator.handleTaskAwaitingFollowup("task-1", 4),
			coordinator.handleTaskAwaitingFollowup("task-1", 4),
		])
		expect(options.initTask).toHaveBeenCalledTimes(1)

		await coordinator.handleTaskCompleted("task-1", 9)

		const prompts = (options.initTask as unknown as { mock: { calls: string[][] } }).mock.calls.map((call) => call[0])
		expect(prompts).toEqual(["First", "Second"])
		expect(values.scheduledTasks).toEqual([])
	})

	it("keeps a paused queue from running when a chat only finished answering", async () => {
		const { coordinator, options, values } = makeCoordinator({
			autoStartNextTask: false,
			scheduledTasksPaused: true,
		})
		values.scheduledTasks = [row("row-1", { message: "Add the tests", includeSummary: false })]

		await coordinator.handleTaskAwaitingFollowup("task-1", 3)

		expect(options.initTask).not.toHaveBeenCalled()
		expect(values.scheduledTasks).toHaveLength(1)
	})

	it("keeps the queue untouched while it is paused", async () => {
		const { coordinator, options, values, summary } = makeCoordinator({
			autoStartNextTask: false,
			scheduledTasksPaused: true,
		})
		values.scheduledTasks = [row("row-1", { message: "Add the tests", includeSummary: false })]

		await coordinator.handleTaskCompleted("task-1")

		expect(options.initTask).not.toHaveBeenCalled()
		expect(options.notify).not.toHaveBeenCalled()
		// Pausing suspends the queue; it never throws the configured rows away.
		expect(values.scheduledTasks).toHaveLength(1)

		coordinator.setScheduledTasksPaused(false)
		summary.setActiveSession("task-2")
		await coordinator.handleTaskCompleted("task-2")

		expect(options.initTask).toHaveBeenCalledWith("Add the tests", undefined)
		expect(values.scheduledTasks).toEqual([])
	})

	it("never fabricates a half-populated task for an empty row", async () => {
		const { coordinator, options, values } = makeCoordinator({ autoStartNextTask: false })
		values.scheduledTasks = [row("row-1", { message: "  ", includeSummary: false })]

		await coordinator.handleTaskCompleted("task-1")

		expect(options.initTask).not.toHaveBeenCalled()
		expect(options.clearTask).toHaveBeenCalledOnce()
		expect(values.scheduledTasks).toEqual([])
	})

	it("lets a queued chat past the automatic ceiling and restarts the count", async () => {
		const { coordinator, options, values } = makeCoordinator({
			autoStartNextTask: false,
			autoNextTaskChainDepth: MAX_AUTO_NEXT_TASK_CHAIN_DEPTH,
		})
		values.scheduledTasks = [row("row-1", { message: "Add the tests", includeSummary: false })]

		await coordinator.handleTaskCompleted("task-1")

		expect(options.initTask).toHaveBeenCalledWith("Add the tests", undefined)
		expect(options.notify).not.toHaveBeenCalledWith(expect.stringContaining("Automatic next chats stopped"), "warning")
		expect(values.autoNextTaskChainDepth).toBe(0)
	})

	it("pins the provider and model the row configured for that chat only", async () => {
		const { coordinator, options, values } = makeCoordinator({ autoStartNextTask: false })
		values.scheduledTasks = [
			row("row-1", {
				message: "Add the tests",
				includeSummary: false,
				providerId: "openrouter",
				modelId: "anthropic/claude-sonnet-4-5",
			}),
		]

		await coordinator.handleTaskCompleted("task-1")

		expect(options.initTask).toHaveBeenCalledWith("Add the tests", {
			providerId: "openrouter",
			modelId: "anthropic/claude-sonnet-4-5",
		})
	})

	it("leaves a row queued when its summary could not be written", async () => {
		const { coordinator, options, summary, values } = makeCoordinator({ autoStartNextTask: false })
		values.scheduledTasks = [row("row-1", { message: "Add the tests" })]
		summarizeConversation.mockRejectedValue(new Error("provider rejected the summarizer request"))

		await coordinator.handleTaskCompleted("task-1")

		expect(options.initTask).not.toHaveBeenCalled()
		// The completion was wasted, but the user's configuration was not.
		expect(values.scheduledTasks).toHaveLength(1)

		summarizeConversation.mockResolvedValue("wrote the parser")
		summary.setActiveSession("task-2")
		await coordinator.handleTaskCompleted("task-2")
		expect(options.initTask).toHaveBeenCalledWith(
			"Continue from the previous task.\n\nSummary:\nwrote the parser\n\nNext step you asked for:\nAdd the tests",
			undefined,
		)
		expect(values.scheduledTasks).toEqual([])
	})

	it("starts a queued chat immediately when the view asked for it", async () => {
		const { coordinator, options, values } = makeCoordinator({ autoStartNextTask: false })
		values.scheduledTasks = [row("row-1", { message: "Add the tests", mode: "plan", providerId: "anthropic" })]
		summarizeConversation.mockResolvedValue("wrote the parser")

		const taskId = await coordinator.startScheduledTaskNow(values.scheduledTasks[0])

		expect(taskId).toBe("task-2")
		expect(options.initTask).toHaveBeenCalledWith(
			"Continue from the previous task.\n\nSummary:\nwrote the parser\n\nNext step you asked for:\nAdd the tests",
			{ providerId: "anthropic" },
		)
		expect(values.mode).toBe("plan")
		// The controller must see this as a scheduled start, not a manual one.
		expect(coordinator.consumeChainHandoff()).toBe(true)
		expect(coordinator.getScheduledTasks()).toEqual([])
	})

	it("does not summarize a running task for a run-now handoff", async () => {
		const { coordinator, options, summary, values } = makeCoordinator({ autoStartNextTask: false })
		values.scheduledTasks = [row("row-1", { message: "Add the tests" })]
		summary.setActiveSession("task-1", { isRunning: true })

		await coordinator.startScheduledTaskNow(values.scheduledTasks[0])

		expect(summarizeConversation).not.toHaveBeenCalled()
		expect(options.initTask).toHaveBeenCalledWith("Add the tests", undefined)
	})

	it("round-trips the queue and ignores rows it cannot trust", () => {
		const { coordinator, values } = makeCoordinator()

		coordinator.setScheduledTasks([row("row-1", { message: "Add the tests", mode: "plan", includeSummary: false })])
		expect(coordinator.getScheduledTasks()).toEqual([
			{ id: "row-1", message: "Add the tests", mode: "plan", includeSummary: false, createdAt: 1_700_000_000_000 },
		])

		coordinator.setScheduledTasks([])
		expect(coordinator.getScheduledTasks()).toEqual([])

		;(values as unknown as Record<string, unknown>).scheduledTasks = [{ message: 42 }, row("row-2")]
		expect(coordinator.getScheduledTasks().map((task) => task.id)).toEqual(["row-2"])
	})

	it("keeps the pause flag across an extension restart", () => {
		const { coordinator, options, values } = makeCoordinator()

		coordinator.setScheduledTasksPaused(true)
		expect(coordinator.getScheduledTasksPaused()).toBe(true)

		// A fresh coordinator over the same persisted state is a window reload:
		// the queue stays paused instead of quietly resuming.
		const restarted = new SdkAutoNextTaskCoordinator(options)
		expect(restarted.getScheduledTasksPaused()).toBe(true)
		expect(values.scheduledTasksPaused).toBe(true)
	})
})
