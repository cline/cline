import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import sinon from "sinon"
import { FileProviderOperations } from "../FileProviderOperations"
import { MAX_FILE_EDIT_CONTENT_BYTES } from "../LargeEditGuards"

function createProvider() {
	return {
		editType: undefined as string | undefined,
		originalContent: "",
		open: sinon.stub().resolves(),
		update: sinon.stub().resolves(),
		saveChanges: sinon.stub().resolves({}),
		revertChanges: sinon.stub().resolves(),
		reset: sinon.stub().resolves(),
		deleteFile: sinon.stub().resolves(),
	} as any
}

describe("FileProviderOperations", () => {
	it("rejects oversized createFile payloads before opening the diff provider", async () => {
		const provider = createProvider()
		const ops = new FileProviderOperations(provider)
		const oversized = "x".repeat(MAX_FILE_EDIT_CONTENT_BYTES + 1)

		await assert.rejects(() => ops.createFile("big.ts", oversized), /edit payload is too large/)

		sinon.assert.notCalled(provider.open)
		sinon.assert.notCalled(provider.update)
		sinon.assert.notCalled(provider.saveChanges)
	})

	it("rejects oversized modifyFile payloads before opening the diff provider", async () => {
		const provider = createProvider()
		const ops = new FileProviderOperations(provider)
		const oversized = "x".repeat(MAX_FILE_EDIT_CONTENT_BYTES + 1)

		await assert.rejects(() => ops.modifyFile("big.ts", oversized), /edit payload is too large/)

		sinon.assert.notCalled(provider.open)
		sinon.assert.notCalled(provider.update)
		sinon.assert.notCalled(provider.saveChanges)
	})
})
