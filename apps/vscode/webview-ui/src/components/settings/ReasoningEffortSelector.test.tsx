import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import ReasoningEffortSelector from "./ReasoningEffortSelector"
import type { ReasoningEffortSelection } from "./utils/reasoningEffort"

const mockExtensionState = vi.hoisted(() => ({
	state: { apiConfiguration: {} as Record<string, unknown>, planActSeparateModelsSetting: false },
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => mockExtensionState.state,
}))

vi.mock("@/services/grpc-client", () => ({
	ModelsServiceClient: { updateApiConfigurationProto: vi.fn(async () => undefined) },
}))

// These tests drive the real Radix select: its controlled value reports a
// change only when the pick differs from the value shown, which is the
// behavior that left "None" unsavable. jsdom lacks the pointer-capture and
// scroll APIs Radix calls while opening the list.
beforeAll(() => {
	Element.prototype.hasPointerCapture ??= () => false
	Element.prototype.releasePointerCapture ??= () => {}
	Element.prototype.scrollIntoView ??= () => {}
})

beforeEach(() => {
	mockExtensionState.state = { apiConfiguration: {}, planActSeparateModelsSetting: false }
})

function shownEffort(): string {
	return screen.getByRole("combobox").textContent ?? ""
}

async function pick(user: ReturnType<typeof userEvent.setup>, label: string) {
	await user.click(screen.getByRole("combobox"))
	await user.click(await screen.findByRole("option", { name: label }))
}

/** A provider settings component in miniature: the saved value round-trips through onEffortChange. */
function SavedEffortHarness({
	initial,
	onSave,
}: {
	initial: ReasoningEffortSelection
	onSave: (effort: ReasoningEffortSelection) => void
}) {
	const [saved, setSaved] = useState<ReasoningEffortSelection>(initial)
	return (
		<ReasoningEffortSelector
			currentMode="act"
			defaultEffort="none"
			onEffortChange={(effort) => {
				onSave(effort)
				setSaved(effort)
			}}
			value={saved}
		/>
	)
}

describe("ReasoningEffortSelector with a provider-saved value", () => {
	it("saves None picked from Default, then clears back to Default", async () => {
		const user = userEvent.setup()
		const onSave = vi.fn()
		render(<SavedEffortHarness initial="default" onSave={onSave} />)

		expect(shownEffort()).toBe("Default")
		await pick(user, "None")
		expect(onSave).toHaveBeenLastCalledWith("none")
		expect(shownEffort()).toBe("None")

		await pick(user, "Default")
		expect(onSave).toHaveBeenLastCalledWith("default")
		expect(shownEffort()).toBe("Default")
	})

	it("reports nothing when the shown level is picked again", async () => {
		const user = userEvent.setup()
		const onSave = vi.fn()
		render(<SavedEffortHarness initial="none" onSave={onSave} />)

		await pick(user, "None")

		expect(onSave).not.toHaveBeenCalled()
	})

	it("shows the provider's saved effort rather than the shared per-mode field", () => {
		mockExtensionState.state.apiConfiguration = { actModeReasoningEffort: "none" }
		render(<ReasoningEffortSelector currentMode="act" onEffortChange={vi.fn()} value="default" />)

		expect(shownEffort()).toBe("Default")
	})

	it("falls back to Default for a saved level outside the allowed list", () => {
		render(
			<ReasoningEffortSelector
				allowedEfforts={["none", "low", "medium", "high"]}
				currentMode="act"
				onEffortChange={vi.fn()}
				value="xhigh"
			/>,
		)

		expect(shownEffort()).toBe("Default")
	})

	it("is disabled and shows no level while the saved value loads", () => {
		render(<ReasoningEffortSelector currentMode="act" onEffortChange={vi.fn()} value={null} />)

		expect(screen.getByRole("combobox")).toBeDisabled()
		expect(shownEffort()).toBe("")
	})
})

describe("ReasoningEffortSelector without a provider-saved value", () => {
	it("keeps showing the shared per-mode field and offers no Default entry", async () => {
		const user = userEvent.setup()
		mockExtensionState.state.apiConfiguration = { actModeReasoningEffort: "low" }
		render(<ReasoningEffortSelector currentMode="act" />)

		expect(shownEffort()).toBe("Low")
		await user.click(screen.getByRole("combobox"))
		expect(await screen.findByRole("option", { name: "Low" })).toBeInTheDocument()
		expect(screen.queryByRole("option", { name: "Default" })).not.toBeInTheDocument()
	})
})
