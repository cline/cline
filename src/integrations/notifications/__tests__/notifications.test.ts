import { expect } from "chai"
import { afterEach, describe, it } from "mocha"
import * as sinon from "sinon"
import * as notificationsModule from ".."

function decodePowerShellEncodedCommand(encoded: string): string {
	return Buffer.from(encoded, "base64").toString("utf16le")
}

function createResolvedExecaStub() {
	return sinon.stub().resolves({} as Record<string, never>)
}

describe("notifications", () => {
	afterEach(() => {
		sinon.restore()
		notificationsModule.setNotificationExecaForTesting(null)
		notificationsModule.setNotificationPlatformForTesting(null)
	})

	it("builds a Windows toast script using single-quoted literals and DOM text assignment", () => {
		const script = notificationsModule.buildWindowsToastNotificationScript({
			subtitle: "Approval Required",
			message: "$(Start-Process calc)",
		})

		expect(script).to.contain("$message = '$(Start-Process calc)'")
		expect(script).to.contain("$textNodes.Item(1).InnerText = $message")
		expect(script).to.not.contain('<text id="2">$(Start-Process calc)</text>')
		expect(script).to.not.contain('$template = @"')
	})

	it("escapes single quotes for PowerShell single-quoted strings", () => {
		expect(notificationsModule.escapePowerShellSingleQuotedString("don't")).to.equal("don''t")
	})

	it("escapes single quotes in Windows subtitle and message assignments", () => {
		const script = notificationsModule.buildWindowsToastNotificationScript({
			subtitle: "don't ask twice",
			message: "it's fine",
		})

		expect(script).to.contain("$subtitle = 'don''t ask twice'")
		expect(script).to.contain("$message = 'it''s fine'")
	})

	it("escapes quotes and backslashes for macOS notifications", async () => {
		const execaStub = createResolvedExecaStub()
		notificationsModule.setNotificationExecaForTesting(
			execaStub as unknown as Parameters<typeof notificationsModule.setNotificationExecaForTesting>[0],
		)
		const platformStub = sinon.stub().returns("darwin")
		notificationsModule.setNotificationPlatformForTesting(
			platformStub as unknown as Parameters<typeof notificationsModule.setNotificationPlatformForTesting>[0],
		)

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
		const execaStub = createResolvedExecaStub()
		notificationsModule.setNotificationExecaForTesting(
			execaStub as unknown as Parameters<typeof notificationsModule.setNotificationExecaForTesting>[0],
		)
		const platformStub = sinon.stub().returns("linux")
		notificationsModule.setNotificationPlatformForTesting(
			platformStub as unknown as Parameters<typeof notificationsModule.setNotificationPlatformForTesting>[0],
		)

		await notificationsModule.showSystemNotification({ title: "Cline", subtitle: "Approval Required", message: "test" })

		sinon.assert.calledOnce(execaStub)
		expect(execaStub.firstCall.args[0]).to.equal("notify-send")
		expect(execaStub.firstCall.args[1]).to.deep.equal(["Cline", "Approval Required\ntest"])
	})

	it("creates explicit approval marker only when required", () => {
		expect(
			notificationsModule.createApprovalNotificationMessage({ message: "npm install", requiresExplicitApproval: true }),
		).to.equal("npm install (explicit approval required)")
		expect(
			notificationsModule.createApprovalNotificationMessage({ message: "npm install", requiresExplicitApproval: false }),
		).to.equal("npm install")
	})

	it("normalizes whitespace in approval notification messages", () => {
		expect(
			notificationsModule.createApprovalNotificationMessage({
				message: "npm\n\tinstall    ./pkg",
				requiresExplicitApproval: false,
			}),
		).to.equal("npm install ./pkg")
	})

	it("routes approval notifications through platform dispatch only when enabled", async () => {
		const execaStub = createResolvedExecaStub()
		notificationsModule.setNotificationExecaForTesting(
			execaStub as unknown as Parameters<typeof notificationsModule.setNotificationExecaForTesting>[0],
		)
		const platformStub = sinon.stub().returns("linux")
		notificationsModule.setNotificationPlatformForTesting(
			platformStub as unknown as Parameters<typeof notificationsModule.setNotificationPlatformForTesting>[0],
		)

		await notificationsModule.showApprovalNotification({ message: "npm install", requiresExplicitApproval: true }, false)
		sinon.assert.notCalled(execaStub)

		await notificationsModule.showApprovalNotification({ message: "npm install", requiresExplicitApproval: true }, true)
		sinon.assert.calledOnce(execaStub)
		expect(execaStub.firstCall.args[0]).to.equal("notify-send")
		expect(execaStub.firstCall.args[1]).to.deep.equal([
			"Cline",
			"Approval Required\nnpm install (explicit approval required)",
		])
	})

	it("abbreviates long approval notification messages while preserving the explicit approval suffix", () => {
		const message = `${"a".repeat(200)}`
		const notificationMessage = notificationsModule.createApprovalNotificationMessage({
			message,
			requiresExplicitApproval: true,
		})

		expect(notificationMessage.length).to.be.at.most(140)
		expect(notificationMessage.endsWith(" (explicit approval required)")).to.equal(true)
		expect(notificationMessage).to.contain("…")
	})

	it("encodes Windows PowerShell notifications before dispatch", async () => {
		const execaStub = createResolvedExecaStub()
		notificationsModule.setNotificationExecaForTesting(
			execaStub as unknown as Parameters<typeof notificationsModule.setNotificationExecaForTesting>[0],
		)
		const platformStub = sinon.stub().returns("win32")
		notificationsModule.setNotificationPlatformForTesting(
			platformStub as unknown as Parameters<typeof notificationsModule.setNotificationPlatformForTesting>[0],
		)

		await notificationsModule.showSystemNotification({
			subtitle: "Approval Required",
			message: 'npm`install $(Start-Process calc) "quoted"',
		})

		sinon.assert.calledOnce(execaStub)
		sinon.assert.calledOnce(platformStub)
		expect(execaStub.firstCall.args[0]).to.equal("powershell")
		const args = execaStub.firstCall.args[1] as string[]
		expect(args.slice(0, 3)).to.deep.equal(["-NoProfile", "-NonInteractive", "-EncodedCommand"])
		expect(args[3]).to.be.a("string")

		const decodedScript = decodePowerShellEncodedCommand(args[3])
		expect(decodedScript).to.contain("$message = 'npm`install $(Start-Process calc) \"quoted\"'")
		expect(decodedScript).to.contain("$textNodes.Item(1).InnerText = $message")
		expect(decodedScript).to.not.contain("-Command")
	})

	it("encodes PowerShell commands as UTF-16LE base64", () => {
		const encoded = notificationsModule.encodePowerShellCommand("Write-Host 'hello'")
		expect(decodePowerShellEncodedCommand(encoded)).to.equal("Write-Host 'hello'")
	})
})
