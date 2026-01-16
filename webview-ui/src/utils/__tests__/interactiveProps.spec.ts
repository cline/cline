import { describe, expect, it, vi } from "vitest"
import {
	combineKeyboardHandlers,
	createArrowKeyNavigationHandler,
	createBaseButtonProps,
	createButtonStyle,
	createDivAsModalTriggerProps,
	createEscapeHandler,
	createIconButtonProps,
	createKeyboardActivationHandler,
	createModalTriggerButtonProps,
	createToggleButtonProps,
	getFocusableElements,
} from "../interactiveProps"

describe("createKeyboardActivationHandler", () => {
	it("should call handler on Enter key", () => {
		const handler = vi.fn()
		const keyHandler = createKeyboardActivationHandler(handler)

		const event = { key: "Enter", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>
		keyHandler(event)

		expect(handler).toHaveBeenCalledTimes(1)
		expect(event.preventDefault).toHaveBeenCalled()
	})

	it("should call handler on Space key", () => {
		const handler = vi.fn()
		const keyHandler = createKeyboardActivationHandler(handler)

		const event = { key: " ", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>
		keyHandler(event)

		expect(handler).toHaveBeenCalledTimes(1)
		expect(event.preventDefault).toHaveBeenCalled()
	})

	it("should not call handler on other keys", () => {
		const handler = vi.fn()
		const keyHandler = createKeyboardActivationHandler(handler)

		const event = { key: "a", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>
		keyHandler(event)

		expect(handler).not.toHaveBeenCalled()
		expect(event.preventDefault).not.toHaveBeenCalled()
	})
})

describe("createArrowKeyNavigationHandler", () => {
	it("should call onNext on ArrowRight for horizontal orientation", () => {
		const onNext = vi.fn()
		const handler = createArrowKeyNavigationHandler({ onNext, orientation: "horizontal" })

		const event = { key: "ArrowRight", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>
		handler(event)

		expect(onNext).toHaveBeenCalledTimes(1)
		expect(event.preventDefault).toHaveBeenCalled()
	})

	it("should call onPrev on ArrowLeft for horizontal orientation", () => {
		const onPrev = vi.fn()
		const handler = createArrowKeyNavigationHandler({ onPrev, orientation: "horizontal" })

		const event = { key: "ArrowLeft", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>
		handler(event)

		expect(onPrev).toHaveBeenCalledTimes(1)
	})

	it("should call onNext on ArrowDown for vertical orientation", () => {
		const onNext = vi.fn()
		const handler = createArrowKeyNavigationHandler({ onNext, orientation: "vertical" })

		const event = { key: "ArrowDown", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>
		handler(event)

		expect(onNext).toHaveBeenCalledTimes(1)
	})

	it("should call onPrev on ArrowUp for vertical orientation", () => {
		const onPrev = vi.fn()
		const handler = createArrowKeyNavigationHandler({ onPrev, orientation: "vertical" })

		const event = { key: "ArrowUp", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>
		handler(event)

		expect(onPrev).toHaveBeenCalledTimes(1)
	})

	it("should handle both orientations", () => {
		const onNext = vi.fn()
		const onPrev = vi.fn()
		const handler = createArrowKeyNavigationHandler({ onNext, onPrev, orientation: "both" })

		handler({ key: "ArrowRight", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>)
		handler({ key: "ArrowDown", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>)
		handler({ key: "ArrowLeft", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>)
		handler({ key: "ArrowUp", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>)

		expect(onNext).toHaveBeenCalledTimes(2)
		expect(onPrev).toHaveBeenCalledTimes(2)
	})

	it("should call onFirst on Home key", () => {
		const onFirst = vi.fn()
		const handler = createArrowKeyNavigationHandler({ onFirst })

		const event = { key: "Home", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>
		handler(event)

		expect(onFirst).toHaveBeenCalledTimes(1)
	})

	it("should call onLast on End key", () => {
		const onLast = vi.fn()
		const handler = createArrowKeyNavigationHandler({ onLast })

		const event = { key: "End", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>
		handler(event)

		expect(onLast).toHaveBeenCalledTimes(1)
	})

	it("should not call handler for unrelated keys", () => {
		const onNext = vi.fn()
		const handler = createArrowKeyNavigationHandler({ onNext })

		const event = { key: "Enter", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>
		handler(event)

		expect(onNext).not.toHaveBeenCalled()
		expect(event.preventDefault).not.toHaveBeenCalled()
	})
})

describe("createEscapeHandler", () => {
	it("should call onEscape on Escape key", () => {
		const onEscape = vi.fn()
		const handler = createEscapeHandler(onEscape)

		const event = { key: "Escape", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>
		handler(event)

		expect(onEscape).toHaveBeenCalledTimes(1)
		expect(event.preventDefault).toHaveBeenCalled()
	})

	it("should not call onEscape on other keys", () => {
		const onEscape = vi.fn()
		const handler = createEscapeHandler(onEscape)

		const event = { key: "Enter", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>
		handler(event)

		expect(onEscape).not.toHaveBeenCalled()
	})
})

describe("combineKeyboardHandlers", () => {
	it("should call all handlers", () => {
		const handler1 = vi.fn()
		const handler2 = vi.fn()
		const combined = combineKeyboardHandlers(handler1, handler2)

		const event = { key: "Enter" } as unknown as React.KeyboardEvent<HTMLElement>
		combined(event)

		expect(handler1).toHaveBeenCalledWith(event)
		expect(handler2).toHaveBeenCalledWith(event)
	})

	it("should skip undefined handlers", () => {
		const handler1 = vi.fn()
		const combined = combineKeyboardHandlers(handler1, undefined)

		const event = { key: "Enter" } as unknown as React.KeyboardEvent<HTMLElement>
		combined(event)

		expect(handler1).toHaveBeenCalledWith(event)
	})
})

describe("createBaseButtonProps", () => {
	it("should return correct props", () => {
		const onClick = vi.fn()
		const props = createBaseButtonProps("Test label", onClick)

		expect(props.type).toBe("button")
		expect(props["aria-label"]).toBe("Test label")
		expect(props.onClick).toBe(onClick)
	})

	it("should allow custom type", () => {
		const onClick = vi.fn()
		const props = createBaseButtonProps("Submit", onClick, "submit")

		expect(props.type).toBe("submit")
	})
})

describe("createIconButtonProps", () => {
	it("should be an alias for createBaseButtonProps", () => {
		expect(createIconButtonProps).toBe(createBaseButtonProps)
	})
})

describe("createToggleButtonProps", () => {
	it("should return expanded state", () => {
		const onToggle = vi.fn()
		const props = createToggleButtonProps(true, onToggle)

		expect(props["aria-expanded"]).toBe(true)
		expect(props.type).toBe("button")
	})

	it("should return collapsed state", () => {
		const onToggle = vi.fn()
		const props = createToggleButtonProps(false, onToggle)

		expect(props["aria-expanded"]).toBe(false)
	})

	it("should use custom aria-label", () => {
		const onToggle = vi.fn()
		const props = createToggleButtonProps(true, onToggle, "Custom label")

		expect(props["aria-label"]).toBe("Custom label")
	})

	it("should use default aria-label based on state", () => {
		const onToggle = vi.fn()
		const expandedProps = createToggleButtonProps(true, onToggle)
		const collapsedProps = createToggleButtonProps(false, onToggle)

		expect(expandedProps["aria-label"]).toBe("Collapse")
		expect(collapsedProps["aria-label"]).toBe("Expand")
	})

	it("should add escape handler when collapseOnEscape is true and expanded", () => {
		const onToggle = vi.fn()
		const props = createToggleButtonProps(true, onToggle, undefined, true)

		expect(props.onKeyDown).toBeDefined()
	})

	it("should not add escape handler when collapsed", () => {
		const onToggle = vi.fn()
		const props = createToggleButtonProps(false, onToggle, undefined, true)

		expect(props.onKeyDown).toBeUndefined()
	})
})

describe("createModalTriggerButtonProps", () => {
	it("should return correct props", () => {
		const onClick = vi.fn()
		const props = createModalTriggerButtonProps("Open modal", onClick)

		expect(props.type).toBe("button")
		expect(props["aria-label"]).toBe("Open modal")
		expect(props["aria-haspopup"]).toBe("dialog")
		expect(props.onClick).toBe(onClick)
	})

	it("should set aria-controls when modalId provided", () => {
		const onClick = vi.fn()
		const props = createModalTriggerButtonProps("Open modal", onClick, { modalId: "my-modal" })

		expect(props["aria-controls"]).toBe("my-modal")
	})

	it("should use custom popup type", () => {
		const onClick = vi.fn()
		const props = createModalTriggerButtonProps("Open menu", onClick, { popupType: "menu" })

		expect(props["aria-haspopup"]).toBe("menu")
	})

	it("should add escape handler when onEscape provided", () => {
		const onClick = vi.fn()
		const onEscape = vi.fn()
		const props = createModalTriggerButtonProps("Open modal", onClick, { onEscape })

		expect(props.onKeyDown).toBeDefined()
	})
})

describe("createDivAsModalTriggerProps", () => {
	it("should return correct props for div acting as button", () => {
		const onClick = vi.fn()
		const props = createDivAsModalTriggerProps("Open modal", onClick)

		expect(props.role).toBe("button")
		expect(props["aria-label"]).toBe("Open modal")
		expect(props["aria-haspopup"]).toBe("dialog")
		expect(props.tabIndex).toBe(0)
		expect(props.onClick).toBe(onClick)
		expect(props.onKeyDown).toBeDefined()
	})

	it("should set aria-expanded when provided", () => {
		const onClick = vi.fn()
		const props = createDivAsModalTriggerProps("Open modal", onClick, true)

		expect(props["aria-expanded"]).toBe(true)
	})

	it("should use custom popup type", () => {
		const onClick = vi.fn()
		const props = createDivAsModalTriggerProps("Open menu", onClick, false, "menu")

		expect(props["aria-haspopup"]).toBe("menu")
	})

	it("should have keyboard handler that activates on Enter/Space", () => {
		const onClick = vi.fn()
		const props = createDivAsModalTriggerProps("Open modal", onClick)

		const enterEvent = { key: "Enter", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLDivElement>
		props.onKeyDown(enterEvent)
		expect(onClick).toHaveBeenCalledTimes(1)

		const spaceEvent = { key: " ", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLDivElement>
		props.onKeyDown(spaceEvent)
		expect(onClick).toHaveBeenCalledTimes(2)
	})
})

describe("getFocusableElements", () => {
	it("should return focusable elements", () => {
		const container = document.createElement("div")
		container.innerHTML = `
			<button>Button</button>
			<a href="#">Link</a>
			<input type="text" />
			<select><option>Option</option></select>
			<textarea></textarea>
			<div tabindex="0">Focusable div</div>
		`
		document.body.appendChild(container)

		const elements = getFocusableElements(container)
		expect(elements.length).toBe(6)

		document.body.removeChild(container)
	})

	it("should exclude disabled elements", () => {
		const container = document.createElement("div")
		container.innerHTML = `
			<button>Enabled</button>
			<button disabled>Disabled</button>
		`
		document.body.appendChild(container)

		const elements = getFocusableElements(container)
		expect(elements.length).toBe(1)

		document.body.removeChild(container)
	})

	it("should exclude elements with aria-hidden", () => {
		const container = document.createElement("div")
		container.innerHTML = `
			<button>Visible</button>
			<button aria-hidden="true">Hidden</button>
		`
		document.body.appendChild(container)

		const elements = getFocusableElements(container)
		expect(elements.length).toBe(1)

		document.body.removeChild(container)
	})

	it("should exclude divs with tabindex=-1", () => {
		const container = document.createElement("div")
		container.innerHTML = `
			<div tabindex="0">Focusable div</div>
			<div tabindex="-1">Not focusable div</div>
		`
		document.body.appendChild(container)

		const elements = getFocusableElements(container)
		expect(elements.length).toBe(1)

		document.body.removeChild(container)
	})

	it("should sort inputs first when sortInputsFirst is true", () => {
		const container = document.createElement("div")
		container.innerHTML = `
			<button>Button</button>
			<input type="text" id="input1" />
			<a href="#">Link</a>
			<textarea id="textarea1"></textarea>
		`
		document.body.appendChild(container)

		const elements = getFocusableElements(container, true)
		expect(elements[0].id).toBe("input1")
		expect(elements[1].id).toBe("textarea1")

		document.body.removeChild(container)
	})
})

describe("createButtonStyle", () => {
	it("should create reset style", () => {
		const style = createButtonStyle.reset()

		expect(style.border).toBe("none")
		expect(style.background).toBe("transparent")
		expect(style.padding).toBe(0)
		expect(style.cursor).toBe("pointer")
	})

	it("should create flexReset style", () => {
		const style = createButtonStyle.flexReset()

		expect(style.display).toBe("flex")
		expect(style.alignItems).toBe("center")
		expect(style.userSelect).toBe("none")
	})

	it("should create fullWidthFlex style", () => {
		const style = createButtonStyle.fullWidthFlex()

		expect(style.width).toBe("100%")
		expect(style.display).toBe("flex")
	})

	it("should create icon style", () => {
		const style = createButtonStyle.icon()

		expect(style.display).toBe("flex")
		expect(style.justifyContent).toBe("center")
	})

	it("should merge custom styles", () => {
		const style = createButtonStyle.reset({ color: "red", fontSize: "16px" })

		expect(style.color).toBe("red")
		expect(style.fontSize).toBe("16px")
		expect(style.border).toBe("none")
	})
})
