import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import ContextMenu from "../ContextMenu"
import { ContextMenuOptionType, ContextMenuQueryItem } from "../../../utils/context-mentions"

describe("ContextMenu", () => {
	const onSelect = vi.fn()
	const onMouseDown = vi.fn()
	const setSelectedIndex = vi.fn()

	const defaultProps = {
		onSelect,
		searchQuery: "",
		onMouseDown,
		selectedIndex: 0,
		setSelectedIndex,
		selectedType: null,
		queryItems: [],
	}

	it("renders Editor Selection option correctly", () => {
		const queryItems: ContextMenuQueryItem[] = [{ type: ContextMenuOptionType.EditorSelection, value: "editorSelection" }]
		render(<ContextMenu {...defaultProps} queryItems={queryItems} />)

		expect(screen.getByText("Editor Selection")).toBeInTheDocument()
	})

	it("calls onSelect when Editor Selection is clicked", () => {
		const queryItems: ContextMenuQueryItem[] = [{ type: ContextMenuOptionType.EditorSelection, value: "editorSelection" }]
		render(<ContextMenu {...defaultProps} queryItems={queryItems} />)

		fireEvent.click(screen.getByText("Editor Selection"))
		expect(onSelect).toHaveBeenCalledWith(ContextMenuOptionType.EditorSelection, "editorSelection")
	})
})
