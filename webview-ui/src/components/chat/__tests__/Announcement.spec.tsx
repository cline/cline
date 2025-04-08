import React from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import Announcement from "../Announcement"

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	useTheme: () => ({ themeType: "light" }),
	VSCodeButton: (props: any) => <button {...props}>{props.children}</button>,
	VSCodeLink: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

describe("Announcement", () => {
	const hideAnnouncement = vi.fn()

	it("renders the announcement with the correct version", () => {
		render(<Announcement version="2.0.0" hideAnnouncement={hideAnnouncement} />)
		expect(screen.getByText(/New in v2.0/)).toBeInTheDocument()
	})

	it("calls hideAnnouncement when close button is clicked", () => {
		render(<Announcement version="2.0.0" hideAnnouncement={hideAnnouncement} />)
		fireEvent.click(screen.getByRole("button"))
		expect(hideAnnouncement).toHaveBeenCalled()
	})

	it("renders the enhanced MCP support announcement", () => {
		render(<Announcement version="2.0.0" hideAnnouncement={hideAnnouncement} />)
		// Updated text based on actual component output
		expect(screen.getByText(/Enhanced MCP Support:/)).toBeInTheDocument()
	})
})
