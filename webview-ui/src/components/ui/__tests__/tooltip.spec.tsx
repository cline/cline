import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect } from "vitest"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../tooltip"
import { StandardTooltip } from "../standard-tooltip"

describe("Tooltip", () => {
	it("should render tooltip content on hover", async () => {
		const user = userEvent.setup()

		render(
			<TooltipProvider delayDuration={0}>
				<Tooltip>
					<TooltipTrigger>Hover me</TooltipTrigger>
					<TooltipContent>Tooltip text</TooltipContent>
				</Tooltip>
			</TooltipProvider>,
		)

		const trigger = screen.getByText("Hover me")
		await user.hover(trigger)

		await waitFor(
			() => {
				const tooltips = screen.getAllByText("Tooltip text")
				expect(tooltips.length).toBeGreaterThan(0)
			},
			{ timeout: 1000 },
		)
	})

	it("should apply text wrapping classes", async () => {
		const user = userEvent.setup()

		render(
			<TooltipProvider delayDuration={0}>
				<Tooltip>
					<TooltipTrigger>Hover me</TooltipTrigger>
					<TooltipContent>
						This is a very long tooltip text that should wrap when it reaches the maximum width
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>,
		)

		const trigger = screen.getByText("Hover me")
		await user.hover(trigger)

		await waitFor(
			() => {
				const tooltips = screen.getAllByText(/This is a very long tooltip text/)
				const visibleTooltip = tooltips.find((el) => el.getAttribute("role") !== "tooltip")
				expect(visibleTooltip).toHaveClass("max-w-[300px]", "break-words")
			},
			{ timeout: 1000 },
		)
	})

	it("should not have overflow-hidden class", async () => {
		const user = userEvent.setup()

		render(
			<TooltipProvider delayDuration={0}>
				<Tooltip>
					<TooltipTrigger>Hover me</TooltipTrigger>
					<TooltipContent>Tooltip text</TooltipContent>
				</Tooltip>
			</TooltipProvider>,
		)

		const trigger = screen.getByText("Hover me")
		await user.hover(trigger)

		await waitFor(
			() => {
				const tooltips = screen.getAllByText("Tooltip text")
				const visibleTooltip = tooltips.find((el) => el.getAttribute("role") !== "tooltip")
				expect(visibleTooltip).not.toHaveClass("overflow-hidden")
			},
			{ timeout: 1000 },
		)
	})
})

describe("StandardTooltip", () => {
	it("should render with default delay", async () => {
		const user = userEvent.setup()

		render(
			<TooltipProvider delayDuration={300}>
				<StandardTooltip content="Tooltip text">
					<button>Hover me</button>
				</StandardTooltip>
			</TooltipProvider>,
		)

		const trigger = screen.getByText("Hover me")
		await user.hover(trigger)

		await waitFor(
			() => {
				const tooltips = screen.getAllByText("Tooltip text")
				expect(tooltips.length).toBeGreaterThan(0)
			},
			{ timeout: 1000 },
		)
	})

	it("should apply custom maxWidth", async () => {
		const user = userEvent.setup()

		render(
			<TooltipProvider delayDuration={0}>
				<StandardTooltip content="Long tooltip text" maxWidth={200}>
					<button>Hover me</button>
				</StandardTooltip>
			</TooltipProvider>,
		)

		const trigger = screen.getByText("Hover me")
		await user.hover(trigger)

		await waitFor(
			() => {
				const tooltips = screen.getAllByText("Long tooltip text")
				const visibleTooltip = tooltips.find((el) => el.getAttribute("role") !== "tooltip")
				expect(visibleTooltip).toHaveStyle({ maxWidth: "200px" })
			},
			{ timeout: 1000 },
		)
	})

	it("should apply custom maxWidth as string", async () => {
		const user = userEvent.setup()

		render(
			<TooltipProvider delayDuration={0}>
				<StandardTooltip content="Long tooltip text" maxWidth="15rem">
					<button>Hover me</button>
				</StandardTooltip>
			</TooltipProvider>,
		)

		const trigger = screen.getByText("Hover me")
		await user.hover(trigger)

		await waitFor(
			() => {
				const tooltips = screen.getAllByText("Long tooltip text")
				const visibleTooltip = tooltips.find((el) => el.getAttribute("role") !== "tooltip")
				expect(visibleTooltip).toHaveStyle({ maxWidth: "15rem" })
			},
			{ timeout: 1000 },
		)
	})

	it("should handle long content with text wrapping", async () => {
		const user = userEvent.setup()
		const longContent =
			"This is a very long tooltip content that should definitely wrap when displayed because it exceeds the maximum width constraint"

		render(
			<TooltipProvider delayDuration={0}>
				<StandardTooltip content={longContent}>
					<button>Hover me</button>
				</StandardTooltip>
			</TooltipProvider>,
		)

		const trigger = screen.getByText("Hover me")
		await user.hover(trigger)

		await waitFor(
			() => {
				const tooltips = screen.getAllByText(longContent)
				const visibleTooltip = tooltips.find((el) => el.getAttribute("role") !== "tooltip")
				expect(visibleTooltip).toHaveClass("max-w-[300px]", "break-words")
			},
			{ timeout: 1000 },
		)
	})
})
