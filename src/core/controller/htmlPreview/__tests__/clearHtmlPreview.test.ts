import { Empty } from "@shared/proto/cline/common"
import { ClearHtmlPreviewRequest } from "@shared/proto/cline/html_preview"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import { clearHtmlPreview } from "../clearHtmlPreview"

describe("clearHtmlPreview", () => {
	let sandbox: sinon.SinonSandbox
	let mockController: any
	let _consoleLogStub: sinon.SinonStub

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		mockController = {
			clearHtmlPreviews: sandbox.stub(),
		}
		_consoleLogStub = sandbox.stub(console, "log")
	})

	afterEach(() => {
		sandbox.restore()
	})

	it("should clear all HTML previews and return Empty", async () => {
		const request = ClearHtmlPreviewRequest.create()

		const result = await clearHtmlPreview(mockController, request)

		expect(result).to.deep.equal(Empty.create())
		expect(mockController.clearHtmlPreviews.calledOnce).to.be.true
	})

	it("should handle clear when no previews exist", async () => {
		mockController.clearHtmlPreviews.returns(undefined)

		const result = await clearHtmlPreview(mockController, ClearHtmlPreviewRequest.create())

		expect(result).to.deep.equal(Empty.create())
		expect(mockController.clearHtmlPreviews.calledOnce).to.be.true
	})
})
