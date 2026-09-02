import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import BannerCarousel, { BannerData } from "../BannerCarousel"

const makeBanner = (id: string, title: string): BannerData => ({
	id,
	title,
	description: `${title} description`,
})

describe("BannerCarousel", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("renders nothing without banners", () => {
		const { container } = render(<BannerCarousel banners={[]} />)
		expect(container).toBeEmptyDOMElement()
	})

	it("keeps showing the same banner when an earlier banner is removed", () => {
		const bannerA = makeBanner("banner-a", "Banner A")
		const bannerB = makeBanner("banner-b", "Banner B")
		const bannerC = makeBanner("banner-c", "Banner C")

		const { rerender } = render(<BannerCarousel banners={[bannerA, bannerB, bannerC]} />)
		expect(screen.getByText("1 / 3")).toBeInTheDocument()

		// Navigate to Banner B (index 1); advance past the transition timeout
		fireEvent.click(screen.getByLabelText("Next banner"))
		act(() => {
			vi.advanceTimersByTime(300)
		})
		expect(screen.getByText("2 / 3")).toBeInTheDocument()

		// Remove Banner A from the front; the carousel should remap to keep
		// Banner B active (index 0 of the new array) instead of jumping to C.
		rerender(<BannerCarousel banners={[bannerB, bannerC]} />)
		expect(screen.getByText("1 / 2")).toBeInTheDocument()
	})

	it("clamps the index when the active banner is removed from the end", () => {
		const bannerA = makeBanner("banner-a", "Banner A")
		const bannerB = makeBanner("banner-b", "Banner B")

		const { rerender } = render(<BannerCarousel banners={[bannerA, bannerB]} />)
		fireEvent.click(screen.getByLabelText("Next banner"))
		act(() => {
			vi.advanceTimersByTime(300)
		})
		expect(screen.getByText("2 / 2")).toBeInTheDocument()

		rerender(<BannerCarousel banners={[bannerA]} />)
		// Single banner left: the footer indicator is hidden, content still renders
		expect(screen.getByText("Banner A")).toBeInTheDocument()
	})
})
