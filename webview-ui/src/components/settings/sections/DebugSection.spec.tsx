import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import DebugSection from "./DebugSection"

const grpcClientMocks = vi.hoisted(() => ({
	pingLatencyProbe: vi.fn(),
	resetLatencyObserver: vi.fn(),
	newTask: vi.fn(),
	setWelcomeViewCompleted: vi.fn(),
}))

type TransportMetric = {
	support: string
	samples: unknown[]
	stats: {
		count: number
		minMs: number | null
		maxMs: number | null
		avgMs: number | null
		lastMs: number | null
		totalMs: number
	}
}

type MockLatencyObserverState = {
	session: { startedAt: number; branch: string; commit: string; environment: string }
	capabilities: {
		transportProbe: string
		taskInitialization: string
		requestStart: string
		firstVisibleUpdate: string
		firstFullStateUpdate: string
		firstPartialMessageUpdate: string
		chunkToWebviewTiming: string
		fullStateMetrics: string
		partialMessageMetrics: string
		taskUiDeltaMetrics: string
		persistenceMetrics: string
	}
	transport: TransportMetric
	taskInitialization: TransportMetric
	requestStart: TransportMetric
	firstVisibleUpdate: TransportMetric
	firstFullStateUpdate: TransportMetric
	firstPartialMessageUpdate: TransportMetric
	chunkToWebview: TransportMetric
	logs: unknown[]
	requestCounterSummaries: Array<{
		requestId: string
		taskId?: string
		startedAt: number
		completedAt: number
		fullStatePushes: number
		fullStateBytes: number
		partialMessageEvents: number
		partialMessageBytes: number
		taskUiDeltaEvents: number
		persistenceFlushes: number
	}>
	optionalCounters?: {
		fullStatePushes: number
		fullStateBytes: number
		partialMessageEvents: number
		partialMessageBytes: number
		taskUiDeltaEvents: number
		persistenceFlushes: number
	}
}

const makeLatencyObserverState = (): MockLatencyObserverState => ({
	session: { startedAt: 1, branch: "main", commit: "abcdef123456", environment: "production" },
	capabilities: {
		transportProbe: "supported",
		taskInitialization: "supported",
		requestStart: "supported",
		firstVisibleUpdate: "supported",
		firstFullStateUpdate: "supported",
		firstPartialMessageUpdate: "supported",
		chunkToWebviewTiming: "supported",
		fullStateMetrics: "supported",
		partialMessageMetrics: "supported",
		taskUiDeltaMetrics: "unsupported",
		persistenceMetrics: "supported",
	},
	transport: {
		support: "supported",
		samples: [],
		stats: { count: 0, minMs: null, maxMs: null, avgMs: null, lastMs: null, totalMs: 0 },
	},
	taskInitialization: {
		support: "supported",
		samples: [],
		stats: { count: 1, minMs: 10, maxMs: 10, avgMs: 10, lastMs: 10, totalMs: 10 },
	},
	requestStart: {
		support: "supported",
		samples: [],
		stats: { count: 1, minMs: 0, maxMs: 0, avgMs: 0, lastMs: 0, totalMs: 0 },
	},
	firstVisibleUpdate: {
		support: "supported",
		samples: [],
		stats: { count: 1, minMs: 12, maxMs: 12, avgMs: 12, lastMs: 12, totalMs: 12 },
	},
	firstFullStateUpdate: {
		support: "supported",
		samples: [],
		stats: { count: 1, minMs: 14, maxMs: 14, avgMs: 14, lastMs: 14, totalMs: 14 },
	},
	firstPartialMessageUpdate: {
		support: "supported",
		samples: [],
		stats: { count: 1, minMs: 16, maxMs: 16, avgMs: 16, lastMs: 16, totalMs: 16 },
	},
	chunkToWebview: {
		support: "supported",
		samples: [],
		stats: { count: 1, minMs: 9, maxMs: 9, avgMs: 9, lastMs: 9, totalMs: 9 },
	},
	logs: [],
	requestCounterSummaries: [
		{
			requestId: "task-1:req-1",
			taskId: "task-1",
			startedAt: 10,
			completedAt: 24,
			fullStatePushes: 2,
			fullStateBytes: 512,
			partialMessageEvents: 3,
			partialMessageBytes: 256,
			taskUiDeltaEvents: 4,
			persistenceFlushes: 1,
		},
	],
	optionalCounters: {
		fullStatePushes: 3,
		fullStateBytes: 1024,
		partialMessageEvents: 4,
		partialMessageBytes: 256,
		taskUiDeltaEvents: 7,
		persistenceFlushes: 2,
	},
})

