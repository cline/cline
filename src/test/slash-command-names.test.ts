import { describe, it } from "mocha"
import "should"
import { getWorkflowCommandAliases, toWorkflowCommandName } from "../shared/slash-command-names"

describe("slash-command-names", () => {
	describe("toWorkflowCommandName", () => {
		it("removes .md extension", () => {
			toWorkflowCommandName("my-workflow.md").should.equal("my-workflow")
		})

		it("removes .txt extension", () => {
			toWorkflowCommandName("my-workflow.txt").should.equal("my-workflow")
		})

		it("keeps names without extension", () => {
			toWorkflowCommandName("my-workflow").should.equal("my-workflow")
		})

		it("extracts file name from full path", () => {
			toWorkflowCommandName("/tmp/.clinerules/workflows/my-workflow.md").should.equal("my-workflow")
		})
	})

	describe("getWorkflowCommandAliases", () => {
		it("returns normalized name and original file name when extension exists", () => {
			getWorkflowCommandAliases("my-workflow.md").should.deepEqual(["my-workflow", "my-workflow.md"])
		})

		it("returns single alias when already normalized", () => {
			getWorkflowCommandAliases("my-workflow").should.deepEqual(["my-workflow"])
		})
	})
})
