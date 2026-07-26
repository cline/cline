import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useHasFeatureFlag } from "@/hooks/useFeatureFlag"
import { StateServiceClient } from "@/services/grpc-client"
import { ClinePassHint } from "../ClinePassHint"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

vi.mock("@/hooks/useFeatureFlag", () => ({
	useHasFeatureFlag: vi.fn(),
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(),
}))

vi.mock("@/services/grpc-client", () => ({
	StateServiceClient: {
		dismissBanner: vi.fn(() => Promise.resolve({})),
	},
}))

vi.mock("../utils/useApiConfigurationHandlers", () => ({
	useApiConfigurationHandlers: vi.fn(),
}))

const mockHandleModeFieldChange = vi.fn(() => Promise.resolve())

const mockExtensionState = (overrides: Record<string, unknown> = {}) => {
	vi.mocked(useExtensionState).mockReturnValue({
		dismissedBanners: [],
		remoteConfigSettings: undefined,
		...overrides,
	} as any)
}

describe("ClinePassHint", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(useHasFeatureFlag).mockReturnValue(true)
		vi.mocked(useApiConfigurationHandlers).mockReturnValue({
			handleModeFieldChange: mockHandleModeFieldChange,
		} as any)
		mockExtensionState()
	})

	it("shows the hint for non-ClinePass providers", () => {
		render(<ClinePassHint currentMode="plan" selectedProvider="anthropic" />)
		expect(screen.getByTestId("cline-pass-settings-hint")).toBeInTheDocument()
	})

	it("selects the ClinePass provider for the current mode when clicking Try it", () => {
		render(<ClinePassHint currentMode="plan" selectedProvider="anthropic" />)
		fireEvent.click(screen.getByText("Try it"))
		expect(mockHandleModeFieldChange).toHaveBeenCalledWith(
			{ plan: "planModeApiProvider", act: "actModeApiProvider" },
			"cline-pass",
			"plan",
		)
	})

	it("hides the hint when the feature flag is off", () => {
		vi.mocked(useHasFeatureFlag).mockReturnValue(false)
		render(<ClinePassHint currentMode="plan" selectedProvider="anthropic" />)
		expect(screen.queryByTestId("cline-pass-settings-hint")).not.toBeInTheDocument()
	})

	it("hides the hint when ClinePass is already selected", () => {
		render(<ClinePassHint currentMode="plan" selectedProvider="cline-pass" />)
		expect(screen.queryByTestId("cline-pass-settings-hint")).not.toBeInTheDocument()
	})

	it("hides the hint once dismissed and persists the dismissal", () => {
		render(<ClinePassHint currentMode="plan" selectedProvider="anthropic" />)
		fireEvent.click(screen.getByLabelText("Dismiss ClinePass hint"))
		expect(screen.queryByTestId("cline-pass-settings-hint")).not.toBeInTheDocument()
		expect(StateServiceClient.dismissBanner).toHaveBeenCalledWith({ value: "cline-pass-settings-hint-v1" })
	})

	it("stays hidden when a previous dismissal is in extension state", () => {
		mockExtensionState({ dismissedBanners: [{ bannerId: "cline-pass-settings-hint-v1", dismissedAt: 1 }] })
		render(<ClinePassHint currentMode="plan" selectedProvider="anthropic" />)
		expect(screen.queryByTestId("cline-pass-settings-hint")).not.toBeInTheDocument()
	})

	it("hides the hint when remote config excludes cline-pass", () => {
		mockExtensionState({ remoteConfigSettings: { remoteConfiguredProviders: ["anthropic"] } })
		render(<ClinePassHint currentMode="plan" selectedProvider="anthropic" />)
		expect(screen.queryByTestId("cline-pass-settings-hint")).not.toBeInTheDocument()
	})
})
