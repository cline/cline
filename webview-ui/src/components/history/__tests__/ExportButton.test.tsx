import { render, screen, fireEvent } from "@testing-library/react"
import { ExportButton } from "../ExportButton"
import { vscode } from "@src/utils/vscode"

jest.mock("@src/utils/vscode")
jest.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

describe("ExportButton", () => {
	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("sends export message when clicked", () => {
		render(<ExportButton itemId="1" />)

		const exportButton = screen.getByRole("button")
		fireEvent.click(exportButton)

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "exportTaskWithId",
			text: "1",
		})
	})
})
