import { PlanActMode } from "@shared/proto/cline/state"
import { UpdateScheduledTasksRequest } from "@shared/proto/cline/task"
import type { ScheduledTask } from "@shared/scheduled-next-task"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import ScheduledTasksView from "./ScheduledTasksView"

const { updateScheduledTasks, runScheduledTaskNow, state } = vi.hoisted(() => ({
	updateScheduledTasks: vi.fn(async () => ({})),
	runScheduledTaskNow: vi.fn(async () => ({})),
	state: { current: {} as Record<string, unknown> },
}))

vi.mock("@/services/grpc-client", () => ({ TaskServiceClient: { updateScheduledTasks, runScheduledTaskNow } }))
vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: () => state.current }))
vi.mock("@/hooks/useProviderListings", () => ({
	useProviderListings: () => ({
		providers: [
			{ id: "anthropic", name: "Anthropic", allowsCustomModelIds: true },
			{ id: "openrouter", name: "OpenRouter", allowsCustomModelIds: true },
		],
		isLoading: false,
		error: undefined,
		refresh: vi.fn(),
	}),
}))
vi.mock("@/hooks/useProviderModels", () => ({
	useProviderModels: () => ({
		models: { "claude-sonnet-4-5": { name: "Claude Sonnet 4.5" } },
		defaultModelId: "claude-sonnet-4-5",
		isLoading: false,
		isStale: false,
		error: undefined,
		refresh: vi.fn(),
		fingerprint: "",
	}),
}))

// The tests drive the real Radix select. jsdom lacks the pointer-capture and
// scroll APIs Radix calls while opening the list.
beforeAll(() => {
	Element.prototype.hasPointerCapture ??= () => false
	Element.prototype.releasePointerCapture ??= () => {}
	Element.prototype.scrollIntoView ??= () => {}
})

function row(id: string, overrides: Partial<ScheduledTask> = {}): ScheduledTask {
	return { id, message: `Task ${id}`, mode: "act", includeSummary: true, createdAt: 1_700_000_000_000, ...overrides }
}

function renderView() {
	return render(<ScheduledTasksView onDone={vi.fn()} />)
}

/** The queue the last save wrote, in the order it was sent. */
function savedTasks() {
	const calls = updateScheduledTasks.mock.calls
	const [request] = calls[calls.length - 1] ?? []
	return request?.tasks ?? []
}