const extensionStateMock = vi.hoisted(() => ({
	latencyObserver: null as unknown as MockLatencyObserverState,
	setShowWelcome: vi.fn(),
}))

vi.mock("@/services/grpc-client", () => ({
	UiServiceClient: {
		pingLatencyProbe: grpcClientMocks.pingLatencyProbe,
		resetLatencyObserver: grpcClientMocks.resetLatencyObserver,
	},
	TaskServiceClient: {
		newTask: grpcClientMocks.newTask,
	},
	StateServiceClient: {
		setWelcomeViewCompleted: grpcClientMocks.setWelcomeViewCompleted,
	},
}))

vi.mock("@/components/ui/select", () => {
	const React = require("react") as typeof import("react")
	const SelectContext = React.createContext<{ onValueChange?: (value: string) => void } | null>(null)

	return {
		Select: ({ children, onValueChange }: { children: React.ReactNode; onValueChange?: (value: string) => void }) => (
			<SelectContext.Provider value={{ onValueChange }}>{children}</SelectContext.Provider>
		),
		SelectTrigger: ({ children, className }: { children: React.ReactNode; className?: string }) => (
			<div className={className} role="combobox">
				{children}
			</div>
		),
		SelectValue: () => null,
		SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
		SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => {
			const context = React.useContext(SelectContext)
			return (
				<button onClick={() => context?.onValueChange?.(value)} role="option" type="button">
					{children}
				</button>
			)
		},
	}
})

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => extensionStateMock,
}))

