import type { HtmlPreviewItem } from "@shared/proto/cline/html_preview"
import { HtmlPreviewMode } from "@shared/proto/cline/html_preview"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { HtmlPreviewPanel } from "../HtmlPreviewPanel"

const setActiveItemIdMock = vi.fn()
const removeItemMock = vi.fn()

const mkItem = (id: string, title: string): HtmlPreviewItem => ({
	id,
	title,
	htmlContent: "",
	filePath: `/abs/${id}.html`,
	interactive: true,
	metadata: {},
	webviewUri: `https://example.vscode-cdn.net/file/abs/${id}.html?h=00000000`,
	dirUri: "https://example.vscode-cdn.net/file/abs",
	contentHash: "00000000deadbeef",
	resolvedMode: HtmlPreviewMode.INTERACTIVE,
})

// Mock the HTML preview context to avoid gRPC dependencies
vi.mock("../../../context/HtmlPreviewContext", () => ({
	useHtmlPreviewContext: () => ({
		items: [mkItem("html_1", "Preview 1"), mkItem("html_2", "Preview 2")],
		activeItemId: "html_1",
		setActiveItemId: setActiveItemIdMock,
		removeItem: removeItemMock,
		clearAllItems: vi.fn(),
		addItemFromContent: vi.fn(),
		loadWorkspaceFile: vi.fn(),
		manifestsById: {},
	}),
	HtmlPreviewContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// Mock the extension state context for workspaceHtmlFiles
vi.mock("../../../context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		workspaceHtmlFiles: [
			{ path: "public/index.html", name: "index.html" },
			{ path: "src/about.html", name: "about.html" },
		],
	}),
	ExtensionStateContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

describe("HtmlPreviewPanel", () => {
	it("renders sidebar with workspace files", () => {
		render(<HtmlPreviewPanel />)
		expect(screen.getByText("index.html")).toBeInTheDocument()
		expect(screen.getByText("about.html")).toBeInTheDocument()
	})

	it("renders tab bar when there are multiple items", () => {
		render(<HtmlPreviewPanel />)
		const tabs = screen.getAllByRole("tab")
		expect(tabs.length).toBe(2)
		expect(tabs[0]).toHaveTextContent("Preview 1")
		expect(tabs[1]).toHaveTextContent("Preview 2")
	})

	it("does not show legacy safe/interactive tab badges", () => {
		render(<HtmlPreviewPanel />)
		expect(screen.queryByText("S")).not.toBeInTheDocument()
		expect(screen.queryByText("JS")).not.toBeInTheDocument()
	})

	it("calls setActiveItemId when a tab is clicked", () => {
		render(<HtmlPreviewPanel />)
		const tabs = screen.getAllByRole("tab")
		fireEvent.click(tabs[1])
		expect(setActiveItemIdMock).toHaveBeenCalledWith("html_2")
	})

	it("calls removeItem when close button is clicked", () => {
		render(<HtmlPreviewPanel />)
		const closeButton = screen.getByLabelText("Close Preview 1")
		fireEvent.click(closeButton)
		expect(removeItemMock).toHaveBeenCalledWith("html_1")
	})

	it("renders active item in HtmlPreviewView", () => {
		render(<HtmlPreviewPanel />)
		const titles = screen.getAllByText("Preview 1")
		expect(titles.length).toBeGreaterThanOrEqual(1)
	})

	it("collapses and re-expands the file/modules side panel", () => {
		render(<HtmlPreviewPanel />)
		expect(screen.getByText("index.html")).toBeInTheDocument()
		fireEvent.click(screen.getByTitle("Close side panel"))
		expect(screen.queryByText("index.html")).not.toBeInTheDocument()
		fireEvent.click(screen.getByTitle("Open side panel"))
		expect(screen.getByText("index.html")).toBeInTheDocument()
	})
})
