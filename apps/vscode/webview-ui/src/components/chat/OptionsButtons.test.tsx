import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { OptionsButtons } from "./OptionsButtons"

const askResponseMock = vi.hoisted(() => vi.fn())

vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: {
		askResponse: askResponseMock,
	},
}))

describe("OptionsButtons", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("removes hover affordance from the other options immediately after a selection", async () => {
		askResponseMock.mockReturnValue(new Promise(() => undefined))

		render(<OptionsButtons isActive options={["Use this", "Use that"]} />)

		const selectedButton = screen.getByRole("button", { name: "Use this" })
		const otherButton = screen.getByRole("button", { name: "Use that" })

		expect(getComputedStyle(otherButton).cursor).toBe("pointer")

		fireEvent.click(selectedButton)

		expect(askResponseMock).toHaveBeenCalledTimes(1)
		await waitFor(() => {
			expect(getComputedStyle(selectedButton).cursor).toBe("default")
			expect(getComputedStyle(otherButton).cursor).toBe("default")
		})

		fireEvent.click(otherButton)

		expect(askResponseMock).toHaveBeenCalledTimes(1)
	})

	it("re-enables options after askResponse rejects", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
		askResponseMock.mockRejectedValue(new Error("failed"))

		render(<OptionsButtons isActive options={["Use this", "Use that"]} />)

		const selectedButton = screen.getByRole("button", { name: "Use this" })
		const otherButton = screen.getByRole("button", { name: "Use that" })

		fireEvent.click(selectedButton)

		expect(askResponseMock).toHaveBeenCalledTimes(1)
		await waitFor(() => {
			expect(selectedButton).not.toBeDisabled()
			expect(otherButton).not.toBeDisabled()
			expect(getComputedStyle(otherButton).cursor).toBe("pointer")
		})

		consoleError.mockRestore()
	})

	it("splits concatenated JSON-like options into separate buttons", () => {
		render(
			<OptionsButtons
				isActive
				options={[
					'Implement a new communication protocol handler"] ["Add a display feature/UI element"] ["Improve existing functionality"] | ["Other (Please specify)',
				]}
			/>,
		)

		expect(screen.getByRole("button", { name: "Implement a new communication protocol handler" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Add a display feature/UI element" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Improve existing functionality" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Other (Please specify)" })).toBeInTheDocument()
	})
})
