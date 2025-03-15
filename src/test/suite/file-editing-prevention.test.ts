import { describe, it } from "mocha"
import { expect } from "chai"
import { checkFileEditingPrevention } from "../../core/file-editing-prevention"
import { ChatSettings } from "../../shared/ChatSettings"

describe("File Editing Prevention", () => {
	it("should prevent editing in plan mode", () => {
		const chatSettings: ChatSettings = {
			mode: "plan",
		}

		const result = checkFileEditingPrevention(chatSettings)

		expect(result.isPreventingEdit).to.be.true
		expect(result.toolError).to.include("File editing is not allowed in Plan mode")
	})

	it("should allow editing in act mode", () => {
		const chatSettings: ChatSettings = {
			mode: "act",
		}

		const result = checkFileEditingPrevention(chatSettings)

		expect(result.isPreventingEdit).to.be.false
		expect(result.toolError).to.be.undefined
	})
})
