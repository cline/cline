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

import {
	abortCommitGeneration,
	buildCommitMessageSystemPrompt,
	getGitDiffStagedFirst,
	performCommitMsgGeneration,
} from "../commit-message-generator"

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

function fakeController(getRulesForSystemPrompt: () => Promise<string> = async () => "") {
	return { stateManager: { getApiConfiguration: () => ({}) }, getRulesForSystemPrompt } as never
}

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

			const generation = performCommitMsgGeneration(fakeController(), "diff", inputBox)
			abortCommitGeneration()
			handler.resolve({ createMessage })
			await generation

			createMessage.called.should.be.false()
			inputBox.value.should.equal("")
		})

		it("sends no request when cancelled while the rules are loading", async () => {
			const rules = deferred<string>()
			const createMessage = sinon.stub().callsFake(() => textStream("feat: x"))
			buildApiHandlerWithHostContextStub.resolves({ createMessage })
			const inputBox = { value: "" }

			const generation = performCommitMsgGeneration(
				fakeController(() => rules.promise),
				"diff",
				inputBox,
			)
			abortCommitGeneration()
			rules.resolve("")
			await generation

			createMessage.called.should.be.false()
			inputBox.value.should.equal("")
		})

		it("Stop ends a generation without waiting for the rules to finish loading", async () => {
			const rules = deferred<string>()
			const createMessage = sinon.stub().callsFake(() => textStream("feat: x"))
			buildApiHandlerWithHostContextStub.resolves({ createMessage })
			const inputBox = { value: "" }

			const generation = performCommitMsgGeneration(
				fakeController(() => rules.promise),
				"diff",
				inputBox,
			)
			abortCommitGeneration()
			const settled = await Promise.race([
				generation.then(() => "settled"),
				new Promise<string>((res) => setTimeout(() => res("still waiting"), 200)),
			])
			rules.resolve("")
			await generation

			settled.should.equal("settled")
			createMessage.called.should.be.false()
		})

		it("Stop cancels every running generation", async () => {
			const first = deferred<unknown>()
			const second = deferred<unknown>()
			const firstCreateMessage = sinon.stub().callsFake(() => textStream("feat: first"))
			const secondCreateMessage = sinon.stub().callsFake(() => textStream("feat: second"))
			buildApiHandlerWithHostContextStub.onFirstCall().returns(first.promise)
			buildApiHandlerWithHostContextStub.onSecondCall().returns(second.promise)
			const firstBox = { value: "" }
			const secondBox = { value: "" }

			const generations = [
				performCommitMsgGeneration(fakeController(), "diff", firstBox),
				performCommitMsgGeneration(fakeController(), "diff", secondBox),
			]
			abortCommitGeneration()
			first.resolve({ createMessage: firstCreateMessage })
			second.resolve({ createMessage: secondCreateMessage })
			await Promise.all(generations)

			firstCreateMessage.called.should.be.false()
			secondCreateMessage.called.should.be.false()
		})

		it("a generation started later does not cancel one already running", async () => {
			const first = deferred<unknown>()
			const firstCreateMessage = sinon.stub().callsFake(() => textStream("feat: first"))
			const secondCreateMessage = sinon.stub().callsFake(() => textStream("feat: second"))
			buildApiHandlerWithHostContextStub.onFirstCall().returns(first.promise)
			buildApiHandlerWithHostContextStub.onSecondCall().resolves({ createMessage: secondCreateMessage })
			const firstBox = { value: "" }
			const secondBox = { value: "" }

			const running = performCommitMsgGeneration(fakeController(), "diff", firstBox)
			await performCommitMsgGeneration(fakeController(), "diff", secondBox)
			first.resolve({ createMessage: firstCreateMessage })
			await running

			firstBox.value.should.equal("feat: first")
			secondBox.value.should.equal("feat: second")
		})

		it("sends the request when not cancelled", async () => {
			const createMessage = sinon.stub().callsFake(() => textStream("feat: x"))
			buildApiHandlerWithHostContextStub.resolves({ createMessage })
			const inputBox = { value: "" }

			await performCommitMsgGeneration(fakeController(), "diff", inputBox)

			createMessage.calledOnce.should.be.true()
			inputBox.value.should.equal("feat: x")
		})
	})

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
