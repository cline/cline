import { fireEvent, render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import React from "react"
import { describe, expect, it, vi } from "vitest"
import Announcement from "../Announcement"

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	useTheme: () => ({ themeType: "light" }),
	VSCodeButton: (props: ComponentProps<"button">) => <button {...props}>{props.children}</button>,
	VSCodeLink: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

describe("Announcement", () => {
	const hideAnnouncement = vi.fn()

	it("renders the announcement with the correct version", () => {
		render(<Announcement hideAnnouncement={hideAnnouncement} version="2.0.0" />)
		expect(screen.getByText(/New in v2.0/)).toBeInTheDocument()
	})

	it("calls hideAnnouncement when close button is clicked", () => {
		render(<Announcement hideAnnouncement={hideAnnouncement} version="2.0.0" />)
		fireEvent.click(screen.getByTestId("close-button"))
		expect(hideAnnouncement).toHaveBeenCalled()
	})
})
