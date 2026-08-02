import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

const mockOpenFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOpenUrl = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: { openFile: mockOpenFile },
	UiServiceClient: { openUrl: mockOpenUrl },
}))

vi.mock("../common/CodeAccordian", () => ({
	default: ({ code, path, isExpanded, isLoading }: any) => (
		<div data-testid="code-accordian">
			<span data-testid="ca-path">{path}</span>
			<span data-testid="ca-code">{code}</span>
			<span data-testid="ca-expanded">{String(isExpanded)}</span>
			<span data-testid="ca-loading">{String(isLoading)}</span>
		</div>
	),
	cleanPathPrefix: (p: string) => p.replace(/^[^a-zA-Z0-9]+/, ""),
}))

vi.mock("./DiffEditRow", () => ({
	DiffEditRow: ({ path, isLoading }: any) => (
		<div data-testid="diff-edit-row">
			<span data-testid="de-loading">{String(isLoading)}</span>
		</div>
	),
}))

vi.mock("./SearchResultsDisplay", () => ({
	default: ({ content }: any) => <div data-testid="search-results">{content}</div>,
}))

import type { ClineMessage, ClineSayTool } from "@shared/ExtensionMessage"
import ToolUseRow from "./ToolUseRow"

function buildTool(tool: ClineSayTool["tool"], overrides: Partial<ClineSayTool> = {}): ClineSayTool {
	return { tool, ...overrides }
}
function buildMsg(overrides: Partial<ClineMessage> = {}): ClineMessage {
	return { ts: 1, type: "say", say: "tool", ...overrides }
}
const defProps = {
	tool: buildTool("readFile", { path: "/w/file.ts", content: "c" }),
	message: buildMsg(),
	isExpanded: false,
	onToggleExpand: vi.fn(),
	backgroundEditEnabled: false,
}
function r(overrides: Partial<Parameters<typeof ToolUseRow>[0]> = {}) {
	return render(<ToolUseRow {...defProps} {...overrides} />)
}

