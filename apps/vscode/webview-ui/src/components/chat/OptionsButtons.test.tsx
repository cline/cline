import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { OptionsButtons } from "./OptionsButtons"

const askResponse = vi.fn().mockResolvedValue(undefined)

vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: {
		askResponse: (req: unknown) => askResponse(req),
	},
}))

vi.mock("@shared/proto/cline/task", () => ({
	AskResponseRequest: { create: (x: unknown) => x },
}))

describe("OptionsButtons", () => {
	beforeEach(() => {
		askResponse.mockReset()
		askResponse.mockResolvedValue(undefined)
	})

	it("latches the selected option and renders optimistic feedback while askResponse is pending", async () => {
		let resolveAskResponse: () => void = () => {}
		const removeOptimisticUserMessage = vi.fn()
		const onOptimisticUserMessage = vi.fn(() => removeOptimisticUserMessage)
		askResponse.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					resolveAskResponse = resolve
				}),
		)

		render(
			<OptionsButtons
				inputValue="extra detail"
				isActive
				onOptimisticUserMessage={onOptimisticUserMessage}
				options={["First", "Second"]}
			/>,
		)

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "First" }))
			await Promise.resolve()
		})
		fireEvent.click(screen.getByRole("button", { name: "Second" }))

		expect(askResponse).toHaveBeenCalledTimes(1)
		expect(askResponse).toHaveBeenCalledWith(
			expect.objectContaining({
				responseType: "messageResponse",
				text: "First: extra detail",
			}),
		)
		expect(onOptimisticUserMessage).toHaveBeenCalledWith("First: extra detail", [], [])
		expect(removeOptimisticUserMessage).not.toHaveBeenCalled()

		await act(async () => {
			resolveAskResponse()
		})
	})

	it("removes optimistic feedback and unlatches the option when askResponse fails", async () => {
		vi.spyOn(console, "error").mockImplementationOnce(() => {})
		const removeOptimisticUserMessage = vi.fn()
		const onOptimisticUserMessage = vi.fn(() => removeOptimisticUserMessage)
		askResponse.mockRejectedValueOnce(new Error("transport down")).mockResolvedValueOnce(undefined)

		render(<OptionsButtons isActive onOptimisticUserMessage={onOptimisticUserMessage} options={["First", "Second"]} />)

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "First" }))
			await Promise.resolve()
		})
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Second" }))
		})

		expect(removeOptimisticUserMessage).toHaveBeenCalledTimes(1)
		expect(askResponse).toHaveBeenCalledTimes(2)
		expect(askResponse).toHaveBeenLastCalledWith(
			expect.objectContaining({
				responseType: "messageResponse",
				text: "Second",
			}),
		)
	})
})
