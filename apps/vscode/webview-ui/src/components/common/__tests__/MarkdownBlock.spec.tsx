import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import MarkdownBlock from "../MarkdownBlock"

const grpcMocks = vi.hoisted(() => ({
	openFile: vi.fn(() => Promise.resolve({})),
	openFileRelativePath: vi.fn(() => Promise.resolve({})),
	ifFileExistsRelativePath: vi.fn(() => Promise.resolve({ value: false })),
}))

vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: grpcMocks,
	StateServiceClient: {},
}))

function renderLink(markdown: string, name: string) {
	render(<MarkdownBlock markdown={markdown} />)
	return screen.getByRole("link", { name })
}

describe("MarkdownBlock links to local files", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("opens an absolute path in the editor instead of navigating", () => {
		const link = renderLink("[Open index.html](/Users/jay/project/index.html)", "Open index.html")
		expect(link.getAttribute("href")).toBe("/Users/jay/project/index.html")

		const navigates = fireEvent.click(link)

		expect(navigates).toBe(false)
		expect(grpcMocks.openFile).toHaveBeenCalledWith({ value: "/Users/jay/project/index.html" })
		expect(grpcMocks.openFileRelativePath).not.toHaveBeenCalled()
	})

	it("keeps Windows paths and file URLs, which react-markdown would blank, and passes the path on as written", () => {
		// The markdown parser percent-encodes the backslashes; the link still opens the path the model wrote.
		const windowsLink = renderLink("[Windows](C:\\Users\\jay\\project\\index.html)", "Windows")
		expect(windowsLink.getAttribute("href")).not.toBe("")
		fireEvent.click(windowsLink)
		expect(grpcMocks.openFile).toHaveBeenLastCalledWith({ value: "C:\\Users\\jay\\project\\index.html" })

		const fileUrlLink = renderLink("[File URL](file:///Users/jay/project/index.html)", "File URL")
		expect(fileUrlLink.getAttribute("href")).toBe("file:///Users/jay/project/index.html")
		fireEvent.click(fileUrlLink)
		expect(grpcMocks.openFile).toHaveBeenLastCalledWith({ value: "file:///Users/jay/project/index.html" })
	})

	it("opens a path with spaces as written", () => {
		const link = renderLink("[Spaced](</Users/jay/my project/index.html>)", "Spaced")

		fireEvent.click(link)

		expect(grpcMocks.openFile).toHaveBeenCalledWith({ value: "/Users/jay/my project/index.html" })
	})

	it("opens a relative path relative to the workspace", () => {
		const link = renderLink("[Nested](html_demos/index.html)", "Nested")

		fireEvent.click(link)

		expect(grpcMocks.openFileRelativePath).toHaveBeenCalledWith({ value: "html_demos/index.html" })
		expect(grpcMocks.openFile).not.toHaveBeenCalled()
	})

	it("leaves web links to the host", () => {
		const link = renderLink("[Docs](https://example.com/docs)", "Docs")
		expect(link.getAttribute("href")).toBe("https://example.com/docs")
		const protocolRelative = renderLink("[CDN](//example.com/docs)", "CDN")
		expect(protocolRelative.getAttribute("href")).toBe("//example.com/docs")

		expect(fireEvent.click(link)).toBe(true)
		expect(fireEvent.click(protocolRelative)).toBe(true)
		expect(grpcMocks.openFile).not.toHaveBeenCalled()
		expect(grpcMocks.openFileRelativePath).not.toHaveBeenCalled()
	})

	it("opens a section link's file without the fragment", () => {
		const link = renderLink("[Setup](docs/setup.md#install)", "Setup")

		fireEvent.click(link)

		expect(grpcMocks.openFileRelativePath).toHaveBeenCalledWith({ value: "docs/setup.md" })
	})

	it("keeps backslash paths as written although markdown reads a backslash as an escape", () => {
		// `\.` and `\_` would be unescaped to `.` and `_`, and `\\` halved.
		fireEvent.click(renderLink("[Dot](C:\\Users\\jay\\.cline\\_build\\x.md)", "Dot"))
		expect(grpcMocks.openFile).toHaveBeenLastCalledWith({ value: "C:\\Users\\jay\\.cline\\_build\\x.md" })

		fireEvent.click(renderLink("[UNC](\\\\server\\share$\\project\\index.html)", "UNC"))
		expect(grpcMocks.openFile).toHaveBeenLastCalledWith({ value: "\\\\server\\share$\\project\\index.html" })

		fireEvent.click(renderLink('[Angle](<C:\\Program Files (x86)\\jay\\.cline\\my file.md> "title")', "Angle"))
		expect(grpcMocks.openFile).toHaveBeenLastCalledWith({ value: "C:\\Program Files (x86)\\jay\\.cline\\my file.md" })

		fireEvent.click(renderLink("[Rel](html_demos\\_private\\index.html)", "Rel"))
		expect(grpcMocks.openFileRelativePath).toHaveBeenLastCalledWith({ value: "html_demos\\_private\\index.html" })
	})

	it("still honours markdown escapes in a path without backslash separators", () => {
		fireEvent.click(renderLink("[Draft](docs/my\\(draft\\).md)", "Draft"))
		expect(grpcMocks.openFileRelativePath).toHaveBeenLastCalledWith({ value: "docs/my(draft).md" })

		fireEvent.click(renderLink("[Posix](/Users/jay/notes/my\\(draft\\).md)", "Posix"))
		expect(grpcMocks.openFile).toHaveBeenLastCalledWith({ value: "/Users/jay/notes/my(draft).md" })
	})
})
