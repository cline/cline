import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import DebugSection from "./DebugSection"

const grpcClientMocks = vi.hoisted(() => ({
	pingLatencyProbe: vi.fn(),
	setWelcomeViewCompleted: vi.fn(),
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
	useExtensionState: () => ({
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
			optionalCounters: { fullStatePushes: 3, partialMessageEvents: 4, persistenceFlushes: 2 },
		},
		setShowWelcome: vi.fn(),
	}),
}))

describe("DebugSection", () => {
	it("runs the latency probe and renders rolling stats", async () => {
		grpcClientMocks.pingLatencyProbe.mockResolvedValue({ value: 64 })

		render(<DebugSection onResetState={vi.fn()} renderSectionHeader={() => null} />)

		fireEvent.change(screen.getByLabelText("Ping payload bytes"), { target: { value: "64" } })
		fireEvent.click(screen.getByText("Run Ping Probe"))

		await waitFor(() => expect(grpcClientMocks.pingLatencyProbe).toHaveBeenCalledTimes(1))
		expect(screen.getByText(/Samples: 1/)).toBeTruthy()
		expect(screen.getByText(/Payload: 64 bytes/)).toBeTruthy()
		expect(screen.getByText(/Branch: main/)).toBeTruthy()
		expect(screen.getByText(/State pushes: 3/)).toBeTruthy()
	})
})
