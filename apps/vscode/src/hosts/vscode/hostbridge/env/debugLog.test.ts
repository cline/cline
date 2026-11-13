import { afterEach, describe, it } from "mocha"
import { strict as assert } from "assert"
import * as sinon from "sinon"
import { StringRequest } from "@shared/proto/cline/common"
import { debugLog } from "./debugLog"

describe("Hostbridge - Env - debugLog", () => {
	const sandbox = sinon.createSandbox()

	afterEach(() => {
		sandbox.restore()
	})

	it("executes debugLog without error for simple messages", async () => {
		const request = StringRequest.create({ value: "[INFO] Test message" })
		const response = await debugLog(request)
		assert.ok(response)
	})
})
