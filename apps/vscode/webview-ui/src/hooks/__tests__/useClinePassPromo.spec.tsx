import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useApiConfigurationHandlers } from "@/components/settings/utils/useApiConfigurationHandlers"
import { useClineAuth } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useClinePassPromo } from "../useClinePassPromo"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(),
}))

vi.mock("@/context/ClineAuthContext", () => ({
	useClineAuth: vi.fn(),
}))

vi.mock("@/components/settings/utils/useApiConfigurationHandlers", () => ({
	useApiConfigurationHandlers: vi.fn(),
}))

vi.mock("@/services/grpc-client", () => ({
	UiServiceClient: {
		openUrl: vi.fn(() => Promise.resolve({})),
	},
}))

const mockNavigateToSettings = vi.fn()
const mockHandleModeFieldChange = vi.fn(() => Promise.resolve())

const mockExtensionState = (overrides: Record<string, unknown> = {}) => {
	vi.mocked(useExtensionState).mockReturnValue({
		apiConfiguration: { planModeApiProvider: "anthropic", actModeApiProvider: "anthropic" },
		environment: "production",
		navigateToSettings: mockNavigateToSettings,
		remoteConfigSettings: undefined,
		mode: "act",
		planActSeparateModelsSetting: false,
		...overrides,
	} as any)
}

describe("useClinePassPromo", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(useClineAuth).mockReturnValue({ clineUser: null } as any)
		vi.mocked(useApiConfigurationHandlers).mockReturnValue({
			handleModeFieldChange: mockHandleModeFieldChange,
		} as any)
		mockExtensionState()
	})

	it("is enabled when no remote config restricts providers", () => {
		const { result } = renderHook(() => useClinePassPromo())
		expect(result.current.isClinePassEnabled).toBe(true)
	})

	it("is disabled in self-hosted mode", () => {
		mockExtensionState({ environment: "selfHosted" })
		const { result } = renderHook(() => useClinePassPromo())
		expect(result.current.isClinePassEnabled).toBe(false)
	})

	it("is disabled when the environment is unknown", () => {
		mockExtensionState({ environment: undefined })
		const { result } = renderHook(() => useClinePassPromo())
		expect(result.current.isClinePassEnabled).toBe(false)
	})

	it("is disabled when the org remote config excludes cline-pass", () => {
		mockExtensionState({ remoteConfigSettings: { remoteConfiguredProviders: ["anthropic", "openrouter"] } })
		const { result } = renderHook(() => useClinePassPromo())
		expect(result.current.isClinePassEnabled).toBe(false)
	})

	it("stays enabled when the org remote config includes cline-pass", () => {
		mockExtensionState({ remoteConfigSettings: { remoteConfiguredProviders: ["anthropic", "cline-pass"] } })
		const { result } = renderHook(() => useClinePassPromo())
		expect(result.current.isClinePassEnabled).toBe(true)
	})

	it("detects when either mode already uses the ClinePass provider", () => {
		mockExtensionState({
			apiConfiguration: { planModeApiProvider: "cline-pass", actModeApiProvider: "anthropic" },
		})
		const { result } = renderHook(() => useClinePassPromo())
		expect(result.current.isUsingClinePass).toBe(true)
	})

	it("only reflects the current mode's provider when plan/act use separate models", () => {
		mockExtensionState({
			apiConfiguration: { planModeApiProvider: "cline-pass", actModeApiProvider: "anthropic" },
			planActSeparateModelsSetting: true,
			mode: "act",
		})
		const { result: actResult } = renderHook(() => useClinePassPromo())
		expect(actResult.current.isUsingClinePass).toBe(false)

		mockExtensionState({
			apiConfiguration: { planModeApiProvider: "cline-pass", actModeApiProvider: "anthropic" },
			planActSeparateModelsSetting: true,
			mode: "plan",
		})
		const { result: planResult } = renderHook(() => useClinePassPromo())
		expect(planResult.current.isUsingClinePass).toBe(true)
	})

	it("switches provider mode-aware and navigates to API settings on success", async () => {
		const { result } = renderHook(() => useClinePassPromo())
		await result.current.switchToClinePassProvider()
		// handleModeFieldChange only touches the current mode when plan/act use
		// separate models, so the other mode's provider is never overwritten.
		expect(mockHandleModeFieldChange).toHaveBeenCalledWith(
			{ plan: "planModeApiProvider", act: "actModeApiProvider" },
			"cline-pass",
			"act",
		)
		expect(mockNavigateToSettings).toHaveBeenCalledWith("api-config")
	})

	it("passes the current plan mode to the provider update", async () => {
		mockExtensionState({ mode: "plan" })
		const { result } = renderHook(() => useClinePassPromo())
		await result.current.switchToClinePassProvider()
		expect(mockHandleModeFieldChange).toHaveBeenCalledWith(
			{ plan: "planModeApiProvider", act: "actModeApiProvider" },
			"cline-pass",
			"plan",
		)
	})

	it("does not navigate to settings when the provider update fails", async () => {
		mockHandleModeFieldChange.mockRejectedValueOnce(new Error("update failed"))
		const { result } = renderHook(() => useClinePassPromo())
		await result.current.switchToClinePassProvider()
		expect(mockNavigateToSettings).not.toHaveBeenCalled()
	})

	it("reports selection success and failure via the returned promise", async () => {
		const { result } = renderHook(() => useClinePassPromo())
		await expect(result.current.selectClinePassProvider()).resolves.toBe(true)
		mockHandleModeFieldChange.mockRejectedValueOnce(new Error("update failed"))
		await expect(result.current.selectClinePassProvider()).resolves.toBe(false)
	})
})
