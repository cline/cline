import { afterEach, beforeEach, describe, it } from "bun:test"
import { expect } from "chai"
import * as path from "path"
import * as sinon from "sinon"
import { HostProvider } from "@/hosts/host-provider"
import { setVscodeHostProviderMock } from "@/test/host-provider-test-utils"
import { openFile } from "./open-file"

describe("openFile", () => {
	let sandbox: sinon.SinonSandbox
	let showTextDocument: sinon.SinonStub

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		setVscodeHostProviderMock()
		showTextDocument = sandbox.stub(HostProvider.window, "showTextDocument").resolves({} as any)
	})

	afterEach(() => {
		sandbox.restore()
	})

	it("opens an absolute path as given", async () => {
		await openFile("/Users/jay/project/index.html")

		expect(showTextDocument.firstCall.args[0].path).to.equal("/Users/jay/project/index.html")
	})

	it("turns a file URL into the platform's path", async () => {
		await openFile("file:///Users/jay/my%20project/index.html")

		expect(showTextDocument.firstCall.args[0].path).to.equal(path.normalize("/Users/jay/my project/index.html"))
	})

	it("accepts the file scheme in any case", async () => {
		await openFile("FILE:///Users/jay/project/index.html")

		expect(showTextDocument.firstCall.args[0].path).to.equal(path.normalize("/Users/jay/project/index.html"))
	})
})
