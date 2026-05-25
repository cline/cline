import { afterEach, describe, it } from "mocha"
import "should"
import sinon from "sinon"
import * as gitUtils from "@/utils/git"
import { getGitDiffStagedFirst } from "../commit-message-generator"

describe("commit-message-generator", () => {
	describe("getGitDiffStagedFirst", () => {
		afterEach(() => {
			sinon.restore()
		})

		it("should return staged changes when they exist", async () => {
			const stub = sinon.stub(gitUtils, "getGitDiff")
			stub.withArgs("/repo", true).resolves("staged diff content")

			const result = await getGitDiffStagedFirst("/repo")
			result.should.equal("staged diff content")
			stub.calledOnceWith("/repo", true).should.be.true()
		})

		it("should fall back to all changes when no staged changes exist", async () => {
			const stub = sinon.stub(gitUtils, "getGitDiff")
			stub.withArgs("/repo", true).rejects(new Error("No changes in workspace for commit message"))
			stub.withArgs("/repo", false).resolves("all diff content")

			const result = await getGitDiffStagedFirst("/repo")
			result.should.equal("all diff content")
			stub.calledTwice.should.be.true()
			stub.firstCall.args.should.deepEqual(["/repo", true])
			stub.secondCall.args.should.deepEqual(["/repo", false])
		})

		it("should propagate error when both staged and all changes fail", async () => {
			const stub = sinon.stub(gitUtils, "getGitDiff")
			stub.withArgs("/repo", true).rejects(new Error("No changes"))
			stub.withArgs("/repo", false).rejects(new Error("No changes in workspace for commit message"))

			let error: Error | undefined
			try {
				await getGitDiffStagedFirst("/repo")
			} catch (e) {
				error = e as Error
			}
			;(error !== undefined).should.be.true()
			error!.message.should.equal("No changes in workspace for commit message")
		})
	})
})
