import type { SubscriptionUsageSnapshot } from "@shared/ExtensionMessage"
import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useProviderUsageCostDisplay } from "@/hooks/useProviderUsageCostDisplay"
import { SubscriptionUsage } from "./SubscriptionUsage"

const state = vi.hoisted(() => ({ subscriptionUsage: undefined as SubscriptionUsageSnapshot | undefined }))
vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: () => state }))
vi.mock("@/hooks/useProviderUsageCostDisplay", () => ({ useProviderUsageCostDisplay: vi.fn() }))

function snapshot(): SubscriptionUsageSnapshot {
	return {
		providerId: "openai-codex",
		source: "codex-response-headers",
		capturedAt: Date.now() - 3 * 60_000,
		windows: [
			{ id: "primary", usedPercent: 24.6, windowMinutes: 300, resetsAt: Date.now() + 125 * 60_000 },
			{ id: "secondary", usedPercent: 61.3, windowMinutes: 10080 },
		],
	}
}

beforeEach(() => {
	vi.useFakeTimers()
	vi.setSystemTime(new Date("2040-02-03T12:00:00Z"))
	vi.mocked(useProviderUsageCostDisplay).mockReturnValue("subscription")
	state.subscriptionUsage = snapshot()
})
afterEach(() => {
	cleanup()
	vi.useRealTimers()
})

describe("SubscriptionUsage", () => {
	it.each(["show", "hide", "unknown"] as const)("hides for the %s provider policy", (policy) => {
		vi.mocked(useProviderUsageCostDisplay).mockReturnValue(policy)
		expect(render(<SubscriptionUsage providerId="openai-codex" />).container).toBeEmptyDOMElement()
	})

	it("hides absent data, empty windows, and snapshots from another provider", () => {
		state.subscriptionUsage = { ...snapshot(), providerId: "claude-code" }
		const { container, rerender } = render(<SubscriptionUsage providerId="claude-code" />)
		expect(container).toBeEmptyDOMElement()
		state.subscriptionUsage = snapshot()
		rerender(<SubscriptionUsage providerId="claude-code" />)
		expect(container).toBeEmptyDOMElement()
		state.subscriptionUsage = undefined
		rerender(<SubscriptionUsage providerId="openai-codex" />)
		expect(container).toBeEmptyDOMElement()
		state.subscriptionUsage = { ...snapshot(), windows: [] }
		rerender(<SubscriptionUsage providerId="openai-codex" />)
		expect(container).toBeEmptyDOMElement()
	})

	it("shows reported percentages, duration-derived labels, source tooltip and observation time accessibly", () => {
		render(<SubscriptionUsage providerId="openai-codex" />)
		expect(screen.getByRole("region", { name: "ChatGPT subscription usage" })).toHaveClass("ph-no-capture")
		expect(screen.getByRole("region")).toHaveAttribute(
			"title",
			expect.stringContaining("Codex response headers for the shared default pool"),
		)
		expect(screen.getByText("5-hour: 24.6% used")).toBeVisible()
		expect(screen.getByText("7-day: 61.3% used")).toBeVisible()
		expect(screen.getByText("Resets in 2h 5m")).toBeVisible()
		expect(screen.getByText("as of 3 min ago")).toBeVisible()
		const bar = screen.getByRole("progressbar", { name: "5-hour subscription usage" })
		expect(bar).toHaveAttribute("aria-valuenow", "24.6")
		expect(bar).toHaveAttribute("aria-valuemin", "0")
		expect(bar).toHaveAttribute("aria-valuemax", "100")
		expect(bar).toHaveAttribute("aria-valuetext", "24.6% used; Resets in 2h 5m")
	})

	it.each([
		[79.96, 80, "[&>div]:bg-editor-warning-foreground"],
		[99.96, 100, "[&>div]:bg-error"],
		[125.36, 125.4, "[&>div]:bg-error"],
		[Number.MAX_VALUE, Number.MAX_VALUE, "[&>div]:bg-error"],
	])("uses the same rounded percentage for text, threshold, fill and accessibility at %s", (usedPercent, percent, color) => {
		state.subscriptionUsage = { ...snapshot(), windows: [{ id: "primary", usedPercent }] }
		render(<SubscriptionUsage providerId="openai-codex" />)
		expect(screen.getByText(`Primary: ${percent}% used`)).toBeVisible()
		const bar = screen.getByRole("progressbar")
		expect(bar).toHaveClass(color)
		expect(bar).toHaveAttribute("aria-valuenow", `${Math.min(percent, 100)}`)
		expect(bar).toHaveAttribute("aria-valuetext", `${percent}% used; Reset time unknown`)
		expect(bar.firstElementChild).toHaveStyle({ transform: `translateX(-${100 - Math.min(percent, 100)}%)` })
	})

	it("shows reset durations of at least a day in days and hours", () => {
		state.subscriptionUsage = {
			...snapshot(),
			windows: [{ id: "primary", usedPercent: 4, resetsAt: Date.now() + (3 * 1440 + 4 * 60) * 60_000 }],
		}
		render(<SubscriptionUsage providerId="openai-codex" />)
		expect(screen.getByText("Resets in 3d 4h")).toBeVisible()
	})

	it("keeps unknown and elapsed resets explicit without resetting the reported usage", () => {
		state.subscriptionUsage = {
			...snapshot(),
			windows: [
				{ id: "primary", usedPercent: 52.3, resetsAt: Date.now() - 1 },
				{ id: "secondary", usedPercent: 11.9 },
			],
		}
		render(<SubscriptionUsage providerId="openai-codex" />)
		expect(screen.getByText("Reset passed; waiting for next response")).toBeVisible()
		expect(screen.getByText("Reset time unknown")).toBeVisible()
		expect(screen.getByText("Primary: 52.3% used")).toBeVisible()
		expect(screen.getByText("Secondary: 11.9% used")).toBeVisible()
	})

	it("marks observations stale after ten minutes and cleans up its local display timer", () => {
		state.subscriptionUsage = { ...snapshot(), capturedAt: Date.now() }
		const { unmount } = render(<SubscriptionUsage providerId="openai-codex" />)
		expect(screen.queryByText("Stale")).not.toBeInTheDocument()
		act(() => {
			vi.advanceTimersByTime(10 * 60_000)
		})
		expect(screen.getByText("Stale")).toBeVisible()
		expect(screen.getByText(/as of 10 min ago/)).toBeVisible()
		expect(screen.getAllByRole("progressbar")[0]).toHaveAttribute("aria-valuenow", "24.6")
		expect(screen.getAllByRole("progressbar")[0]).toHaveAttribute(
			"aria-valuetext",
			expect.stringContaining("stale observation"),
		)
		unmount()
		expect(vi.getTimerCount()).toBe(0)
	})
})
