import { render, screen, fireEvent } from "@/utils/test-utils"

import { vscode } from "@src/utils/vscode"

import { ExportButton } from "../ExportButton"

vi.mock("@src/utils/vscode")

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

describe("ExportButton", () => {
	beforeEach(() => {
		vi.clearAllMocks()
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
