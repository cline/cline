import { afterEach, beforeEach, describe, it, mock } from "bun:test"
import "should"
import sinon from "sinon"
import * as actualSdkApiHandler from "@/sdk/sdk-api-handler"
import * as actualGitUtils from "@/utils/git"

// bun loads real ESM, so sinon cannot stub the `@/utils/git` namespace export
// ("ES Modules cannot be stubbed"). Inject a module-level sinon stub for
// `getGitDiff` via mock.module so the full sinon stub API keeps working.
const getGitDiffStub: sinon.SinonStub = sinon.stub()
const gitUtilsMock = () => ({ ...actualGitUtils, getGitDiff: getGitDiffStub })
mock.module("@/utils/git", gitUtilsMock)
mock.module("@utils/git", gitUtilsMock)

// The handler is the request boundary: `createMessage` being called is the
// request going out.
const buildApiHandlerWithHostContextStub: sinon.SinonStub = sinon.stub()
mock.module("@/sdk/sdk-api-handler", () => ({
	...actualSdkApiHandler,
	buildApiHandlerWithHostContext: buildApiHandlerWithHostContextStub,
}))

import { abortCommitGeneration, getGitDiffStagedFirst, performCommitMsgGeneration } from "../commit-message-generator"

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((res) => {
		resolve = res
	})
	return { promise, resolve }
}

async function* textStream(text: string) {
	yield { type: "text", text }
}

const fakeController = { stateManager: { getApiConfiguration: () => ({}) } } as never

describe("commit-message-generator", () => {
	describe("performCommitMsgGeneration cancellation", () => {
		beforeEach(() => {
			buildApiHandlerWithHostContextStub.reset()
		})

		it("sends no request when cancelled while the host identity is resolving", async () => {
			const handler = deferred<unknown>()
			const createMessage = sinon.stub().callsFake(() => textStream("feat: x"))
			buildApiHandlerWithHostContextStub.returns(handler.promise)
			const inputBox = { value: "" }

			const generation = performCommitMsgGeneration(fakeController, "diff", inputBox)
			abortCommitGeneration()
			handler.resolve({ createMessage })
			await generation

			createMessage.called.should.be.false()
			inputBox.value.should.equal("")
		})

		it("sends the request when not cancelled", async () => {
			const createMessage = sinon.stub().callsFake(() => textStream("feat: x"))
			buildApiHandlerWithHostContextStub.resolves({ createMessage })
			const inputBox = { value: "" }

			await performCommitMsgGeneration(fakeController, "diff", inputBox)

			createMessage.calledOnce.should.be.true()
			inputBox.value.should.equal("feat: x")
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
