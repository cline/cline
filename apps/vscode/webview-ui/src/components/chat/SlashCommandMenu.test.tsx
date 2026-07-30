import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import SlashCommandMenu from "./SlashCommandMenu"

vi.mock("@/utils/slash-commands", () => ({
	getMatchingSlashCommands: () => [
		{
			name: "newtask",
			description: "Create a new task",
			section: "default",
		},
	],
}))

const defaultProps = {
	onSelect: vi.fn(),
	setSelectedIndex: vi.fn(),
	onMouseDown: vi.fn(),
	query: "",
}

describe("SlashCommandMenu", () => {
	it("uses the focused row foreground for a selected command description", () => {
		const { rerender } = render(<SlashCommandMenu {...defaultProps} selectedIndex={0} />)
		const description = screen.getByText("Create a new task").parentElement

		expect(description).toHaveClass("text-(--vscode-quickInputList-focusForeground)")
		expect(description).not.toHaveClass("text-(--vscode-descriptionForeground)")

		rerender(<SlashCommandMenu {...defaultProps} selectedIndex={-1} />)

		expect(description).toHaveClass("text-(--vscode-descriptionForeground)")
		expect(description).not.toHaveClass("text-(--vscode-quickInputList-focusForeground)")
	})
})
