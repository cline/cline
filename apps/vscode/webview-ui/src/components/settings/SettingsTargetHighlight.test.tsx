import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import SettingsTargetHighlight from "./SettingsTargetHighlight"
import {
	createSettingsNavigationRequest,
	featureSettingControlId,
	featureSettingElementId,
	getNextSettingsNavigationRequestId,
	resolveSettingsTarget,
} from "./settingsTargets"

describe("settings navigation requests", () => {
	it("shares one request sequence across navigation producers", () => {
		const contextRequest = createSettingsNavigationRequest("checkpoints")
		const messageRequestId = getNextSettingsNavigationRequestId()

		expect(messageRequestId).toBe(contextRequest.requestId + 1)
	})
})

describe("SettingsTargetHighlight", () => {
	const scrollIntoView = vi.fn()
	const onComplete = vi.fn()
	const target = resolveSettingsTarget("checkpoints")
	if (!target) {
		throw new Error("Missing checkpoints settings target")
	}

	beforeEach(() => {
		Element.prototype.scrollIntoView = scrollIntoView
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
			callback(0)
			return 1
		})
		vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
		scrollIntoView.mockReset()
		onComplete.mockReset()
	})

	const renderTarget = () =>
		render(
			<>
				<div id={featureSettingElementId("checkpoints")} />
				<button id={featureSettingControlId("checkpoints")} type="button">
					Checkpoints
				</button>
				<SettingsTargetHighlight onComplete={onComplete} requestId={1} target={target} />
			</>,
		)

	it("scrolls to, focuses, and starts the target highlight animation", () => {
		renderTarget()
		const row = document.getElementById(featureSettingElementId("checkpoints")) as HTMLElement

		expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" })
		expect(screen.getByRole("button", { name: "Checkpoints" })).toHaveFocus()
		expect(row).toHaveClass("settings-target-highlight")
		expect(onComplete).not.toHaveBeenCalled()

		fireEvent.animationEnd(row)
		expect(row).not.toHaveClass("settings-target-highlight")
		expect(onComplete).toHaveBeenCalledWith(1)
	})

	it("uses instant scrolling while the reduced-motion highlight runs", () => {
		vi.mocked(window.matchMedia).mockReturnValueOnce({
			matches: true,
			media: "(prefers-reduced-motion: reduce)",
			onchange: null,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			addListener: vi.fn(),
			removeListener: vi.fn(),
			dispatchEvent: vi.fn(),
		})
		renderTarget()
		const row = document.getElementById(featureSettingElementId("checkpoints")) as HTMLElement

		expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "center" })
		expect(screen.getByRole("button", { name: "Checkpoints" })).toHaveFocus()
		expect(row).toHaveClass("settings-target-highlight")

		fireEvent.animationEnd(row)
		expect(row).not.toHaveClass("settings-target-highlight")
		expect(onComplete).toHaveBeenCalledWith(1)
	})
})
