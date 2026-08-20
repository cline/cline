import type { ActiveMonitor } from "@shared/ExtensionMessage"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ActiveMonitors, linesLabel, monitorSummary, selectRunningMonitors } from "./ActiveMonitors"

const stopMonitorMock = vi.hoisted(() => vi.fn())

vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: {
		stopMonitor: (request: unknown) => stopMonitorMock(request),
	},
}))

vi.mock("@shared/proto/cline/task", () => ({
	StopMonitorRequest: {
		create: (request: unknown) => request,
	},
}))

function makeMonitor(overrides: Partial<ActiveMonitor> = {}): ActiveMonitor {
	return {
		id: "mon_1",
		name: "applog",
		description: "watching the app log",
		command: "tail -F app.log",
		startedAt: 0,
		status: "running",
		linesEmitted: 3,
		...overrides,
	}
}

describe("ActiveMonitors", () => {
	beforeEach(() => {
		stopMonitorMock.mockReset()
		stopMonitorMock.mockResolvedValue({})
	})

	it("renders nothing when no monitors are running", () => {
		const { container } = render(<ActiveMonitors items={[makeMonitor({ status: "stopped" })]} sessionId="sess-1" />)
		expect(container.firstChild).toBeNull()
	})

	it("renders nothing without an owning session id", () => {
		// Without the owning session a stop request could not be qualified, so
		// the strip does not offer controls at all.
		const { container } = render(<ActiveMonitors items={[makeMonitor()]} />)
		expect(container.firstChild).toBeNull()
	})

	it("lists running monitors with name, description, and line count", () => {
		render(<ActiveMonitors items={[makeMonitor()]} sessionId="sess-1" />)
		expect(screen.getByText("Watching in the background")).toBeInTheDocument()
		expect(screen.getByText("applog")).toBeInTheDocument()
		expect(screen.getByText("watching the app log")).toBeInTheDocument()
		expect(screen.getByText("3 lines")).toBeInTheDocument()
	})

	it("stops a monitor through the task service with its owning session", async () => {
		render(<ActiveMonitors items={[makeMonitor()]} sessionId="sess-1" />)
		fireEvent.click(screen.getByRole("button", { name: "Stop monitor" }))
		await waitFor(() => {
			expect(stopMonitorMock).toHaveBeenCalledWith({ monitorId: "mon_1", sessionId: "sess-1" })
		})
	})

	it("hides ended monitors while keeping running ones", () => {
		render(
			<ActiveMonitors
				items={[makeMonitor(), makeMonitor({ id: "mon_2", name: "oldwatch", status: "exited" })]}
				sessionId="sess-1"
			/>,
		)
		expect(screen.getByText("applog")).toBeInTheDocument()
		expect(screen.queryByText("oldwatch")).not.toBeInTheDocument()
	})
})

describe("selectRunningMonitors", () => {
	it("filters to running entries and tolerates undefined", () => {
		expect(selectRunningMonitors(undefined)).toEqual([])
		expect(selectRunningMonitors([makeMonitor(), makeMonitor({ id: "mon_2", status: "failed" })]).map((m) => m.id)).toEqual([
			"mon_1",
		])
	})
})

describe("monitorSummary", () => {
	it("pluralizes", () => {
		expect(monitorSummary([makeMonitor()])).toBe("Watching in the background")
		expect(monitorSummary([makeMonitor(), makeMonitor({ id: "mon_2" })])).toBe("2 background monitors")
	})
})

describe("linesLabel", () => {
	it("pluralizes line counts", () => {
		expect(linesLabel(1)).toBe("1 line")
		expect(linesLabel(0)).toBe("0 lines")
	})
})
