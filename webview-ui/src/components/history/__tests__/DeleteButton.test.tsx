import { render, screen, fireEvent } from "@testing-library/react"
import { DeleteButton } from "../DeleteButton"

jest.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

describe("DeleteButton", () => {
	it("calls onDelete when clicked", () => {
		const onDelete = jest.fn()
		render(<DeleteButton itemId="test-id" onDelete={onDelete} />)

		const deleteButton = screen.getByRole("button")
		fireEvent.click(deleteButton)

		expect(onDelete).toHaveBeenCalledWith("test-id")
	})
})
