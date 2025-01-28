import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import Announcement from "../Announcement"

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, passed: object | undefined) => {
			if (key === "newInVersion" && passed) {
				return `New in version ${passed.version}`
			}
			if (passed) return key + JSON.stringify(passed)
			return key
		},
	}),
	Trans: ({ i18nKey }: { i18nKey: string }) => <div>{i18nKey}</div>,
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	useTheme: () => ({ themeType: "light" }),
	VSCodeButton: (props: any) => <button {...props}>{props.children}</button>,
	VSCodeLink: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

describe("Announcement", () => {
	const hideAnnouncement = vi.fn()

	it("renders the announcement with the correct version", () => {
		render(<Announcement version="2.0.0" hideAnnouncement={hideAnnouncement} />)
		expect(screen.getByText(/New in version 2.0/)).toBeInTheDocument()
	})

	it("calls hideAnnouncement when close button is clicked", () => {
		render(<Announcement version="2.0.0" hideAnnouncement={hideAnnouncement} />)
		fireEvent.click(screen.getByRole("button"))
		expect(hideAnnouncement).toHaveBeenCalled()
	})

	it("renders the mcp server improvements announcement", () => {
		render(<Announcement version="2.0.0" hideAnnouncement={hideAnnouncement} />)
		expect(screen.getByText(/MCP server improvements:/)).toBeInTheDocument()
	})

	it("renders the 'See new changes' button feature", () => {
		render(<Announcement version="2.0.0" hideAnnouncement={hideAnnouncement} />)
		expect(screen.getByText(/See it in action here./)).toBeInTheDocument()
	})

	it("renders the demo link", () => {
		render(<Announcement version="2.0.0" hideAnnouncement={hideAnnouncement} />)
		expect(screen.getByText(/See a demo here./)).toBeInTheDocument()
	})
})
