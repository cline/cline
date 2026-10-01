import { renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useProviderListings } from "./useProviderListings"
import { useProviderUsageCostDisplay } from "./useProviderUsageCostDisplay"

vi.mock("./useProviderListings", () => ({
	useProviderListings: vi.fn(),
}))

const mockUseProviderListings = vi.mocked(useProviderListings)

function withListings(providers: Array<{ id: string; usageCostDisplay: string }>) {
	mockUseProviderListings.mockReturnValue({
		providers,
		isLoading: false,
		error: undefined,
		refresh: vi.fn(),
	} as unknown as ReturnType<typeof useProviderListings>)
}

describe("useProviderUsageCostDisplay", () => {
	it("returns the subscription mark for subscription-billed providers", () => {
		withListings([{ id: "cline-pass", usageCostDisplay: "subscription" }])
		const { result } = renderHook(() => useProviderUsageCostDisplay("cline-pass"))
		expect(result.current).toBe("subscription")
	})

	it("returns hide for providers the SDK marks as hide", () => {
		withListings([{ id: "some-provider", usageCostDisplay: "hide" }])
		const { result } = renderHook(() => useProviderUsageCostDisplay("some-provider"))
		expect(result.current).toBe("hide")
	})

	it("shows cost for providers marked show and for unknown providers", () => {
		withListings([{ id: "openrouter", usageCostDisplay: "show" }])
		expect(renderHook(() => useProviderUsageCostDisplay("openrouter")).result.current).toBe("show")
		expect(renderHook(() => useProviderUsageCostDisplay("anthropic")).result.current).toBe("show")
		expect(renderHook(() => useProviderUsageCostDisplay(undefined)).result.current).toBe("show")
	})

	it("returns unknown while listings have not arrived", () => {
		withListings([])
		const { result } = renderHook(() => useProviderUsageCostDisplay("cline-pass"))
		expect(result.current).toBe("unknown")
	})
})
