import { render, screen, fireEvent } from "@/utils/test-utils"

import { DeleteButton } from "../DeleteButton"

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

describe("DeleteButton", () => {
	it("calls onDelete when clicked", () => {
		const onDelete = vi.fn()
		render(<DeleteButton itemId="test-id" onDelete={onDelete} />)

		const deleteButton = screen.getByRole("button")
		fireEvent.click(deleteButton)

		expect(onDelete).toHaveBeenCalledWith("test-id")
	})
})
