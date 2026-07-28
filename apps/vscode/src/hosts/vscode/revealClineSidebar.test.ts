import { afterEach, beforeEach, describe, it } from "bun:test"
import { expect } from "chai"
import * as sinon from "sinon"
import * as vscode from "vscode"
import { revealClineSidebar } from "./revealClineSidebar"

const SIDEBAR_VIEW_ID = "claude-dev.SidebarProvider"

describe("revealClineSidebar", () => {
	let sandbox: sinon.SinonSandbox
	let executeCommand: sinon.SinonStub

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		executeCommand = sandbox.stub(vscode.commands, "executeCommand").resolves(undefined)
	})

	afterEach(() => {
		sandbox.restore()
	})

	function fakeWebviewView() {
		return { show: sinon.stub() } as unknown as vscode.WebviewView & { show: sinon.SinonStub }
	}

	describe("when the webview view has already been resolved", () => {
		it("takes focus by forwarding preserveFocus=false", async () => {
			const webviewView = fakeWebviewView()

			await revealClineSidebar(webviewView, SIDEBAR_VIEW_ID, false)

			// WebviewView.show() takes *preserveFocus*: false means "do take focus".
			expect((webviewView.show as sinon.SinonStub).calledOnceWithExactly(false)).to.be.true
			expect(executeCommand.called).to.be.false
		})

		it("preserves editor focus by forwarding preserveFocus=true", async () => {
			const webviewView = fakeWebviewView()

			await revealClineSidebar(webviewView, SIDEBAR_VIEW_ID, true)

			// true means "do NOT move keyboard focus to the view".
			expect((webviewView.show as sinon.SinonStub).calledOnceWithExactly(true)).to.be.true
			expect(executeCommand.called).to.be.false
		})
	})

	describe("when the webview view has never been resolved", () => {
		it("falls back to the contributed view's focus command and takes focus", async () => {
			await revealClineSidebar(undefined, SIDEBAR_VIEW_ID, false)

			expect(executeCommand.calledOnceWithExactly(`${SIDEBAR_VIEW_ID}.focus`, { preserveFocus: false })).to.be.true
		})

		it("falls back to the focus command while preserving editor focus", async () => {
			await revealClineSidebar(undefined, SIDEBAR_VIEW_ID, true)

			expect(executeCommand.calledOnceWithExactly(`${SIDEBAR_VIEW_ID}.focus`, { preserveFocus: true })).to.be.true
		})

		it("derives the focus command from the view id so nightly builds keep working", async () => {
			await revealClineSidebar(undefined, "cline-nightly.SidebarProvider", false)

			expect(executeCommand.firstCall.args[0]).to.equal("cline-nightly.SidebarProvider.focus")
		})
	})
})
