import { describe, it } from "mocha"
import "should"
import {
	getDiffOriginalContentIdFromUriPath,
	getRegisteredDiffOriginalContent,
	registerDiffOriginalContent,
	unregisterDiffOriginalContent,
} from "./originalContentRegistry"

describe("originalContentRegistry", () => {
	it("registers, retrieves, and unregisters diff original content", () => {
		const id = registerDiffOriginalContent("hello world")
		getRegisteredDiffOriginalContent(id).should.equal("hello world")
		unregisterDiffOriginalContent(id)
		getRegisteredDiffOriginalContent(id).should.equal("")
	})

	it("extracts registry ids from URI paths", () => {
		getDiffOriginalContentIdFromUriPath("/diff-123").should.equal("diff-123")
		getDiffOriginalContentIdFromUriPath("diff-456").should.equal("diff-456")
	})
})
