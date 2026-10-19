import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"

describe("Popover", () => {
	beforeEach(() => {
		vi.stubGlobal(
			"ResizeObserver",
			class ResizeObserver {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		)
	})

	it("uses the matched VS Code menu background and foreground theme tokens", () => {
		render(
			<Popover defaultOpen>
				<PopoverTrigger>Open</PopoverTrigger>
				<PopoverContent>Popover content</PopoverContent>
			</Popover>,
		)

		expect(screen.getByText("Popover content")).toHaveClass("bg-menu", "text-menu-foreground")
		expect(screen.getByText("Popover content")).not.toHaveClass("text-popover-foreground")
	})
})
