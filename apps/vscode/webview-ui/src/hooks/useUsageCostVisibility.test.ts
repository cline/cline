import { renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useProviderListings } from "./useProviderListings"
import { useUsageCostVisibility } from "./useUsageCostVisibility"

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

function renderPredicate() {
	return renderHook(() => useUsageCostVisibility()).result.current
}

describe("useUsageCostVisibility", () => {
	it("hides cost for rows whose provider is subscription-billed or marked hide", () => {
		withListings([
			{ id: "cline-pass", usageCostDisplay: "subscription" },
			{ id: "some-provider", usageCostDisplay: "hide" },
		])
		const isCostVisible = renderPredicate()
		expect(isCostVisible("cline-pass")).toBe(false)
		expect(isCostVisible("some-provider")).toBe(false)
	})

	it("shows cost for providers marked show and for providers absent from the listings", () => {
		withListings([{ id: "openrouter", usageCostDisplay: "show" }])
		const isCostVisible = renderPredicate()
		expect(isCostVisible("openrouter")).toBe(true)
		expect(isCostVisible("anthropic")).toBe(true)
	})

	it("shows cost for rows that recorded no provider", () => {
		withListings([{ id: "cline-pass", usageCostDisplay: "subscription" }])
		const isCostVisible = renderPredicate()
		expect(isCostVisible(undefined)).toBe(true)
		expect(isCostVisible("")).toBe(true)
	})

	it("hides cost while listings have not arrived", () => {
		withListings([])
		const isCostVisible = renderPredicate()
		expect(isCostVisible("cline-pass")).toBe(false)
		expect(isCostVisible("anthropic")).toBe(false)
	})
})
