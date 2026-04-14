import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import TerminalSettingsSection from "./TerminalSettingsSection"

const mockUpdateSetting = vi.fn()

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(() => ({
		terminalReuseEnabled: false,
	})),
}))

vi.mock("../utils/settingsHandlers", () => ({
	updateSetting: (...args: unknown[]) => mockUpdateSetting(...args),
}))

vi.mock("../TerminalOutputLineLimitSlider", () => ({
	default: () => <div>Terminal Output Line Limit Slider</div>,
}))

describe("TerminalSettingsSection", () => {
	it("renders remaining terminal settings without foreground terminal mode UI", () => {
		render(<TerminalSettingsSection renderSectionHeader={() => null} />)

		expect(screen.getByText("Enable aggressive terminal reuse")).toBeTruthy()
		expect(screen.getByText("Terminal Output Line Limit Slider")).toBeTruthy()
		expect(screen.queryByText(/foreground terminal/i)).toBeNull()
		expect(screen.queryByText(/terminal execution mode/i)).toBeNull()
	})

	it("updates terminalReuseEnabled when toggled", () => {
		const { container } = render(<TerminalSettingsSection renderSectionHeader={() => null} />)

		const reuseCheckbox = container.querySelector("#terminal-settings-section vscode-checkbox")
		expect(reuseCheckbox).toBeTruthy()

		fireEvent.change(reuseCheckbox as Element, { target: { checked: true } })

		expect(mockUpdateSetting).toHaveBeenCalledWith("terminalReuseEnabled", true)
	})
})
