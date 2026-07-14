import { StringRequest } from "@shared/proto/cline/common"
import { type HtmlPreviewItem, HtmlPreviewMode } from "@shared/proto/cline/html_preview"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import HtmlPreviewView from "../HtmlPreviewView"

const copyToClipboardMock = vi.fn().mockResolvedValue({})
const openUrlMock = vi.fn().mockResolvedValue({})
const openFileMock = vi.fn().mockResolvedValue({})
const runArtifactCodeMock = vi.fn().mockResolvedValue({
	stdout: "42\n",
	stderr: "",
	status: "ok",
	error: "",
	resultRepr: "",
})
const getArtifactKernelInfoMock = vi.fn().mockResolvedValue({
	artifactId: "html_test",
	interpreterPath: "/usr/bin/python3",
	state: 3,
	cwd: "/tmp",
	lastError: "",
	workspaceTrusted: true,
	kernelDirty: false,
	executionCount: 0,
})
const restartArtifactKernelMock = vi.fn().mockResolvedValue({})
const interruptArtifactKernelMock = vi.fn().mockResolvedValue({ recovered: true, error: "" })
const listPythonEnvironmentsMock = vi.fn().mockResolvedValue({
	environments: [{ profileId: "profile_1", interpreterPath: "/usr/bin/python3", label: "PATH: python3", cwd: "/tmp" }],
	activeProfileId: "profile_1",
})
const setArtifactKernelProfileMock = vi.fn().mockResolvedValue({})
const probePythonEnvironmentMock = vi.fn().mockResolvedValue({ stdout: '{"ok":true}', status: "ok", stderr: "", error: "" })

vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: {
		copyToClipboard: (...args: unknown[]) => copyToClipboardMock(...args),
		openFile: (...args: unknown[]) => openFileMock(...args),
	},
	UiServiceClient: {
		openUrl: (...args: unknown[]) => openUrlMock(...args),
	},
	HtmlPreviewServiceClient: {
		runArtifactCode: (...args: unknown[]) => runArtifactCodeMock(...args),
		getArtifactKernelInfo: (...args: unknown[]) => getArtifactKernelInfoMock(...args),
		restartArtifactKernel: (...args: unknown[]) => restartArtifactKernelMock(...args),
		listPythonEnvironments: (...args: unknown[]) => listPythonEnvironmentsMock(...args),
		setArtifactKernelProfile: (...args: unknown[]) => setArtifactKernelProfileMock(...args),
		probePythonEnvironment: (...args: unknown[]) => probePythonEnvironmentMock(...args),
		interruptArtifactKernel: (...args: unknown[]) => interruptArtifactKernelMock(...args),
	},
}))

const baseItem: HtmlPreviewItem = {
	id: "html_test",
	title: "Test Preview",
	htmlContent: "",
	filePath: "/abs/path/to/test.html",
	interactive: false,
	metadata: { source: "file" },
	webviewUri: "https://example.vscode-cdn.net/file/abs/path/to/test.html?h=abc12345",
	dirUri: "https://example.vscode-cdn.net/file/abs/path/to",
	contentHash: "abc12345deadbeef",
	resolvedMode: HtmlPreviewMode.INTERACTIVE,
}

const inlineItem: HtmlPreviewItem = {
	...baseItem,
	id: "html_test_inline",
	htmlContent: "<!doctype html><html><body><h1>hello</h1></body></html>",
}

// Low-frequency toolbar actions (diagnostics, copy path, open in editor/browser,
// reload, restart kernel, remove) live behind the "More actions" kebab menu
// (see HtmlPreviewToolbar.tsx's kebabItems) rather than as directly-titled
// buttons. Items render as visible text, not a `title` attribute.
function openKebabMenu() {
	fireEvent.click(screen.getByTitle("More actions"))
}