describe("ScheduledTasksView", () => {
	beforeEach(() => {
		updateScheduledTasks.mockClear()
		runScheduledTaskNow.mockClear()
		// The extension posts the saved queue straight back, exactly like a real
		// round-trip: the view is a projection of extension state, never its own copy.
		updateScheduledTasks.mockImplementation(async (request: UpdateScheduledTasksRequest) => {
			state.current = {
				...state.current,
				scheduledTasks: (request.tasks ?? []).map(
					(task): ScheduledTask => ({
						id: task.id,
						message: task.message ?? "",
						mode: task.mode === PlanActMode.PLAN ? "plan" : "act",
						includeSummary: task.includeSummary ?? true,
						providerId: task.providerId || undefined,
						modelId: task.modelId || undefined,
						createdAt: task.createdAt ?? 1_700_000_000_000,
					}),
				),
				...(request.paused === undefined ? {} : { scheduledTasksPaused: request.paused }),
			}
			return {}
		})
		state.current = {
			environment: "production",
			mode: "act",
			includePreviousTaskSummary: true,
			scheduledTasks: [row("row-1", { message: "Write the tests" }), row("row-2", { message: "Write the changelog" })],
			scheduledTasksPaused: false,
			navigateToChat: vi.fn(),
		}
	})

	it("shows the queue in the order it will run in", () => {
		renderView()

		expect(within(screen.getByTestId("scheduled-task-row-row-1")).getByText("1")).toBeTruthy()
		expect(within(screen.getByTestId("scheduled-task-row-row-2")).getByText("2")).toBeTruthy()
		expect(within(screen.getByTestId("scheduled-task-row-row-2")).getByText("Runs after 1 scheduled chat")).toBeTruthy()
		expect(screen.getByTestId("scheduled-tasks-summary").textContent).toContain("2 scheduled chats")
	})

	it("appends a new configuration below the ones already queued", async () => {
		const user = userEvent.setup()
		renderView()

		await user.click(screen.getByTestId("scheduled-task-add"))

		const saved = savedTasks()
		expect(saved.map((task) => task.message)).toEqual(["Write the tests", "Write the changelog", ""])
		// A new row never takes over the slot that runs next.
		expect(saved[2]?.id).toMatch(/^scheduled-/)
		expect(saved[2]?.mode).toBe(PlanActMode.ACT)
		expect(saved[2]?.includeSummary).toBe(true)
	})

	it("pauses the whole queue without discarding it", async () => {
		const user = userEvent.setup()
		renderView()

		await user.click(screen.getByTestId("scheduled-tasks-pause"))

		expect(updateScheduledTasks).toHaveBeenCalledTimes(1)
		const [request] = updateScheduledTasks.mock.calls[0]
		expect(request.paused).toBe(true)
		expect(request.tasks.map((task) => task.id)).toEqual(["row-1", "row-2"])
	})

	it("starts a scheduled chat immediately and leaves the queue view", async () => {
		const user = userEvent.setup()
		const navigateToChat = vi.fn()
		state.current = { ...state.current, navigateToChat }
		renderView()

		await user.click(
			within(screen.getByTestId("scheduled-task-row-row-1")).getByRole("button", { name: "Run this scheduled task now" }),
		)

		expect(runScheduledTaskNow).toHaveBeenCalledWith(expect.objectContaining({ scheduledTaskId: "row-1" }))
		expect(navigateToChat).toHaveBeenCalledTimes(1)
	})

	it("moves a row up to change what runs next", async () => {
		const user = userEvent.setup()
		renderView()

		await user.click(
			within(screen.getByTestId("scheduled-task-row-row-2")).getByRole("button", {
				name: "Move this scheduled task earlier",
			}),
		)

		expect(savedTasks().map((task) => task.id)).toEqual(["row-2", "row-1"])
	})

	it("disables the move button at the ends of the queue", () => {
		renderView()

		expect(
			within(screen.getByTestId("scheduled-task-row-row-1")).getByRole("button", {
				name: "Move this scheduled task earlier",
			}),
		).toBeDisabled()
		expect(
			within(screen.getByTestId("scheduled-task-row-row-2")).getByRole("button", {
				name: "Move this scheduled task later",
			}),
		).toBeDisabled()
	})

	it("deletes a queued chat", async () => {
		const user = userEvent.setup()
		renderView()

		await user.click(
			within(screen.getByTestId("scheduled-task-row-row-1")).getByRole("button", { name: "Delete this scheduled task" }),
		)

		expect(savedTasks().map((task) => task.id)).toEqual(["row-2"])
	})

	it("pins the provider and model id of a single row", async () => {
		const user = userEvent.setup()
		renderView()

		const firstRow = screen.getByTestId("scheduled-task-row-row-1")
		await user.click(within(firstRow).getByRole("combobox"))
		await user.click(await screen.findByRole("option", { name: "OpenRouter" }))

		expect(savedTasks()[0]).toMatchObject({ id: "row-1", providerId: "openrouter" })

		const modelInput = within(firstRow).getByTestId("scheduled-task-model-id")
		await user.clear(modelInput)
		await user.type(modelInput, "openrouter/llama-4")
		await user.tab()

		expect(savedTasks()[0]).toMatchObject({ id: "row-1", providerId: "openrouter", modelId: "openrouter/llama-4" })
		// Every other row keeps its own (unpinned) configuration.
		expect(savedTasks()[1]).toMatchObject({ id: "row-2", providerId: "", modelId: "" })
	})

	it("says a row inherits the current model until a provider is pinned", () => {
		renderView()

		expect(within(screen.getByTestId("scheduled-task-row-row-1")).getByTestId("scheduled-task-model-inherited")).toBeTruthy()
	})

	it("commits the message a row typed when the field loses focus", async () => {
		const user = userEvent.setup()
		renderView()

		const message = within(screen.getByTestId("scheduled-task-row-row-1")).getByTestId("scheduled-task-message")
		await user.clear(message)
		await user.type(message, "Refactor the parser")
		await user.tab()

		expect(savedTasks()[0]).toMatchObject({ id: "row-1", message: "Refactor the parser" })
	})
})
