import { Empty } from "@shared/proto/cline/common"
import { RemoveHtmlPreviewItemRequest } from "@shared/proto/cline/html_preview"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import { removeHtmlPreviewItem } from "../removeHtmlPreviewItem"

describe("removeHtmlPreviewItem", () => {
	let sandbox: sinon.SinonSandbox
	let mockController: any

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		mockController = {
			removeHtmlPreview: sandbox.stub(),
		}
	})

	afterEach(() => {
		sandbox.restore()
	})

	it("should remove HTML preview by ID and return Empty", async () => {
		const request = RemoveHtmlPreviewItemRequest.create({ id: "html_preview_123" })

		const result = await removeHtmlPreviewItem(mockController, request)

		expect(result).to.deep.equal(Empty.create())
		expect(mockController.removeHtmlPreview.calledOnceWith("html_preview_123")).to.be.true
	})

	it("should handle removal of non-existent ID gracefully", async () => {
		const request = RemoveHtmlPreviewItemRequest.create({ id: "non_existent" })

		mockController.removeHtmlPreview.returns(undefined)

		const result = await removeHtmlPreviewItem(mockController, request)

		expect(result).to.deep.equal(Empty.create())
		expect(mockController.removeHtmlPreview.calledOnceWith("non_existent")).to.be.true
	})
})
