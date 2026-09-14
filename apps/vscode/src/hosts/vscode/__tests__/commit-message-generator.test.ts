import { afterEach, beforeEach, describe, it, mock } from "bun:test"
import "should"
import sinon from "sinon"
import * as actualGitUtils from "@/utils/git"

// bun loads real ESM, so sinon cannot stub the `@/utils/git` namespace export
// ("ES Modules cannot be stubbed"). Inject a module-level sinon stub for
// `getGitDiff` via mock.module so the full sinon stub API keeps working.
const getGitDiffStub: sinon.SinonStub = sinon.stub()
const gitUtilsMock = () => ({ ...actualGitUtils, getGitDiff: getGitDiffStub })
mock.module("@/utils/git", gitUtilsMock)
mock.module("@utils/git", gitUtilsMock)

import { buildCommitMessageSystemPrompt, getGitDiffStagedFirst } from "../commit-message-generator"

describe("commit-message-generator", () => {
	describe("buildCommitMessageSystemPrompt", () => {
		it("returns the base prompt alone when there are no rules", () => {
			const prompt = buildCommitMessageSystemPrompt("")
			prompt.should.startWith("You are a helpful assistant that generates informative git commit messages")
			prompt.should.not.containEql("# Rules")
		})

		it("treats a whitespace-only rules section as no rules", () => {
			buildCommitMessageSystemPrompt("  \n\n ").should.equal(buildCommitMessageSystemPrompt(""))
		})

		it("appends the user's rules after the base prompt", () => {
			const rules = "\n\n# Rules\n## commits\nUse conventional commits, imperative mood."
			const prompt = buildCommitMessageSystemPrompt(rules)
			prompt.should.startWith("You are a helpful assistant")
			prompt.should.containEql("The user's rules follow.")
			prompt.should.endWith(rules)
			prompt.indexOf("# Rules").should.be.above(prompt.indexOf("The user's rules follow."))
		})
	})

	describe("getGitDiffStagedFirst", () => {
		beforeEach(() => {
			getGitDiffStub.reset()
		})

		afterEach(() => {
			sinon.restore()
			getGitDiffStub.reset()
		})

		it("should return staged changes when they exist", async () => {
			const stub = getGitDiffStub
			stub.withArgs("/repo", true).resolves("staged diff content")

			const result = await getGitDiffStagedFirst("/repo")
			result.should.equal("staged diff content")
			stub.calledOnceWith("/repo", true).should.be.true()
		})

		it("should fall back to all changes when no staged changes exist", async () => {
			const stub = getGitDiffStub
			stub.withArgs("/repo", true).rejects(new Error("No changes in workspace for commit message"))
			stub.withArgs("/repo", false).resolves("all diff content")

			const result = await getGitDiffStagedFirst("/repo")
			result.should.equal("all diff content")
			stub.calledTwice.should.be.true()
			stub.firstCall.args.should.deepEqual(["/repo", true])
			stub.secondCall.args.should.deepEqual(["/repo", false])
		})

		it("should propagate error when both staged and all changes fail", async () => {
			const stub = getGitDiffStub
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
