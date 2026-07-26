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

import { buildCommitMessageInput, getGitDiffStagedFirst } from "../commit-message-generator"

describe("commit-message-generator", () => {
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

	describe("buildCommitMessageInput", () => {
		it("bounds the model input and excludes secret files and credential values", () => {
			const diff = [
				"diff --git a/src/app.ts b/src/app.ts",
				"--- a/src/app.ts",
				"+++ b/src/app.ts",
				"@@ -1 +1 @@",
				"-old",
				`+${"safe change ".repeat(500)}`,
				"diff --git a/.env b/.env",
				"--- a/.env",
				"+++ b/.env",
				"@@ -1 +1 @@",
				"-AWS_ACCESS_KEY_ID=old",
				"+AWS_ACCESS_KEY_ID=AKIA1234567890ABCDEF",
			].join("\n")

			const result = buildCommitMessageInput({
				diff,
				status: " M src/app.ts\n M .env",
				branch: "feature/recovery",
				maxChars: 2_000,
			})

			result.should.containEql("feature/recovery")
			result.should.containEql("src/app.ts")
			result.should.not.containEql(".env")
			result.should.not.containEql("AKIA1234567890ABCDEF")
			;(result.length <= 2_060).should.be.true()
		})
	})
})
