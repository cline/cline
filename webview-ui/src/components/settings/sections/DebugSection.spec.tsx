import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import DebugSection from "./DebugSection"

const grpcClientMocks = vi.hoisted(() => ({
	pingLatencyProbe: vi.fn(),
	setWelcomeViewCompleted: vi.fn(),
}))

type MockLatencyObserverState = {
	session: { startedAt: number; branch: string; commit: string; environment: string }
	capabilities: {
		transportProbe: string
		taskInitialization: string
		requestStart: string
		firstVisibleUpdate: string
		fullStateMetrics: string
		partialMessageMetrics: string
		taskUiDeltaMetrics: string
		persistenceMetrics: string
	}
	transport: {
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
	taskInitialization: MockLatencyObserverState["transport"]
	requestStart: MockLatencyObserverState["transport"]
	firstVisibleUpdate: MockLatencyObserverState["transport"]
	logs: unknown[]
	optionalCounters?: {
		fullStatePushes: number
		fullStateBytes: number
		partialMessageEvents: number
		partialMessageBytes: number
		taskUiDeltaEvents: number
		persistenceFlushes: number
	}
}

const extensionStateMock = vi.hoisted(() => ({
	latencyObserver: {
		session: { startedAt: 1, branch: "main", commit: "abcdef123456", environment: "production" },
		capabilities: {
			transportProbe: "supported",
			taskInitialization: "supported",
			requestStart: "supported",
			firstVisibleUpdate: "supported",
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
		logs: [],
		optionalCounters: {
			fullStatePushes: 3,
			fullStateBytes: 1024,
			partialMessageEvents: 4,
			partialMessageBytes: 256,
			taskUiDeltaEvents: 7,
			persistenceFlushes: 2,
		},
	} as MockLatencyObserverState,
	setShowWelcome: vi.fn(),
}))

vi.mock("@/services/grpc-client", () => ({
	UiServiceClient: {
		pingLatencyProbe: grpcClientMocks.pingLatencyProbe,
	},
	StateServiceClient: {
		setWelcomeViewCompleted: grpcClientMocks.setWelcomeViewCompleted,
	},
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => extensionStateMock,
}))

describe("DebugSection", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		extensionStateMock.latencyObserver = {
			session: { startedAt: 1, branch: "main", commit: "abcdef123456", environment: "production" },
			capabilities: {
				transportProbe: "supported",
				taskInitialization: "supported",
				requestStart: "supported",
				firstVisibleUpdate: "supported",
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
			logs: [],
			optionalCounters: {
				fullStatePushes: 3,
				fullStateBytes: 1024,
				partialMessageEvents: 4,
				partialMessageBytes: 256,
				taskUiDeltaEvents: 7,
				persistenceFlushes: 2,
			},
		}
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
		vi.stubGlobal("URL", {
			createObjectURL,
			revokeObjectURL,
		})

		render(<DebugSection onResetState={vi.fn()} renderSectionHeader={() => null} />)
		expect(screen.getByText("Pure ping test")).toBeTruthy()
		expect(screen.getByText(/Use ping presets and continuous ping to compare transport RTT and jitter only/)).toBeTruthy()
		expect(screen.getByText("How to interpret these numbers")).toBeTruthy()
		expect(screen.getByText(/Ping RTT is a lower-level transport signal/)).toBeTruthy()

		fireEvent.change(screen.getByLabelText("Ping payload bytes"), { target: { value: "64" } })
		fireEvent.click(screen.getByText("Run Ping Probe"))

		await waitFor(() => expect(grpcClientMocks.pingLatencyProbe).toHaveBeenCalledTimes(1))
		expect(screen.getByText(/Samples: 1/)).toBeTruthy()
		expect(screen.getByText(/Payload: 64 bytes/)).toBeTruthy()
		expect(screen.getByText(/Scenario: Pure ping test/)).toBeTruthy()
		expect(screen.getByText(/Branch: main/)).toBeTruthy()
		expect(screen.getByText(/State pushes: 3/)).toBeTruthy()
		expect(screen.getByText(/State bytes: 1024/)).toBeTruthy()
		expect(screen.getByText(/Partial bytes: 256/)).toBeTruthy()
		expect(screen.getByText(/Transport probe: Supported/)).toBeTruthy()
		expect(screen.getByText(/Task UI delta metrics: Unsupported on this branch/)).toBeTruthy()
		expect(screen.getByText(/Task UI deltas: 7/)).toBeTruthy()

		fireEvent.click(screen.getByText("Export Session JSON"))
		expect(createObjectURL).toHaveBeenCalledTimes(1)
		expect(click).toHaveBeenCalledTimes(1)
		expect(revokeObjectURL).toHaveBeenCalledTimes(1)

		createElementSpy.mockRestore()
	})

	it("exports a stable session even when optional metrics are unavailable", async () => {
		extensionStateMock.latencyObserver = {
			...extensionStateMock.latencyObserver,
			capabilities: {
				...extensionStateMock.latencyObserver.capabilities,
				fullStateMetrics: "unsupported",
				partialMessageMetrics: "unsupported",
				taskUiDeltaMetrics: "hook-not-installed",
			},
			optionalCounters: undefined,
		}

		grpcClientMocks.pingLatencyProbe.mockResolvedValue({ value: 0 })
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
		vi.stubGlobal("URL", {
			createObjectURL,
			revokeObjectURL,
		})

		render(<DebugSection onResetState={vi.fn()} renderSectionHeader={() => null} />)
		fireEvent.click(screen.getByText("Export Session JSON"))

		expect(createObjectURL).toHaveBeenCalledTimes(1)
		const firstCreateObjectUrlCall = createObjectURL.mock.calls[0]
		if (!firstCreateObjectUrlCall) {
			throw new Error("Expected export blob to be created")
		}
		const exportedBlob = firstCreateObjectUrlCall[0]
		const exportedJson = JSON.parse(await exportedBlob.text())
		expect(exportedJson.observationScenario.id).toBe("ping-only")
		expect(exportedJson.capabilities.fullStateMetrics).toBe("unsupported")
		expect(exportedJson.capabilities.taskUiDeltaMetrics).toBe("hook-not-installed")
		expect(exportedJson.optionalCounters).toBeUndefined()

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
		const pingButton = screen.getByText("Pinging...")
		expect(pingButton).toBeTruthy()
		expect(pingButton.closest("button")?.hasAttribute("disabled")).toBe(true)

		fireEvent.click(pingButton)
		expect(grpcClientMocks.pingLatencyProbe).toHaveBeenCalledTimes(1)

		resolvePing?.()
		await waitFor(() => expect(screen.getByText("Run Ping Probe")).toBeTruthy())

		grpcClientMocks.pingLatencyProbe.mockResolvedValue({ value: 0 })
		fireEvent.click(screen.getByText("Test Payload Presets"))
		await waitFor(() => expect(grpcClientMocks.pingLatencyProbe).toHaveBeenCalledTimes(5))
		expect(grpcClientMocks.pingLatencyProbe).toHaveBeenNthCalledWith(2, { value: new Uint8Array(0) })
		expect(grpcClientMocks.pingLatencyProbe).toHaveBeenNthCalledWith(3, { value: new Uint8Array(64) })
		expect(grpcClientMocks.pingLatencyProbe).toHaveBeenNthCalledWith(4, { value: new Uint8Array(1024) })
		expect(grpcClientMocks.pingLatencyProbe).toHaveBeenNthCalledWith(5, { value: new Uint8Array(16_384) })
	})
})
