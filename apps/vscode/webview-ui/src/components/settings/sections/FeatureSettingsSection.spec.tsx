import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import FeatureSettingsSection from "./FeatureSettingsSection"

const mockUpdateSetting = vi.fn()
const mockExtensionState = vi.hoisted(() => ({
	value: {
		enableCheckpointsSetting: true,
		hooksEnabled: false,
		showFeatureTips: false,
		mcpDisplayMode: "rich",
		yoloModeToggled: false,
		useAutoCondense: false,
		compactionStrategy: "basic",
		subagentsEnabled: false,
		worktreesEnabled: { user: true, featureFlag: true },
		focusChainSettings: { enabled: false, remindClineInterval: 6 },
		remoteConfigSettings: {},
		backgroundEditEnabled: false,
		maxConsecutiveMistakes: 3,
		requestTimeoutMs: undefined,
	},
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(() => mockExtensionState.value),
}))

vi.mock("../utils/settingsHandlers", () => ({
	updateSetting: (...args: unknown[]) => mockUpdateSetting(...args),
}))

// Render the VSCodeTextField web component as a native <input> so value/onInput
// behavior is observable in jsdom (the toolkit's custom element exposes no
// value setter for testing-library's setNativeValue).
vi.mock("@vscode/webview-ui-toolkit/react", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@vscode/webview-ui-toolkit/react")>()
	return {
		...actual,
		VSCodeTextField: (props: {
			id?: string
			value?: string | number
			placeholder?: string
			onInput?: (event: { target: HTMLInputElement }) => void
			onBlur?: () => void
			style?: React.CSSProperties
			children?: React.ReactNode
		}) => (
			<input
				id={props.id}
				onBlur={props.onBlur}
				onInput={(event) => props.onInput?.({ target: event.currentTarget })}
				placeholder={props.placeholder}
				value={props.value ?? ""}
			/>
		),
	}
})

describe("FeatureSettingsSection", () => {
	beforeEach(() => {
		mockUpdateSetting.mockClear()
		mockExtensionState.value = {
			...mockExtensionState.value,
			useAutoCondense: false,
			compactionStrategy: "basic",
		}
	})

	it("renders Hooks feature toggle", () => {
		const { container } = render(<FeatureSettingsSection renderSectionHeader={() => null} />)

		expect(screen.getByText("Hooks")).toBeTruthy()

		const advancedSection = container.querySelector("#advanced-features")
		const agentSection = container.querySelector("#agent-features")

		expect(advancedSection?.querySelector("#Hooks")).toBeTruthy()
		expect(agentSection?.querySelector("#Hooks")).toBeNull()
	})

	it("renders Feature Tips toggle in the Editor section", () => {
		const { container } = render(<FeatureSettingsSection renderSectionHeader={() => null} />)

		expect(screen.getByText("Feature Tips")).toBeTruthy()

		const editorSection = container.querySelector("#optional-features")
		const agentSection = container.querySelector("#agent-features")

		expect(editorSection?.querySelector('[id="Feature Tips"]')).toBeTruthy()
		expect(agentSection?.querySelector('[id="Feature Tips"]')).toBeNull()
	})

	it("renders the Auto Compact Strategy setting in the Agent section", () => {
		const { container } = render(<FeatureSettingsSection renderSectionHeader={() => null} />)

		expect(screen.getByText("Auto Compact Strategy")).toBeTruthy()

		const agentSection = container.querySelector("#agent-features")
		expect(agentSection?.textContent).toContain("Basic")
	})

	it("disables Auto Compact Strategy when Auto Compact is off", () => {
		const { container } = render(<FeatureSettingsSection renderSectionHeader={() => null} />)

		const strategySelect = container.querySelector("#agent-features button[role='combobox']")
		expect(strategySelect).toHaveAttribute("disabled")
	})

	it("calls updateSetting with hooksEnabled when toggled", () => {
		const { container } = render(<FeatureSettingsSection renderSectionHeader={() => null} />)

		const hooksSwitch = container.querySelector("#Hooks")
		expect(hooksSwitch).toBeTruthy()

		fireEvent.click(hooksSwitch as Element)

		expect(mockUpdateSetting).toHaveBeenCalledWith("hooksEnabled", true)
	})

	it("calls updateSetting with showFeatureTips when toggled", () => {
		const { container } = render(<FeatureSettingsSection renderSectionHeader={() => null} />)

		const featureTipsSwitch = container.querySelector('[id="Feature Tips"]')
		expect(featureTipsSwitch).toBeTruthy()

		fireEvent.click(featureTipsSwitch as Element)

		expect(mockUpdateSetting).toHaveBeenCalledWith("showFeatureTips", true)
	})

	it("renders Max Consecutive Mistakes in the Agent section", () => {
		const { container } = render(<FeatureSettingsSection renderSectionHeader={() => null} />)

		expect(screen.getByText("Max Consecutive Mistakes")).toBeTruthy()

		const agentSection = container.querySelector("#agent-features")
		const input = agentSection?.querySelector("#max-consecutive-mistakes") as HTMLInputElement
		expect(input).toBeTruthy()
		expect(input.value).toBe("3")
	})

	it("commits Max Consecutive Mistakes via updateSetting on blur", () => {
		const { container } = render(<FeatureSettingsSection renderSectionHeader={() => null} />)

		const input = container.querySelector("#max-consecutive-mistakes") as HTMLInputElement
		fireEvent.input(input, { target: { value: "5" } })
		fireEvent.blur(input)

		expect(mockUpdateSetting).toHaveBeenCalledWith("maxConsecutiveMistakes", 5)
	})

	it("renders Request Timeout (ms) in the Advanced section", () => {
		mockExtensionState.value = { ...mockExtensionState.value, requestTimeoutMs: 30000 }
		const { container } = render(<FeatureSettingsSection renderSectionHeader={() => null} />)

		expect(screen.getByText("Request Timeout (ms)")).toBeTruthy()

		const advancedSection = container.querySelector("#advanced-features")
		const input = advancedSection?.querySelector("#request-timeout-ms") as HTMLInputElement
		expect(input).toBeTruthy()
		expect(input.value).toBe("30000")
	})

	it("commits Request Timeout via updateSetting on blur", () => {
		mockExtensionState.value = { ...mockExtensionState.value, requestTimeoutMs: undefined }
		const { container } = render(<FeatureSettingsSection renderSectionHeader={() => null} />)

		const input = container.querySelector("#request-timeout-ms") as HTMLInputElement
		fireEvent.input(input, { target: { value: "45000" } })
		fireEvent.blur(input)

		expect(mockUpdateSetting).toHaveBeenCalledWith("requestTimeoutMs", 45000)
	})

	it("clears Request Timeout (provider default) when the field is emptied", () => {
		mockExtensionState.value = { ...mockExtensionState.value, requestTimeoutMs: 30000 }
		const { container } = render(<FeatureSettingsSection renderSectionHeader={() => null} />)

		const input = container.querySelector("#request-timeout-ms") as HTMLInputElement
		fireEvent.input(input, { target: { value: "" } })
		fireEvent.blur(input)

		expect(mockUpdateSetting).toHaveBeenCalledWith("requestTimeoutMs", 0)
	})
})
