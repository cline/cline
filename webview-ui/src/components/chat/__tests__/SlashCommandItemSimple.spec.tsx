import { render, screen, fireEvent } from "@/utils/test-utils"

import type { Command } from "@roo/ExtensionMessage"

import { SlashCommandItemSimple } from "../SlashCommandItemSimple"

describe("SlashCommandItemSimple", () => {
	const mockCommand: Command = {
		name: "test-command",
		description: "Test command description",
		source: "global",
		filePath: "/path/to/command.md",
	}

	const mockOnClick = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders command name with slash prefix", () => {
		render(<SlashCommandItemSimple command={mockCommand} onClick={mockOnClick} />)

		expect(screen.getByText("/test-command")).toBeInTheDocument()
	})

	it("renders command description when provided", () => {
		render(<SlashCommandItemSimple command={mockCommand} onClick={mockOnClick} />)

		expect(screen.getByText("Test command description")).toBeInTheDocument()
	})

	it("does not render description when not provided", () => {
		const commandWithoutDescription: Command = {
			...mockCommand,
			description: undefined,
		}

		render(<SlashCommandItemSimple command={commandWithoutDescription} onClick={mockOnClick} />)

		expect(screen.queryByText("Test command description")).not.toBeInTheDocument()
	})

	it("calls onClick handler when clicked", () => {
		render(<SlashCommandItemSimple command={mockCommand} onClick={mockOnClick} />)

		// The outer div is the clickable element
		const commandElement = screen.getByText("/test-command").closest("div.px-4")
		expect(commandElement).toBeInTheDocument()

		fireEvent.click(commandElement!)

		expect(mockOnClick).toHaveBeenCalledTimes(1)
		expect(mockOnClick).toHaveBeenCalledWith(mockCommand)
	})

	it("does not throw error when onClick is not provided", () => {
		render(<SlashCommandItemSimple command={mockCommand} />)

		const commandElement = screen.getByText("/test-command").closest("div.px-4")
		expect(commandElement).toBeInTheDocument()

		// Should not throw error
		expect(() => fireEvent.click(commandElement!)).not.toThrow()
	})

	it("applies hover styles", () => {
		render(<SlashCommandItemSimple command={mockCommand} onClick={mockOnClick} />)

		// The outer div has the hover styles
		const commandElement = screen.getByText("/test-command").closest("div.px-4")
		expect(commandElement).toHaveClass("hover:bg-vscode-list-hoverBackground")
	})

	it("applies cursor pointer style", () => {
		render(<SlashCommandItemSimple command={mockCommand} onClick={mockOnClick} />)

		const commandElement = screen.getByText("/test-command").closest("div.px-4")
		expect(commandElement).toHaveClass("cursor-pointer")
	})

	it("renders with correct layout classes", () => {
		render(<SlashCommandItemSimple command={mockCommand} onClick={mockOnClick} />)

		const commandElement = screen.getByText("/test-command").closest("div.px-4")
		expect(commandElement).toHaveClass("px-4", "py-2", "text-sm", "flex", "items-center")
	})

	it("renders command name with correct text color", () => {
		render(<SlashCommandItemSimple command={mockCommand} onClick={mockOnClick} />)

		const nameElement = screen.getByText("/test-command")
		expect(nameElement).toHaveClass("text-vscode-foreground")
	})

	it("renders description with correct text styling", () => {
		render(<SlashCommandItemSimple command={mockCommand} onClick={mockOnClick} />)

		const descriptionElement = screen.getByText("Test command description")
		expect(descriptionElement).toHaveClass("text-xs", "text-vscode-descriptionForeground", "truncate", "mt-0.5")
	})

	it("handles built-in commands correctly", () => {
		const builtInCommand: Command = {
			...mockCommand,
			source: "built-in",
		}

		render(<SlashCommandItemSimple command={builtInCommand} onClick={mockOnClick} />)

		expect(screen.getByText("/test-command")).toBeInTheDocument()
		expect(screen.getByText("Test command description")).toBeInTheDocument()

		// Should still be clickable
		const commandElement = screen.getByText("/test-command").closest("div.px-4")
		fireEvent.click(commandElement!)
		expect(mockOnClick).toHaveBeenCalledWith(builtInCommand)
	})

	it("handles project commands correctly", () => {
		const projectCommand: Command = {
			...mockCommand,
			source: "project",
		}

		render(<SlashCommandItemSimple command={projectCommand} onClick={mockOnClick} />)

		expect(screen.getByText("/test-command")).toBeInTheDocument()
		expect(screen.getByText("Test command description")).toBeInTheDocument()

		// Should still be clickable
		const commandElement = screen.getByText("/test-command").closest("div.px-4")
		fireEvent.click(commandElement!)
		expect(mockOnClick).toHaveBeenCalledWith(projectCommand)
	})

	it("truncates long command names", () => {
		const longNameCommand: Command = {
			...mockCommand,
			name: "this-is-a-very-long-command-name-that-should-be-truncated-in-the-ui",
		}

		render(<SlashCommandItemSimple command={longNameCommand} onClick={mockOnClick} />)

		const nameElement = screen.getByText("/this-is-a-very-long-command-name-that-should-be-truncated-in-the-ui")
		expect(nameElement).toHaveClass("truncate")
	})

	it("truncates long descriptions", () => {
		const longDescriptionCommand: Command = {
			...mockCommand,
			description:
				"This is a very long description that should be truncated in the UI to prevent overflow and maintain a clean layout",
		}

		render(<SlashCommandItemSimple command={longDescriptionCommand} onClick={mockOnClick} />)

		const descriptionElement = screen.getByText(
			"This is a very long description that should be truncated in the UI to prevent overflow and maintain a clean layout",
		)
		expect(descriptionElement).toHaveClass("truncate")
	})
})