describe("DebugSection", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		extensionStateMock.latencyObserver = makeLatencyObserverState()
	})

	it("runs the latency probe and renders rolling stats", async () => {
		grpcClientMocks.pingLatencyProbe.mockResolvedValue({ value: 64 })
		const createObjectURL = vi.fn((_: Blob) => "blob:test")
		const revokeObjectURL = vi.fn()
		const click = vi.fn()
		const originalCreateElement = document.createElement.bind(document)
		const createElementSpy = vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
			if (tagName === "a") {
				return { click, href: "", download: "" } as unknown as HTMLAnchorElement
			}
			return originalCreateElement(tagName)
		}) as typeof document.createElement)
		vi.stubGlobal("URL", { createObjectURL, revokeObjectURL })

		render(<DebugSection onResetState={vi.fn()} renderSectionHeader={() => null} />)
		fireEvent.change(screen.getByLabelText("Ping payload bytes"), { target: { value: "64" } })
		fireEvent.click(screen.getByText("Run Ping Probe"))

		await waitFor(() => expect(grpcClientMocks.pingLatencyProbe).toHaveBeenCalledTimes(1))
		expect(screen.getByText(/Samples: 1/)).toBeTruthy()
		expect(screen.getByText(/Payload: 64 bytes/)).toBeTruthy()
		expect(screen.getByText(/First full-state avg: 14.00 ms/)).toBeTruthy()
		expect(screen.getByText(/First partial avg: 16.00 ms/)).toBeTruthy()
		expect(screen.getByText(/Chunk→webview avg: 9.00 ms/)).toBeTruthy()
		expect(screen.getByText(/Chunk→webview timing: Supported/)).toBeTruthy()
		expect(screen.getByText(/Req partial bytes: 256/)).toBeTruthy()

		fireEvent.click(screen.getByText("Export Session JSON"))
		expect(createObjectURL).toHaveBeenCalledTimes(1)
		expect(click).toHaveBeenCalledTimes(1)
		expect(revokeObjectURL).toHaveBeenCalledTimes(1)
		createElementSpy.mockRestore()
	})

	it("exports a stable session even when optional metrics are unavailable", () => {
		extensionStateMock.latencyObserver = {
			...makeLatencyObserverState(),
			capabilities: {
				...makeLatencyObserverState().capabilities,
				fullStateMetrics: "unsupported",
				partialMessageMetrics: "unsupported",
				taskUiDeltaMetrics: "hook-not-installed",
			},
			optionalCounters: undefined,
		}

		const createObjectURL = vi.fn((_: Blob) => "blob:test")
		const revokeObjectURL = vi.fn()
		const click = vi.fn()
		const originalCreateElement = document.createElement.bind(document)
		const createElementSpy = vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
			if (tagName === "a") {
				return { click, href: "", download: "" } as unknown as HTMLAnchorElement
			}
			return originalCreateElement(tagName)
		}) as typeof document.createElement)
		vi.stubGlobal("URL", { createObjectURL, revokeObjectURL })

		render(<DebugSection onResetState={vi.fn()} renderSectionHeader={() => null} />)
		fireEvent.click(screen.getByText("Export Session JSON"))

		expect(screen.getByText(/Full-state metrics: Unsupported on this branch/)).toBeTruthy()
		expect(screen.getByText(/Task UI delta metrics: Observer hook not installed/)).toBeTruthy()
		expect(createObjectURL).toHaveBeenCalledTimes(1)
		expect(click).toHaveBeenCalledTimes(1)
		expect(revokeObjectURL).toHaveBeenCalledTimes(1)
		createElementSpy.mockRestore()
	})

	it("exports a stable latency observer schema with scenario and transport stats", () => {
		const OriginalBlob = globalThis.Blob
		class FakeBlob {
			public readonly parts: unknown[]
			public readonly type: string
			constructor(parts: unknown[], options?: { type?: string }) {
				this.parts = parts
				this.type = options?.type ?? ""
			}
		}
		vi.stubGlobal("Blob", FakeBlob as unknown as typeof Blob)
		const createObjectURL = vi.fn((_: Blob) => "blob:test")
		const revokeObjectURL = vi.fn()
		const click = vi.fn()
		const originalCreateElement = document.createElement.bind(document)
		const createElementSpy = vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
			if (tagName === "a") {
				return { click, href: "", download: "" } as unknown as HTMLAnchorElement
			}
			return originalCreateElement(tagName)
		}) as typeof document.createElement)
		vi.stubGlobal("URL", { createObjectURL, revokeObjectURL })

		render(<DebugSection onResetState={vi.fn()} renderSectionHeader={() => null} />)
		fireEvent.click(screen.getByText("Export Session JSON"))

		const exportedBlob = createObjectURL.mock.calls[0][0] as unknown as FakeBlob
		const exportedJson = JSON.parse(String(exportedBlob.parts[0]))
		expect(exportedJson).toMatchObject({
			session: { branch: "main", commit: "abcdef123456", environment: "production" },
			observationScenario: { id: "ping-only", label: "Pure ping test" },
			transport: { support: "supported", stats: { count: 0, totalMs: 0 } },
		})
		vi.stubGlobal("Blob", OriginalBlob)
		createElementSpy.mockRestore()
	})

	it("runs payload presets and prevents overlapping manual pings while active", async () => {
		let resolvePing: (() => void) | undefined
		grpcClientMocks.pingLatencyProbe.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolvePing = () => resolve({ value: 0 })
				}),
		)

		render(<DebugSection onResetState={vi.fn()} renderSectionHeader={() => null} />)
		fireEvent.click(screen.getByText("Run Ping Probe"))
		await waitFor(() => expect(grpcClientMocks.pingLatencyProbe).toHaveBeenCalledTimes(1))
		resolvePing?.()
		await waitFor(() => expect(screen.getByText("Run Ping Probe")).toBeTruthy())

		grpcClientMocks.pingLatencyProbe.mockResolvedValue({ value: 0 })
		fireEvent.click(screen.getByText("Test Payload Presets"))
		await waitFor(() => expect(grpcClientMocks.pingLatencyProbe).toHaveBeenCalledTimes(5))
	})

	it("starts an observed task scenario using the selected scenario template", async () => {
		grpcClientMocks.newTask.mockResolvedValue({ value: "task-1" })
		render(<DebugSection onResetState={vi.fn()} renderSectionHeader={() => null} />)
		fireEvent.click(screen.getByText("Start Observed Task Scenario"))
		await waitFor(() => expect(grpcClientMocks.newTask).toHaveBeenCalledTimes(1))
	})

	it("starts the selected large-file scenario with the plan document attached", async () => {
		grpcClientMocks.newTask.mockResolvedValue({ value: "task-2" })
		render(<DebugSection onResetState={vi.fn()} renderSectionHeader={() => null} />)

		fireEvent.mouseDown(screen.getByRole("combobox"))
		fireEvent.click(screen.getByRole("option", { name: "Large-file-write adjacent" }))
		fireEvent.click(screen.getByText("Start Observed Task Scenario"))

		await waitFor(() => expect(grpcClientMocks.newTask).toHaveBeenCalledTimes(1))
		expect(grpcClientMocks.newTask).toHaveBeenCalledWith({
			text: "Latency observer large-file scenario. Read the latency observer plan document and summarize the sections most relevant to payload size and export behavior.",
			images: [],
			files: ["docs/remote-workspace-local-latency-observer-plan.md"],
		})
	})

	it("resets the backend observer session", async () => {
		grpcClientMocks.resetLatencyObserver.mockResolvedValue({})
		render(<DebugSection onResetState={vi.fn()} renderSectionHeader={() => null} />)
		fireEvent.click(screen.getByText("Reset Observer Session"))
		await waitFor(() => expect(grpcClientMocks.resetLatencyObserver).toHaveBeenCalledTimes(1))
	})
})
