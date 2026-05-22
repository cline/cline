import { Empty } from "@shared/proto/cline/common"
import { HtmlPreviewMode, PreviewHtmlRequest } from "@shared/proto/cline/html_preview"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import { HostProvider } from "@/hosts/host-provider"
import type { ArtifactRef } from "@/services/artifact-preview/ArtifactPreviewService"
import { previewHtml } from "../previewHtml"

// Lightweight HostProvider stub so the error paths can call window.showMessage
// without crashing. Set up once for the suite.
function ensureHostProviderStub() {
	if (HostProvider.isInitialized()) return
	const noop = async () => ({}) as any
	const hostBridge = {
		windowClient: { showMessage: noop } as any,
		workspaceClient: {} as any,
		envClient: {} as any,
		diffClient: {} as any,
		uriClient: {} as any,
		watchClient: {} as any,
		testingClient: {} as any,
	} as any
	HostProvider.initialize(
		(() => ({}) as any) as any,
		(() => ({}) as any) as any,
		hostBridge,
		() => {},
		async () => "",
		async () => "",
		"",
		"",
	)
}

describe("previewHtml", () => {
	let sandbox: sinon.SinonSandbox
	let svc: {
		registerInline: sinon.SinonStub
		registerFile: sinon.SinonStub
	}
	let mockController: any

	const makeRef = (overrides: Partial<ArtifactRef> = {}): ArtifactRef => ({
		id: "test_id",
		title: "Test",
		source: "inline",
		mode: "safe",
		fsPath: "/tmp/test.html",
		dirFsPath: "/tmp",
		contentHash: "deadbeef",
		createdAt: Date.now(),
		html: "<div>stub</div>",
		byteLength: 16,
		metadata: { source: "inline" },
		...overrides,
	})

	beforeEach(() => {
		ensureHostProviderStub()
		sandbox = sinon.createSandbox()
		svc = {
			registerInline: sandbox.stub().resolves(makeRef({ source: "inline", id: "inline_1" })),
			registerFile: sandbox.stub().resolves(makeRef({ source: "file", id: "file_1", mode: "interactive" })),
		}
		mockController = {
			getArtifactPreviewService: () => svc,
			addHtmlPreview: sandbox.stub(),
			getWorkspaceHtmlFiles: () => [],
		}
		sandbox.stub(console, "log")
		sandbox.stub(console, "error")
	})

	afterEach(() => sandbox.restore())

	it("returns Empty and does not call addHtmlPreview when neither content nor path is given", async () => {
		const result = await previewHtml(mockController, PreviewHtmlRequest.create({}))
		expect(result).to.deep.equal(Empty.create())
		expect(svc.registerInline.called).to.be.false
		expect(svc.registerFile.called).to.be.false
		expect(mockController.addHtmlPreview.called).to.be.false
	})

	it("registers an inline artifact when only htmlContent is provided", async () => {
		const req = PreviewHtmlRequest.create({
			htmlContent: "<div>Hello</div>",
			title: "My Chart",
			interactive: false,
		})
		await previewHtml(mockController, req)

		expect(svc.registerInline.calledOnce).to.be.true
		const args = svc.registerInline.firstCall.args[0]
		expect(args.html).to.equal("<div>Hello</div>")
		expect(args.title).to.equal("My Chart")
		// `mode` unset → proto3 default UNSPECIFIED → fall through to
		// detectMode() (preferredMode === undefined).
		expect(args.preferredMode).to.equal(undefined)
		expect(mockController.addHtmlPreview.calledOnce).to.be.true
	})

	it("registers a file artifact when filePath is provided and htmlContent is empty", async () => {
		const req = PreviewHtmlRequest.create({
			htmlContent: "",
			title: "Report",
			filePath: "/abs/report.html",
		})
		await previewHtml(mockController, req)

		expect(svc.registerFile.calledOnce).to.be.true
		const args = svc.registerFile.firstCall.args[0]
		expect(args.fsPath).to.equal("/abs/report.html")
		expect(args.title).to.equal("Report")
	})

	it("prefers the file path when both htmlContent and filePath are provided", async () => {
		const req = PreviewHtmlRequest.create({
			htmlContent: "<div>cached copy</div>",
			title: "Report",
			filePath: "/abs/report.html",
		})
		await previewHtml(mockController, req)
		expect(svc.registerFile.calledOnce).to.be.true
		expect(svc.registerInline.called).to.be.false
	})

	it("maps the deprecated interactive bool to preferredMode='interactive' when mode is unset and bool is true", async () => {
		const req = PreviewHtmlRequest.create({
			htmlContent: "<div></div>",
			title: "x",
			interactive: true,
			// mode is unset → UNSPECIFIED; legacy bool wins.
		})
		await previewHtml(mockController, req)

		const args = svc.registerInline.firstCall.args[0]
		expect(args.preferredMode).to.equal("interactive")
	})

	it("falls through to detectMode (preferredMode=undefined) when mode is UNSPECIFIED and bool is false", async () => {
		const req = PreviewHtmlRequest.create({
			htmlContent: "<div></div>",
			title: "x",
			interactive: false,
		})
		await previewHtml(mockController, req)
		const args = svc.registerInline.firstCall.args[0]
		expect(args.preferredMode).to.equal(undefined)
	})

	it("treats mode=SAFE as an explicit safe-mode request", async () => {
		const req = PreviewHtmlRequest.create({
			htmlContent: "<div></div>",
			title: "x",
			mode: HtmlPreviewMode.SAFE,
		})
		await previewHtml(mockController, req)
		const args = svc.registerInline.firstCall.args[0]
		expect(args.preferredMode).to.equal("safe")
	})

	it("treats mode=INTERACTIVE as preferredMode='interactive'", async () => {
		const req = PreviewHtmlRequest.create({
			htmlContent: "<div></div>",
			title: "x",
			mode: HtmlPreviewMode.INTERACTIVE,
		})
		await previewHtml(mockController, req)
		const args = svc.registerInline.firstCall.args[0]
		expect(args.preferredMode).to.equal("interactive")
	})

	it("propagates registerInline errors to the caller", async () => {
		svc.registerInline.rejects(new Error("disk full"))
		const req = PreviewHtmlRequest.create({ htmlContent: "<div></div>" })
		let caught: Error | undefined
		try {
			await previewHtml(mockController, req)
		} catch (e) {
			caught = e as Error
		}
		expect(caught?.message).to.contain("disk full")
		expect(mockController.addHtmlPreview.called).to.be.false
	})
})
