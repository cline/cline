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
})
