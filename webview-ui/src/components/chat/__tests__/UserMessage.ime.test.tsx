/**
 * UserMessage – IME composition Enter test
 * --------------------------------------------------
 * Confirm that sendMessageFromChatRow is not called
 * even if you confirm the IME conversion (Enter) in message re-edit mode.
 */

import React from "react"
import { render, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"

vi.mock("@/store/extensionStore", () => ({
	__esModule: true,
	useExtensionState: (selector: (state: any) => any) => {
		// This mock needs to simulate how the UserMessage component might use the store.
		// For this specific test, it seems UserMessage doesn't rely on any specific state
		// from the store, as the original mock returned a simple object.
		// If UserMessage *does* select specific state, this mock needs to provide it.
		// For now, let's assume it doesn't need specific state for this IME test.
		const mockState = {
			// Provide any state UserMessage might actually select, e.g.:
			// apiConfiguration: { selectedProvider: "anthropic", anthropicModelId: "claude-3-opus-20240229" },
			// chatSettings: { mode: "act" },
		}
		if (typeof selector === "function") {
			return selector(mockState)
		}
		return mockState // Fallback if no selector is used (though components should use selectors)
	},
}))

import UserMessage from "../UserMessage"

describe("UserMessage – IME composition handling", () => {
	it("does NOT send when IME composition Enter is pressed while editing", () => {
		const sendMessageFromChatRow = vi.fn()

		const { getByText } = render(
			<UserMessage text="変換テスト" images={[]} messageTs={Date.now()} sendMessageFromChatRow={sendMessageFromChatRow} />,
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
})
