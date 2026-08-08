import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundEditNudge } from "./BackgroundEditNudge"

const mockUpdateSettings = vi.hoisted(() => vi.fn(() => Promise.resolve({})))
const mockExtensionState = vi.hoisted(() => ({
	value: {
		backgroundEditEnabled: false,
		backgroundEditHintDismissed: false,
	},
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => mockExtensionState.value,
}))

vi.mock("@/services/grpc-client", () => ({
	StateServiceClient: {
		updateSettings: mockUpdateSettings,
	},
}))

describe("BackgroundEditNudge", () => {
	beforeEach(() => {
		mockUpdateSettings.mockClear()
		mockExtensionState.value = {
			backgroundEditEnabled: false,
			backgroundEditHintDismissed: false,
		}
	})

	it("renders the hint when Background Edit is off and the hint hasn't been dismissed", () => {
		render(<BackgroundEditNudge />)

		expect(screen.getByText("Tired of the diff editor taking focus?")).toBeTruthy()
		expect(screen.getByText("Enable Background Edit")).toBeTruthy()
	})

	it("renders nothing when Background Edit is already enabled", () => {
		mockExtensionState.value = { ...mockExtensionState.value, backgroundEditEnabled: true }

		const { container } = render(<BackgroundEditNudge />)
		expect(container.firstChild).toBeNull()
	})

	it("renders nothing when the hint was previously dismissed", () => {
		mockExtensionState.value = { ...mockExtensionState.value, backgroundEditHintDismissed: true }

		const { container } = render(<BackgroundEditNudge />)
		expect(container.firstChild).toBeNull()
	})

	it("enables Background Edit and marks the hint dismissed on Enable click", () => {
		render(<BackgroundEditNudge />)

		fireEvent.click(screen.getByText("Enable Background Edit"))

		expect(mockUpdateSettings).toHaveBeenCalledTimes(1)
		expect(mockUpdateSettings).toHaveBeenCalledWith(
			expect.objectContaining({
				backgroundEditEnabled: true,
				backgroundEditHintDismissed: true,
			}),
		)
		// The confirmation stays visible even though the persisted flags would hide the hint
		expect(screen.getByText("Background Edit Enabled")).toBeTruthy()
	})

	it("persists only the dismissal on dismiss click and hides itself", () => {
		const { container } = render(<BackgroundEditNudge />)

		fireEvent.click(screen.getByLabelText("Dismiss"))

		expect(mockUpdateSettings).toHaveBeenCalledTimes(1)
		const request = mockUpdateSettings.mock.calls[0][0] as Record<string, unknown>
		expect(request.backgroundEditHintDismissed).toBe(true)
		expect(request.backgroundEditEnabled).toBeUndefined()
		expect(container.firstChild).toBeNull()
	})
})
