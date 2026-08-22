import { strict as assert } from "assert"
import { afterEach, describe, it } from "mocha"
import * as sinon from "sinon"
import * as vscode from "vscode"
import { StringRequest } from "@shared/proto/cline/common"
import { openExternal } from "./openExternal"

describe("Hostbridge - Env - openExternal", () => {
	const sandbox = sinon.createSandbox()

	afterEach(() => {
		sandbox.restore()
	})

	it("opens browser-safe URL schemes", async () => {
		const stub = sandbox.stub(vscode.env, "openExternal").resolves(true)

		await openExternal(StringRequest.create({ value: "https://example.com/docs" }))

		assert.equal(stub.calledOnce, true)
	})

	it("rejects non-browser URL schemes", async () => {
		const stub = sandbox.stub(vscode.env, "openExternal").resolves(true)

		await assert.rejects(
			openExternal(StringRequest.create({ value: "command:workbench.action.reloadWindow" })),
			/Unsupported external URI scheme: command/,
		)
		assert.equal(stub.called, false)
	})
})
