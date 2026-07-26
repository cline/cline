import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useApiConfigurationHandlers } from "@/components/settings/utils/useApiConfigurationHandlers"
import { useClineAuth } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useHasFeatureFlag } from "@/hooks/useFeatureFlag"
import { useClinePassPromo } from "../useClinePassPromo"

vi.mock("@/hooks/useFeatureFlag", () => ({
	useHasFeatureFlag: vi.fn(),
}))

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
const mockHandleFieldsChange = vi.fn(() => Promise.resolve())

const mockExtensionState = (overrides: Record<string, unknown> = {}) => {
	vi.mocked(useExtensionState).mockReturnValue({
		apiConfiguration: { planModeApiProvider: "anthropic", actModeApiProvider: "anthropic" },
		navigateToSettings: mockNavigateToSettings,
		remoteConfigSettings: undefined,
		...overrides,
	} as any)
}

describe("useClinePassPromo", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(useHasFeatureFlag).mockReturnValue(true)
		vi.mocked(useClineAuth).mockReturnValue({ clineUser: null } as any)
		vi.mocked(useApiConfigurationHandlers).mockReturnValue({
			handleFieldsChange: mockHandleFieldsChange,
		} as any)
		mockExtensionState()
	})

	it("is enabled when the feature flag is on and no remote config restricts providers", () => {
		const { result } = renderHook(() => useClinePassPromo())
		expect(result.current.isClinePassEnabled).toBe(true)
	})

	it("is disabled when the feature flag is off", () => {
		vi.mocked(useHasFeatureFlag).mockReturnValue(false)
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

	it("switches provider for both modes and navigates to API settings on success", async () => {
		const { result } = renderHook(() => useClinePassPromo())
		await result.current.switchToClinePassProvider()
		expect(mockHandleFieldsChange).toHaveBeenCalledWith({
			planModeApiProvider: "cline-pass",
			actModeApiProvider: "cline-pass",
		})
		expect(mockNavigateToSettings).toHaveBeenCalledWith("api-config")
	})

	it("does not navigate to settings when the provider update fails", async () => {
		mockHandleFieldsChange.mockRejectedValueOnce(new Error("update failed"))
		const { result } = renderHook(() => useClinePassPromo())
		await result.current.switchToClinePassProvider()
		expect(mockNavigateToSettings).not.toHaveBeenCalled()
	})

	it("reports selection success and failure via the returned promise", async () => {
		const { result } = renderHook(() => useClinePassPromo())
		await expect(result.current.selectClinePassProvider()).resolves.toBe(true)
		mockHandleFieldsChange.mockRejectedValueOnce(new Error("update failed"))
		await expect(result.current.selectClinePassProvider()).resolves.toBe(false)
	})
})
