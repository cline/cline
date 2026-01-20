import { describe, expect, it, vi } from "vitest"
import { createBaseButtonProps, createModalTriggerButtonProps } from "../interactiveProps"

describe("interactiveProps", () => {
	describe("button prop factories", () => {
		it("createBaseButtonProps returns correct props", () => {
			const onClick = vi.fn()
			const props = createBaseButtonProps("Test", onClick)

			expect(props.type).toBe("button")
			expect(props["aria-label"]).toBe("Test")
			expect(props.onClick).toBe(onClick)
		})

		it("createModalTriggerButtonProps includes aria-haspopup", () => {
			const props = createModalTriggerButtonProps("Open", vi.fn())
			expect(props["aria-haspopup"]).toBe("dialog")
		})

		it("createModalTriggerButtonProps accepts custom popup type", () => {
			const props = createModalTriggerButtonProps("Open", vi.fn(), { popupType: "menu" })
			expect(props["aria-haspopup"]).toBe("menu")
		})

		it("createModalTriggerButtonProps accepts modalId for aria-controls", () => {
			const props = createModalTriggerButtonProps("Open", vi.fn(), { modalId: "test-modal" })
			expect(props["aria-controls"]).toBe("test-modal")
		})
	})
})
