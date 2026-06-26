/**
 * UserMessage – IME composition Enter test
 * --------------------------------------------------
 * Confirm that sendMessageFromChatRow is not called
 * even if you confirm the IME conversion (Enter) in message re-edit mode.
 */

import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/context/ExtensionStateContext", () => ({
	__esModule: true,
	useExtensionState: () => ({
		state: {},
		dispatch: vi.fn(),
	}),
}))

import UserMessage from "../UserMessage"

describe("UserMessage – IME composition handling", () => {
	it("does NOT send when IME composition Enter is pressed while editing", () => {
		const sendMessageFromChatRow = vi.fn()

		const { getByText } = render(
			<UserMessage images={[]} messageTs={Date.now()} sendMessageFromChatRow={sendMessageFromChatRow} text="変換テスト" />,
		)

		const editable = getByText("変換テスト") as HTMLElement
		editable.setAttribute("contenteditable", "true")
		editable.focus()

		fireEvent.compositionStart(editable)
		fireEvent.keyDown(editable, {
			key: "Enter",
			keyCode: 13,
			nativeEvent: { isComposing: true },
		})
		fireEvent.compositionEnd(editable)

		expect(sendMessageFromChatRow).not.toHaveBeenCalled()
	})

	it("cancels inline editing on Escape without bubbling to global task shortcuts", () => {
		const onWindowKeyDown = vi.fn()
		window.addEventListener("keydown", onWindowKeyDown)

		try {
			render(<UserMessage images={[]} messageTs={Date.now()} text="Original prompt" />)

			fireEvent.click(screen.getByText("Original prompt"))

			const textbox = screen.getByRole("textbox")
			fireEvent.change(textbox, { target: { value: "Edited prompt" } })

			fireEvent.keyDown(textbox, { key: "Escape" })

			expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
			expect(screen.getByText("Original prompt")).toBeInTheDocument()
			expect(onWindowKeyDown).not.toHaveBeenCalled()
		} finally {
			window.removeEventListener("keydown", onWindowKeyDown)
		}
	})
})
