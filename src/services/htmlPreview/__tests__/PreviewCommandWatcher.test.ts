import type { Controller } from "@core/controller"
import { expect } from "chai"
import * as sinon from "sinon"
import { PreviewCommandWatcher } from "../PreviewCommandWatcher"

describe("PreviewCommandWatcher agent module identity", () => {
	it("resolves an agent action to the canonical logical module identity", async () => {
		const appendEvent = sinon.stub()
		const controller = {
			resolvePreviewModuleId: (id: string) => (id === "file_temporary" ? "water-balance" : id),
			previewSessionService: { appendEvent },
		} as unknown as Controller
		const watcher = new PreviewCommandWatcher(controller)

		await (watcher as any).applyCommand({
			type: "focus_cell",
			module_id: "file_temporary",
			cell_id: "cell-1",
		})

		expect(appendEvent.calledOnce).to.be.true
		const event = appendEvent.firstCall.args[0]
		expect(event.moduleId).to.equal("water-balance")
		expect(event.source).to.equal("agent")
		expect(JSON.parse(event.payloadJson)).to.deep.include({
			moduleId: "water-balance",
			cellId: "cell-1",
		})
	})
})
