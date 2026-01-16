import { describe, expect, it, vi } from "vitest"
import {
	combineKeyboardHandlers,
	createArrowKeyNavigationHandler,
	createBaseButtonProps,
	createDivAsModalTriggerProps,
	createEscapeHandler,
	createKeyboardActivationHandler,
	createModalTriggerButtonProps,
	createToggleButtonProps,
	getFocusableElements,
} from "../interactiveProps"

describe("interactiveProps", () => {
	describe("keyboard handlers", () => {
		it("createKeyboardActivationHandler calls handler on Enter/Space", () => {
			const handler = vi.fn()
			const keyHandler = createKeyboardActivationHandler(handler)

			keyHandler({ key: "Enter", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>)
			keyHandler({ key: " ", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>)
			keyHandler({ key: "a", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>)

			expect(handler).toHaveBeenCalledTimes(2)
		})

		it("createArrowKeyNavigationHandler handles arrow keys", () => {
			const onNext = vi.fn()
			const onPrev = vi.fn()
			const handler = createArrowKeyNavigationHandler({ onNext, onPrev, orientation: "vertical" })

			handler({ key: "ArrowDown", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>)
			handler({ key: "ArrowUp", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>)

			expect(onNext).toHaveBeenCalledTimes(1)
			expect(onPrev).toHaveBeenCalledTimes(1)
		})

		it("createEscapeHandler calls onEscape on Escape key", () => {
			const onEscape = vi.fn()
			const handler = createEscapeHandler(onEscape)

			handler({ key: "Escape", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>)
			expect(onEscape).toHaveBeenCalledTimes(1)
		})

		it("combineKeyboardHandlers calls all handlers", () => {
			const h1 = vi.fn()
			const h2 = vi.fn()
			const combined = combineKeyboardHandlers(h1, h2)

			combined({ key: "Enter" } as unknown as React.KeyboardEvent<HTMLElement>)
			expect(h1).toHaveBeenCalled()
			expect(h2).toHaveBeenCalled()
		})
	})

	describe("button prop factories", () => {
		it("createBaseButtonProps returns correct props", () => {
			const onClick = vi.fn()
			const props = createBaseButtonProps("Test", onClick)

			expect(props.type).toBe("button")
			expect(props["aria-label"]).toBe("Test")
			expect(props.onClick).toBe(onClick)
		})

		it("createToggleButtonProps includes aria-expanded", () => {
			const props = createToggleButtonProps(true, vi.fn())
			expect(props["aria-expanded"]).toBe(true)
		})

		it("createModalTriggerButtonProps includes aria-haspopup", () => {
			const props = createModalTriggerButtonProps("Open", vi.fn())
			expect(props["aria-haspopup"]).toBe("dialog")
		})

		it("createDivAsModalTriggerProps adds role and keyboard handler", () => {
			const onClick = vi.fn()
			const props = createDivAsModalTriggerProps("Open", onClick)

			expect(props.role).toBe("button")
			expect(props.tabIndex).toBe(0)
			expect(props.onKeyDown).toBeDefined()
		})
	})

	describe("getFocusableElements", () => {
		it("returns focusable elements excluding disabled", () => {
			const container = document.createElement("div")
			container.innerHTML = `<button>Enabled</button><button disabled>Disabled</button>`
			document.body.appendChild(container)

			const elements = getFocusableElements(container)
			expect(elements.length).toBe(1)

			document.body.removeChild(container)
		})
	})
})
