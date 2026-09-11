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

	it("opens http URLs", async () => {
		const stub = sandbox.stub(vscode.env, "openExternal").resolves(true)
		await openExternal(StringRequest.create({ value: "http://example.com/docs" }))
		assert.equal(stub.calledOnce, true)
	})

	it("opens mailto URLs when allowed", async () => {
		const stub = sandbox.stub(vscode.env, "openExternal").resolves(true)
		await openExternal(StringRequest.create({ value: "mailto:user@example.com" }))
		assert.equal(stub.calledOnce, true)
	})

	it("allows mixed-case schemes", async () => {
		const stub = sandbox.stub(vscode.env, "openExternal").resolves(true)
		await openExternal(StringRequest.create({ value: "HTTPS://example.com/docs" }))
		assert.equal(stub.calledOnce, true)
		await openExternal(StringRequest.create({ value: "HtTp://example.com" }))
		assert.equal(stub.calledTwice, true)
	})

	it("rejects non-browser URL schemes", async () => {
		const stub = sandbox.stub(vscode.env, "openExternal").resolves(true)

		await assert.rejects(
			openExternal(StringRequest.create({ value: "command:workbench.action.reloadWindow" })),
			/Unsupported external URI scheme: command/,
		)
		assert.equal(stub.called, false)
	})

	it("rejects blocked custom schemes", async () => {
		const stub = sandbox.stub(vscode.env, "openExternal").resolves(true)
		for (const url of ["file:///etc/passwd", "vscode://file/path", "javascript:alert(1)", "data:text/html,hi"]) {
			await assert.rejects(openExternal(StringRequest.create({ value: url })), /Unsupported external URI scheme/)
			assert.equal(stub.called, false)
		}
	})

	it("rejects malformed URLs", async () => {
		const stub = sandbox.stub(vscode.env, "openExternal").resolves(true)
		// strict parsing should reject clearly invalid input
		await assert.rejects(openExternal(StringRequest.create({ value: "://missing-scheme" })), /Unsupported|Invalid/)
		assert.equal(stub.called, false)
	})

	it("uses strict URI parsing", async () => {
		// vscode.Uri.parse with strict=true should reject malformed URIs rather than silently swallowing
		const stub = sandbox.stub(vscode.env, "openExternal").resolves(true)
		await assert.rejects(openExternal(StringRequest.create({ value: "http://[invalid" })), /Unsupported|Invalid/)
		assert.equal(stub.called, false)
	})
})
