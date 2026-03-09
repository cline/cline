import { expect } from "chai"
import { afterEach, describe, it } from "mocha"
import * as sinon from "sinon"

describe("notifications", () => {
	afterEach(() => {
		sinon.restore()
		const mod = require("../integrations/notifications") as typeof import("../integrations/notifications")
		mod.setNotificationExecaForTesting(null)
		mod.setNotificationPlatformForTesting(null)
	})

	it("builds a Windows toast script using single-quoted literals and DOM text assignment", () => {
		const mod = require("../integrations/notifications") as typeof import("../integrations/notifications")
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
		const mod = require("../integrations/notifications") as typeof import("../integrations/notifications")
		expect(mod.escapePowerShellSingleQuotedString("don't")).to.equal("don''t")
	})

	it("uses hardened PowerShell flags on Windows dispatch", async () => {
		const notificationsModule = await import("../integrations/notifications")
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
