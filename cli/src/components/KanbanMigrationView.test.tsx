import { render } from "ink-testing-library"
import { createElement } from "react"
import { describe, expect, it, vi } from "vitest"
import { KanbanMigrationView } from "./KanbanMigrationView"

describe("KanbanMigrationView", () => {
	it("renders the migration options", () => {
		const onSelect = vi.fn()
		const { lastFrame } = render(createElement(KanbanMigrationView, { isRawModeSupported: true, onSelect }))

		expect(lastFrame()).toContain("Cline is moving out of the terminal. Introducing Cline Kanban.")
		expect(lastFrame()).toContain("Open the new experience")
		expect(lastFrame()).toContain("Launch Cline Kanban and start there by default.")
		expect(lastFrame()).toContain("cline --tui")
		expect(lastFrame()).toContain("Close and rerun with cline --tui if you want the old CLI.")
		expect(lastFrame()).toContain("Exit")
	})

	it("selects the highlighted option with Enter", () => {
		const onSelect = vi.fn()
		const { stdin } = render(createElement(KanbanMigrationView, { isRawModeSupported: true, onSelect }))

		stdin.write("\r")

		expect(onSelect).toHaveBeenCalledWith("kanban")
	})
})
