import { fireEvent, render, screen } from "@testing-library/react"
import type { ChangeEvent, ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import ReasoningEffortSelector from "./ReasoningEffortSelector"

const mockExtensionState = vi.hoisted(() => ({
	state: { apiConfiguration: {} as Record<string, unknown>, planActSeparateModelsSetting: false },
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => mockExtensionState.state,
}))

vi.mock("@/services/grpc-client", () => ({
	ModelsServiceClient: { updateApiConfigurationProto: vi.fn(async () => undefined) },
}))

// Render the Radix select as a native one so the shown value and change events
// are observable in jsdom. Like Radix, a native select reports no change when
// the already-shown option is picked again.
vi.mock("@/components/ui/select", () => ({
	Select: ({
		children,
		onValueChange,
		value,
	}: {
		children?: ReactNode
		onValueChange?: (value: string) => void
		value?: string
	}) => (
		<select
			aria-label="Reasoning Effort"
			onChange={(event: ChangeEvent<HTMLSelectElement>) => onValueChange?.(event.target.value)}
			value={value}>
			{children}
		</select>
	),
	SelectTrigger: () => null,
	SelectValue: () => null,
	SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
	SelectItem: ({ children, value }: { children?: ReactNode; value: string }) => <option value={value}>{children}</option>,
}))

function shownEffort(): string {
	return (screen.getByLabelText("Reasoning Effort") as HTMLSelectElement).value
}

function pick(effort: string) {
	fireEvent.change(screen.getByLabelText("Reasoning Effort"), { target: { value: effort } })
}

beforeEach(() => {
	mockExtensionState.state = { apiConfiguration: {}, planActSeparateModelsSetting: false }
})

describe("ReasoningEffortSelector with a provider-saved value", () => {
	it("shows Default when nothing is saved, so picking None saves it", () => {
		const onEffortChange = vi.fn()
		render(<ReasoningEffortSelector currentMode="act" defaultEffort="none" onEffortChange={onEffortChange} value="default" />)

		expect(shownEffort()).toBe("default")
		pick("none")

		expect(onEffortChange).toHaveBeenCalledWith("none")
	})

	it("shows the provider's saved effort rather than the shared per-mode field", () => {
		mockExtensionState.state.apiConfiguration = { actModeReasoningEffort: "none" }
		render(<ReasoningEffortSelector currentMode="act" onEffortChange={vi.fn()} value="default" />)

		expect(shownEffort()).toBe("default")
	})

	it("shows a saved level", () => {
		render(<ReasoningEffortSelector currentMode="act" onEffortChange={vi.fn()} value="high" />)

		expect(shownEffort()).toBe("high")
	})

	it("reports Default when the user picks it to clear a saved level", () => {
		const onEffortChange = vi.fn()
		render(<ReasoningEffortSelector currentMode="act" onEffortChange={onEffortChange} value="high" />)

		pick("default")

		expect(onEffortChange).toHaveBeenCalledWith("default")
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

		expect(shownEffort()).toBe("default")
	})
})

describe("ReasoningEffortSelector without a provider-saved value", () => {
	it("keeps showing the shared per-mode field and offers no Default entry", () => {
		mockExtensionState.state.apiConfiguration = { actModeReasoningEffort: "low" }
		render(<ReasoningEffortSelector currentMode="act" />)

		expect(shownEffort()).toBe("low")
		expect(screen.queryByRole("option", { name: "Default" })).not.toBeInTheDocument()
	})
})
