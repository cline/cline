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
	})
})