describe("ToolUseRow", () => {
	beforeEach(() => vi.clearAllMocks())
	describe("editedExistingFile", () => {
		it("renders header", () => {
			r({ tool: buildTool("editedExistingFile", { path: "file.ts" }) })
			expect(screen.getByText(/Cline wants to edit this file/)).toBeInTheDocument()
		})
		it("renders DiffEditRow with bg editing", () => {
			r({ tool: buildTool("editedExistingFile", { path: "f.ts", diff: "d", content: "c" }), backgroundEditEnabled: true })
			expect(screen.getByTestId("diff-edit-row")).toBeInTheDocument()
		})
		it("renders CodeAccordian without bg editing", () => {
			r({ tool: buildTool("editedExistingFile", { path: "f.ts", content: "c" }), backgroundEditEnabled: false })
			expect(screen.getByTestId("code-accordian")).toBeInTheDocument()
		})
		it("shows patching title for %%bash", () => {
			r({ tool: buildTool("editedExistingFile", { path: "f.ts", content: "%%bash\ncmd\n***\nEOF" }) })
			expect(screen.getByText(/Cline is creating patches/)).toBeInTheDocument()
		})
	})

	describe("fileDeleted", () => {
		it("renders header and code accordian", () => {
			r({ tool: buildTool("fileDeleted", { path: "rm.ts", content: "o" }) })
			expect(screen.getByText(/Cline wants to delete this file/)).toBeInTheDocument()
			expect(screen.getByTestId("code-accordian")).toBeInTheDocument()
		})
	})

	describe("newFileCreated", () => {
		it("renders header", () => {
			r({ tool: buildTool("newFileCreated", { path: "n.ts", content: "n" }) })
			expect(screen.getByText(/Cline wants to create a new file/)).toBeInTheDocument()
		})
		it("renders DiffEditRow with bg editing", () => {
			r({ tool: buildTool("newFileCreated", { path: "n.ts", content: "n" }), backgroundEditEnabled: true })
			expect(screen.getByTestId("diff-edit-row")).toBeInTheDocument()
		})
		it("renders CodeAccordian without bg editing", () => {
			r({ tool: buildTool("newFileCreated", { path: "n.ts", content: "n" }), backgroundEditEnabled: false })
			expect(screen.getByTestId("code-accordian")).toBeInTheDocument()
		})
	})
	describe("readFile", () => {
		it("renders header and path", () => {
			r({ tool: buildTool("readFile", { path: "app.ts", content: "c" }) })
			expect(screen.getByText(/Cline wants to read this file/)).toBeInTheDocument()
		})
		it("renders svg for image files", () => {
			const { container } = r({ tool: buildTool("readFile", { path: "photo.png", content: "b" }) })
			expect(container.querySelector("svg")).toBeInTheDocument()
		})
		it("shows line range", () => {
			r({ tool: buildTool("readFile", { path: "f.ts", content: "c", readLineStart: 10, readLineEnd: 20 }) })
			expect(screen.getByText(/-20/)).toBeInTheDocument()
		})
		it("shows open-ended read", () => {
			r({ tool: buildTool("readFile", { path: "f.ts", content: "c", readLineStart: 10 }) })
			expect(screen.getByText(/10+/)).toBeInTheDocument()
		})
	})

	describe("listFiles", () => {
		it("renders listFilesTopLevel", () => {
			r({ tool: buildTool("listFilesTopLevel", { path: "s/", content: "a" }) })
			expect(screen.getByText(/top level/)).toBeInTheDocument()
			expect(screen.getByTestId("code-accordian")).toBeInTheDocument()
		})
		it("renders listFilesRecursive", () => {
			r({ tool: buildTool("listFilesRecursive", { path: "s/", content: "a" }) })
			expect(screen.getByText(/recursively/)).toBeInTheDocument()
		})
		it("renders listCodeDefinitionNames", () => {
			r({ tool: buildTool("listCodeDefinitionNames", { path: "s/", content: "fn" }) })
			expect(screen.getByText(/source code definition names/)).toBeInTheDocument()
		})
	})
	describe("searchFiles", () => {
		it("renders search results display", async () => {
			r({ tool: buildTool("searchFiles", { path: ".", regex: "x", content: "a" }) })
			// SearchResultsDisplay is lazy-loaded (V12 方案5) — resolve async.
			expect(await screen.findByTestId("search-results")).toBeInTheDocument()
			expect(screen.getByText(/x/)).toBeInTheDocument()
		})
	})

	describe("summarizeTask", () => {
		it("renders header", () => {
			r({ tool: buildTool("summarizeTask", { content: "s" }) })
			expect(screen.getByText(/Cline is condensing the conversation/)).toBeInTheDocument()
		})
		it("toggles expand on click", () => {
			const onT = vi.fn()
			r({ tool: buildTool("summarizeTask", { content: "s" }), isExpanded: false, onToggleExpand: onT })
			fireEvent.click(screen.getByLabelText("Expand summary"))
			expect(onT).toHaveBeenCalledTimes(1)
		})
		it("shows expanded content", () => {
			r({ tool: buildTool("summarizeTask", { content: "expanded!" }), isExpanded: true })
			expect(screen.getByText("expanded!")).toBeInTheDocument()
		})
	})

	describe("webFetch", () => {
		it("renders URL in ask mode", () => {
			r({ tool: buildTool("webFetch", { path: "https://ex.com" }), message: buildMsg({ type: "ask" }) })
			expect(screen.getByText(/Cline wants to fetch content/)).toBeInTheDocument()
		})
		it("renders URL in say mode", () => {
			r({ tool: buildTool("webFetch", { path: "https://ex.com" }), message: buildMsg({ type: "say" }) })
			expect(screen.getByText(/Cline fetched content from this URL/)).toBeInTheDocument()
		})
		it("triggers openUrl on click", () => {
			r({ tool: buildTool("webFetch", { path: "https://ex.com" }) })
			fireEvent.click(screen.getByText(/ex\.com/))
			expect(mockOpenUrl).toHaveBeenCalled()
		})
	})
	describe("webSearch", () => {
		it("renders query in say mode", () => {
			r({ tool: buildTool("webSearch", { path: "search term" }) })
			expect(screen.getByText(/Cline searched the web for/)).toBeInTheDocument()
			expect(screen.getByText(/search term/)).toBeInTheDocument()
		})
	})

	describe("useSkill", () => {
		it("renders skill name", () => {
			r({ tool: buildTool("useSkill", { path: "my-skill" }) })
			expect(screen.getByText(/Cline loaded the skill/)).toBeInTheDocument()
			expect(screen.getByText("my-skill")).toBeInTheDocument()
		})
	})

	describe("edge cases", () => {
		it("default case renders invisible spacer", () => {
			const { container } = r({
				tool: buildTool("readFile" as any, { path: "x" }),
				message: buildMsg({ say: "error" as any }),
			})
			expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument()
		})
		it("passes isLoading when message.partial is true", () => {
			r({ tool: buildTool("newFileCreated", { path: "l.ts", content: "." }), message: buildMsg({ partial: true }) })
			expect(screen.getByTestId("ca-loading")).toHaveTextContent("true")
		})
		it("shows external file indicator", () => {
			r({ tool: buildTool("editedExistingFile", { path: "/o/f.ts", operationIsLocatedInWorkspace: false }) })
			expect(screen.getByTitle("This file is outside of your workspace")).toBeInTheDocument()
		})
		it("shows external URL indicator", () => {
			r({ tool: buildTool("webFetch", { path: "https://ex.com", operationIsLocatedInWorkspace: false }) })
			expect(screen.getByTitle("This URL is external")).toBeInTheDocument()
		})
		it("shows external search indicator", () => {
			r({ tool: buildTool("webSearch", { path: "q", operationIsLocatedInWorkspace: false }) })
			expect(screen.getByTitle("This search is external")).toBeInTheDocument()
		})
	})
})
