import { expect } from "chai"
import { afterEach, describe, it } from "mocha"
import Module from "module"
import * as sinon from "sinon"

const require = Module.createRequire(import.meta.url)

function loadNotificationsModule() {
	return require("..") as typeof import("..")
}

describe("notifications", () => {
	afterEach(() => {
		sinon.restore()
		const mod = loadNotificationsModule()
		mod.setNotificationExecaForTesting(null)
		mod.setNotificationPlatformForTesting(null)
	})

	it("builds a Windows toast script using single-quoted literals and DOM text assignment", () => {
		const mod = loadNotificationsModule()
		const script = mod.buildWindowsToastNotificationScript({
			subtitle: "Approval Required",
			message: "$(Start-Process calc)",
		})

		expect(script).to.contain("$message = '$(Start-Process calc)'")
		expect(script).to.contain("$textNodes.Item(1).InnerText = $message")
		expect(script).to.not.contain('<text id="2">$(Start-Process calc)</text>')
		expect(script).to.not.contain('$template = @"')
	})

	it("escapes single quotes for PowerShell single-quoted strings", () => {
		const mod = loadNotificationsModule()
		expect(mod.escapePowerShellSingleQuotedString("don't")).to.equal("don''t")
	})

	it("escapes single quotes in Windows subtitle and message assignments", () => {
		const mod = loadNotificationsModule()
		const script = mod.buildWindowsToastNotificationScript({
			subtitle: "don't ask twice",
			message: "it's fine",
		})

		expect(script).to.contain("$subtitle = 'don''t ask twice'")
		expect(script).to.contain("$message = 'it''s fine'")
	})

	it("escapes quotes and backslashes for macOS notifications", async () => {
		const notificationsModule = loadNotificationsModule()
		const execaStub = sinon.stub().resolves({} as any)
		notificationsModule.setNotificationExecaForTesting(execaStub as any)
		const platformStub = sinon.stub().returns("darwin")
		notificationsModule.setNotificationPlatformForTesting(platformStub as any)

		await notificationsModule.showSystemNotification({
			title: 'Cline "Agent"',
			subtitle: "Path C:\\temp",
			message: 'He said "hello"',
		})

		sinon.assert.calledOnce(execaStub)
		expect(execaStub.firstCall.args[0]).to.equal("osascript")
		const script = (execaStub.firstCall.args[1] as string[])[1]
		expect(script).to.contain('display notification "He said \\"hello\\""')
		expect(script).to.contain('with title "Cline \\"Agent\\""')
		expect(script).to.contain('subtitle "Path C:\\\\temp"')
	})

	it("passes title and combined subtitle/message to notify-send on Linux", async () => {
		const notificationsModule = loadNotificationsModule()
		const execaStub = sinon.stub().resolves({} as any)
		notificationsModule.setNotificationExecaForTesting(execaStub as any)
		const platformStub = sinon.stub().returns("linux")
		notificationsModule.setNotificationPlatformForTesting(platformStub as any)

		await notificationsModule.showSystemNotification({ title: "Cline", subtitle: "Approval Required", message: "test" })

		sinon.assert.calledOnce(execaStub)
		expect(execaStub.firstCall.args[0]).to.equal("notify-send")
		expect(execaStub.firstCall.args[1]).to.deep.equal(["Cline", "Approval Required\ntest"])
	})

	it("creates explicit approval marker only when required", () => {
		const mod = loadNotificationsModule()
		expect(mod.createApprovalNotificationMessage({ message: "npm install", requiresExplicitApproval: true })).to.equal(
			"npm installREQ_APP",
		)
		expect(mod.createApprovalNotificationMessage({ message: "npm install", requiresExplicitApproval: false })).to.equal(
			"npm install",
		)
	})

	it("routes approval notifications through platform dispatch only when enabled", async () => {
		const notificationsModule = loadNotificationsModule()
		const execaStub = sinon.stub().resolves({} as any)
		notificationsModule.setNotificationExecaForTesting(execaStub as any)
		const platformStub = sinon.stub().returns("linux")
		notificationsModule.setNotificationPlatformForTesting(platformStub as any)

		notificationsModule.showApprovalNotification({ message: "npm install", requiresExplicitApproval: true }, false)
		await Promise.resolve()
		sinon.assert.notCalled(execaStub)

		notificationsModule.showApprovalNotification({ message: "npm install", requiresExplicitApproval: true }, true)
		await Promise.resolve()
		sinon.assert.calledOnce(execaStub)
		expect(execaStub.firstCall.args[0]).to.equal("notify-send")
		expect(execaStub.firstCall.args[1]).to.deep.equal(["Cline", "Approval Required\nnpm installREQ_APP"])
	})

	it("uses hardened PowerShell flags on Windows dispatch", async () => {
		const notificationsModule = loadNotificationsModule()
		const execaStub = sinon.stub().resolves({} as any)
		notificationsModule.setNotificationExecaForTesting(execaStub as any)
		const platformStub = sinon.stub().returns("win32")
		notificationsModule.setNotificationPlatformForTesting(platformStub as any)

		await notificationsModule.showSystemNotification({ subtitle: "Approval Required", message: "test" })

		sinon.assert.calledOnce(execaStub)
		sinon.assert.calledOnce(platformStub)
		expect(execaStub.firstCall.args[0]).to.equal("powershell")
		const args = execaStub.firstCall.args[1] as string[]
		expect(args.slice(0, 3)).to.deep.equal(["-NoProfile", "-NonInteractive", "-Command"])
		expect(args[3]).to.be.a("string")
	})
})
