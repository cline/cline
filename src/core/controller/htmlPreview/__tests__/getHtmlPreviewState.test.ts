import { EmptyRequest } from "@shared/proto/cline/common"
import { HtmlPreviewItem } from "@shared/proto/cline/html_preview"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import { getHtmlPreviewState } from "../getHtmlPreviewState"

describe("getHtmlPreviewState", () => {
	let sandbox: sinon.SinonSandbox
	let mockController: any
	let _consoleLogStub: sinon.SinonStub

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		mockController = {
			getHtmlPreviews: sandbox.stub(),
		}
		_consoleLogStub = sandbox.stub(console, "log")
	})

	afterEach(() => {
		sandbox.restore()
	})

	it("should return empty state when no previews exist", async () => {
		mockController.getHtmlPreviews.returns([])

		const request = EmptyRequest.create()
		const result = await getHtmlPreviewState(mockController, request)

		expect(result.items).to.deep.equal([])
		expect(result.itemCount).to.equal(0)
	})

	it("should return current HTML preview items", async () => {
		const items = [
			HtmlPreviewItem.create({ id: "html_1", title: "Preview 1", htmlContent: "<div>1</div>" }),
			HtmlPreviewItem.create({ id: "html_2", title: "Preview 2", htmlContent: "<div>2</div>" }),
		]
		mockController.getHtmlPreviews.returns(items)

		const request = EmptyRequest.create()
		const result = await getHtmlPreviewState(mockController, request)

		expect(result.items).to.have.lengthOf(2)
		expect(result.itemCount).to.equal(2)
		expect(result.items[0].id).to.equal("html_1")
		expect(result.items[1].id).to.equal("html_2")
	})

	it("should call getHtmlPreviews on controller", async () => {
		mockController.getHtmlPreviews.returns([])

		await getHtmlPreviewState(mockController, EmptyRequest.create())

		expect(mockController.getHtmlPreviews.calledOnce).to.be.true
	})
})
