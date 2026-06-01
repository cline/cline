import { describe, it } from "mocha"
import "should"
import { formatResponse } from "../responses"

describe("formatResponse — decomposeTaskNudge", () => {
	it("renders generic guidance when no recent errors are available", () => {
		const out = formatResponse.decomposeTaskNudge()
		out.should.containEql("unsuccessful attempts")
		out.should.not.containEql("Your most recent tool failures were:")
	})

	it("grounds the nudge in the concrete recent failures when provided", () => {
		const out = formatResponse.decomposeTaskNudge([
			"[search_files] Found 0 results.",
			"[read_file] The tool execution failed with the following error: ENOENT",
		])
		out.should.containEql("Your most recent tool failures were:")
		out.should.containEql("[search_files] Found 0 results.")
		out.should.containEql("ENOENT")
	})

	it("treats an empty error list like no errors", () => {
		formatResponse.decomposeTaskNudge([]).should.not.containEql("Your most recent tool failures were:")
	})
})
