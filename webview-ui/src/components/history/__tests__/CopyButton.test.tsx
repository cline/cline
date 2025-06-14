import { render, screen, fireEvent } from "@testing-library/react"
import { CopyButton } from "../CopyButton"
import { useClipboard } from "@/components/ui/hooks"

jest.mock("@/components/ui/hooks")
jest.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

describe("CopyButton", () => {
	const mockCopy = jest.fn()

	beforeEach(() => {
		jest.clearAllMocks()
		;(useClipboard as jest.Mock).mockReturnValue({
			isCopied: false,
			copy: mockCopy,
		})
	})

	it("copies task content when clicked", () => {
		render(<CopyButton itemTask="Test task content" />)

		const copyButton = screen.getByRole("button")
		fireEvent.click(copyButton)

		expect(mockCopy).toHaveBeenCalledWith("Test task content")
	})
})