describe("HtmlPreviewView", () => {
	it("renders empty state when no item is provided", () => {
		render(<HtmlPreviewView />)
		expect(screen.getByText("No HTML preview active")).toBeInTheDocument()
	})

	it("falls back to src=item.webviewUri when htmlContent is empty", () => {
		render(<HtmlPreviewView item={baseItem} />)
		const iframe = screen.getByTitle("Test Preview") as HTMLIFrameElement
		expect(iframe).toBeInTheDocument()
		expect(iframe.getAttribute("src")).to.equal(baseItem.webviewUri)
		expect(iframe.getAttribute("srcdoc")).to.equal(null)
	})

	it("prefers srcdoc when htmlContent is present", () => {
		render(<HtmlPreviewView item={inlineItem} />)
		const iframe = screen.getByTitle("Test Preview") as HTMLIFrameElement
		expect(iframe.getAttribute("srcdoc")).to.contain("<h1>hello</h1>")
		expect(iframe.getAttribute("src")).to.equal(null)
	})

	it("applies the host-owned CSP only to installed Learning Pack srcdoc", () => {
		const authored = '<html><head><meta http-equiv="Content-Security-Policy" content="default-src *"></head><body>pack</body></html>'
		const packItem = {
			...inlineItem,
			htmlContent: authored,
			metadata: { ...inlineItem.metadata, artifactKind: "learning-pack-v1" },
		}
		const { rerender } = render(<HtmlPreviewView item={packItem} />)
		let iframe = screen.getByTitle("Test Preview") as HTMLIFrameElement
		const securedSrcdoc = iframe.getAttribute("srcdoc") ?? ""
		expect(securedSrcdoc).to.contain("default-src 'none'")
		expect(securedSrcdoc).not.to.contain("default-src *")
		expect(securedSrcdoc.indexOf("Content-Security-Policy")).to.be.lessThan(securedSrcdoc.indexOf("<script"))

		rerender(<HtmlPreviewView item={{ ...inlineItem, htmlContent: authored }} />)
		iframe = screen.getByTitle("Test Preview") as HTMLIFrameElement
		expect(iframe.getAttribute("srcdoc")).to.contain("default-src *")
	})

	it("uses a single sandboxed profile (scripts allowed)", () => {
		render(<HtmlPreviewView item={baseItem} />)
		const iframe = screen.getByTitle("Test Preview") as HTMLIFrameElement
		expect(iframe.getAttribute("sandbox")).to.equal("allow-scripts allow-same-origin allow-popups allow-forms allow-modals")
	})

	it("does not expose safe/interactive mode toggles", () => {
		render(<HtmlPreviewView item={baseItem} />)
		expect(screen.queryByText("Safe")).not.toBeInTheDocument()
		expect(screen.queryByText("Interactive")).not.toBeInTheDocument()
		expect(screen.queryByTitle(/Switch to (safe|interactive) mode/i)).not.toBeInTheDocument()
	})

	it("shows technical diagnostics only when Details is clicked", () => {
		render(<HtmlPreviewView item={inlineItem} />)
		expect(screen.queryByText(/PREVIEW/)).not.toBeInTheDocument()
		openKebabMenu()
		fireEvent.click(screen.getByText("Show diagnostics"))
		expect(screen.getByText(/PREVIEW/)).toBeInTheDocument()
	})

	it("displays title in the toolbar", () => {
		render(<HtmlPreviewView item={baseItem} />)
		expect(screen.getAllByText("Test Preview").length).toBeGreaterThan(0)
	})

	it("copies the file path via the extension clipboard API", async () => {
		copyToClipboardMock.mockClear()
		render(<HtmlPreviewView item={baseItem} />)
		openKebabMenu()
		fireEvent.click(screen.getByText("Copy file path"))
		expect(copyToClipboardMock).toHaveBeenCalled()
		const req = copyToClipboardMock.mock.calls[0][0] as ReturnType<typeof StringRequest.create>
		expect(req.value).to.equal(baseItem.filePath)
		openKebabMenu()
		expect(await screen.findByText("Path copied!")).toBeInTheDocument()
	})

	it("opens the source file in the default browser via the extension", () => {
		openUrlMock.mockClear()
		render(<HtmlPreviewView item={baseItem} />)
		openKebabMenu()
		fireEvent.click(screen.getByText("Open in external browser"))
		expect(openUrlMock).toHaveBeenCalled()
		const req = openUrlMock.mock.calls[0][0] as ReturnType<typeof StringRequest.create>
		expect(req.value).to.equal(baseItem.filePath)
	})

	it("opens the source file in VS Code", () => {
		openFileMock.mockClear()
		render(<HtmlPreviewView item={baseItem} />)
		openKebabMenu()
		fireEvent.click(screen.getByText("Open source in editor"))
		expect(openFileMock).toHaveBeenCalled()
	})

	it("dispatches htmlPreviewClear on Clear click", () => {
		const spy = vi.spyOn(window, "dispatchEvent")
		render(<HtmlPreviewView item={baseItem} />)
		openKebabMenu()
		fireEvent.click(screen.getByText("Remove this preview"))
		const evt = spy.mock.calls[spy.mock.calls.length - 1][0] as CustomEvent
		expect(evt.type).to.equal("htmlPreviewClear")
		expect(evt.detail).to.deep.equal({ id: "html_test" })
		spy.mockRestore()
	})

	it("remounts the iframe with a new key after Refresh", () => {
		render(<HtmlPreviewView item={baseItem} />)
		const before = screen.getByTitle("Test Preview")
		openKebabMenu()
		fireEvent.click(screen.getByText("Reload preview iframe"))
		const after = screen.getByTitle("Test Preview")
		expect(after).toBeInTheDocument()
		expect(after).not.to.equal(before)
	})

	it("shows a helpful message when webviewUri is missing", () => {
		const item: HtmlPreviewItem = { ...baseItem, webviewUri: "", htmlContent: "" }
		render(<HtmlPreviewView item={item} />)
		expect(screen.getByText("The extension has not yet supplied a webview URI for this artifact.")).toBeInTheDocument()
	})

	it("forwards artifact/runCode postMessage to gRPC and replies to the iframe", async () => {
		runArtifactCodeMock.mockClear()
		const { container } = render(<HtmlPreviewView item={inlineItem} />)
		const iframe = container.querySelector("iframe") as HTMLIFrameElement
		expect(iframe).toBeTruthy()

		const postMessage = vi.fn()
		Object.defineProperty(iframe, "contentWindow", {
			value: { postMessage },
			configurable: true,
		})

		const event = new MessageEvent("message", {
			data: {
				source: "aihydro-artifact",
				type: "artifact/runCode",
				language: "python",
				code: "print(42)",
			},
		})
		Object.defineProperty(event, "source", { value: iframe.contentWindow, configurable: true })
		window.dispatchEvent(event)

		await vi.waitFor(() => {
			expect(runArtifactCodeMock).toHaveBeenCalled()
		})

		await vi.waitFor(() => {
			expect(postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "artifact/runCodeResult",
					stdout: "42\n",
					status: "ok",
				}),
				"*",
			)
		})
	})

	it("shows kernel restart in the toolbar", () => {
		render(<HtmlPreviewView item={baseItem} />)
		openKebabMenu()
		expect(screen.getByText("Restart kernel")).toBeInTheDocument()
	})

	it("shows Run Cell control in the toolbar", () => {
		render(<HtmlPreviewView item={baseItem} />)
		expect(screen.getAllByTitle(/Run focused cell \(or first cell\)|No Python cells detected/).length).toBeGreaterThan(0)
	})
})
