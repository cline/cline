import { render, screen, fireEvent } from "@/utils/test-utils"

import { useClipboard } from "@/components/ui/hooks"

import { CopyButton } from "../CopyButton"

vi.mock("@/components/ui/hooks")
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

describe("CopyButton", () => {
	const mockCopy = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
		;(useClipboard as any).mockReturnValue({
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
