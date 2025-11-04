import type {
	ApiStream,
	ApiStreamAnthropicRedactedThinkingChunk,
	ApiStreamAnthropicThinkingChunk,
	ApiStreamChunk,
	ApiStreamReasoningChunk,
	ApiStreamReasoningDetailsChunk,
	ApiStreamTextChunk,
	ApiStreamToolCallsChunk,
	ApiStreamUsageChunk,
} from "@core/api/transform/stream"
import { ClineDefaultTool } from "@shared/tools"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import type { StreamingChunkState } from "./streaming-chunk-processor"
import { StreamingChunkProcessor } from "./streaming-chunk-processor"
import { TaskState } from "./TaskState"

type TestContext = {
	taskState: TaskState
	streamingState: StreamingChunkState
	sayStub: sinon.SinonStub
	presentStub: sinon.SinonStub
	abortStub: sinon.SinonStub
	processor: StreamingChunkProcessor
}

const createStreamingState = (): StreamingChunkState => ({
	assistantMessage: "",
	assistantTextOnly: "",
	reasoningMessage: "",
	reasoningDetails: [],
	antThinkingContent: [],
	reasoningSignature: "",
})

const createProcessorContext = (
	sandbox: sinon.SinonSandbox,
	overrides?: Partial<{ useNativeToolCalls: boolean }>,
): TestContext => {
	const taskState = new TaskState()
	const streamingState = createStreamingState()
	const sayStub = sandbox.stub().resolves(undefined)
	const presentStub = sandbox.stub()
	const abortStub = sandbox.stub().resolves(undefined)

	const processor = new StreamingChunkProcessor({
		taskState,
		streamingState,
		say: sayStub,
		presentAssistantMessage: presentStub,
		useNativeToolCalls: overrides?.useNativeToolCalls ?? false,
		abortStream: abortStub,
	})

	return {
		taskState,
		streamingState,
		sayStub,
		presentStub,
		abortStub,
		processor,
	}
}

const createStream = (chunks: ApiStreamChunk[]): ApiStream =>
	(async function* () {
		for (const chunk of chunks) {
			yield chunk
		}
	})()

describe("StreamingChunkProcessor", () => {
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		sandbox = sinon.createSandbox()
	})

	afterEach(() => {
		sandbox.restore()
	})

	describe("handleChunk", () => {
		type ChunkCase = {
			name: string
			chunk:
				| ApiStreamUsageChunk
				| ApiStreamReasoningChunk
				| ApiStreamReasoningDetailsChunk
				| ApiStreamAnthropicThinkingChunk
				| ApiStreamAnthropicRedactedThinkingChunk
				| ApiStreamTextChunk
				| ApiStreamToolCallsChunk
			setup?: (ctx: TestContext) => void
			verify: (ctx: TestContext) => void | Promise<void>
		}

		const chunkCases: ChunkCase[] = [
			{
				name: "usage chunk updates token snapshot",
				chunk: {
					type: "usage",
					inputTokens: 10,
					outputTokens: 5,
					cacheWriteTokens: 3,
					cacheReadTokens: 7,
					totalCost: 0.42,
				},
				verify: (ctx) => {
					const snapshot = ctx.processor.getUsageSnapshot()
					expect(ctx.processor.didReceiveUsage).to.be.true
					expect(snapshot).to.deep.equal({
						inputTokens: 10,
						outputTokens: 5,
						cacheWriteTokens: 3,
						cacheReadTokens: 7,
						totalCost: 0.42,
					})
				},
			},
			{
				name: "reasoning chunk streams partial reasoning",
				chunk: {
					type: "reasoning",
					reasoning: "Thinking aloud...",
				},
				verify: (ctx) => {
					expect(ctx.streamingState.reasoningMessage).to.equal("Thinking aloud...")
					expect(ctx.sayStub.calledWithExactly("reasoning", "Thinking aloud...", undefined, undefined, true)).to.be.true
				},
			},
			{
				name: "reasoning details chunk aggregates traces",
				chunk: {
					type: "reasoning_details",
					reasoning_details: [{ foo: "bar" }],
				},
				verify: (ctx) => {
					expect(ctx.streamingState.reasoningDetails).to.deep.equal([{ foo: "bar" }])
				},
			},
			{
				name: "anthropic thinking chunk records blocks",
				chunk: {
					type: "ant_thinking",
					thinking: "Calculating step",
					signature: "sig-123",
				},
				verify: (ctx) => {
					expect(ctx.streamingState.antThinkingContent).to.deep.equal([
						{
							type: "thinking",
							thinking: "Calculating step",
							signature: "sig-123",
						},
					])
				},
			},
			{
				name: "anthropic redacted thinking chunk records data",
				chunk: {
					type: "ant_redacted_thinking",
					data: "redacted",
				},
				verify: (ctx) => {
					expect(ctx.streamingState.antThinkingContent).to.deep.equal([
						{
							type: "redacted_thinking",
							data: "redacted",
						},
					])
				},
			},
			{
				name: "text chunk updates assistant content and presentation",
				chunk: {
					type: "text",
					text: "Here is the answer.",
				},
				setup: (ctx) => {
					ctx.streamingState.reasoningMessage = "pre-reasoning"
				},
				verify: (ctx) => {
					expect(ctx.sayStub.calledWithExactly("reasoning", "pre-reasoning", undefined, undefined, false)).to.be.true
					expect(ctx.streamingState.assistantMessage).to.equal("Here is the answer.")
					expect(ctx.streamingState.assistantTextOnly).to.equal("Here is the answer.")
					expect(ctx.taskState.assistantMessageContent).to.not.be.empty
					expect(ctx.presentStub.calledOnce).to.be.true
				},
			},
			{
				name: "tool call chunk captures partial tool use",
				chunk: {
					type: "tool_calls",
					tool_call: {
						function: {
							id: "tool-1",
							name: ClineDefaultTool.BASH,
							arguments: '{"command":"ls"}',
						},
					},
				},
				verify: (ctx) => {
					expect(ctx.taskState.toolUseIdMap.get(ClineDefaultTool.BASH)).to.equal("tool-1")
					expect(ctx.taskState.assistantMessageContent).to.have.lengthOf(1)
					const toolBlock = ctx.taskState.assistantMessageContent[0] as any
					expect(toolBlock).to.include({
						type: "tool_use",
						name: ClineDefaultTool.BASH,
						partial: true,
					})
					expect(toolBlock.params).to.deep.equal({ command: "ls" })
					const serialized = ctx.streamingState.assistantMessage.trim()
					expect(serialized).to.not.equal("")
					expect(JSON.parse(serialized)).to.deep.equal(toolBlock)
					expect(ctx.presentStub.calledOnce).to.be.true
				},
			},
		]

		for (const chunkCase of chunkCases) {
			it(`handleChunk ${chunkCase.name}`, async () => {
				const ctx = createProcessorContext(sandbox)

				chunkCase.setup?.(ctx)
				await ctx.processor.handleChunk(chunkCase.chunk)
				await chunkCase.verify(ctx)
			})
		}
	})

	describe("processStream control flow", () => {
		type InterruptionCase = {
			name: string
			setup: (ctx: TestContext) => void
			verify: (ctx: TestContext, result: Awaited<ReturnType<StreamingChunkProcessor["processStream"]>>) => void
		}

		const interruptionChunks: ApiStreamChunk[] = [
			{
				type: "text",
				text: "Partial reply",
			},
			{
				type: "usage",
				inputTokens: 2,
				outputTokens: 1,
			},
		]

		const interruptionCases: InterruptionCase[] = [
			{
				name: "aborts stream when task is cancelled",
				setup: (ctx) => {
					ctx.taskState.abort = true
					ctx.taskState.abandoned = false
				},
				verify: (ctx, result) => {
					expect(result.didReceiveUsageChunk).to.be.false
					expect(ctx.abortStub.calledWithExactly("user_cancelled")).to.be.true
				},
			},
			{
				name: "interrupts when tool rejection occurs",
				setup: (ctx) => {
					ctx.taskState.didRejectTool = true
				},
				verify: (ctx, result) => {
					expect(result.didReceiveUsageChunk).to.be.false
					expect(ctx.streamingState.assistantMessage).to.include("[Response interrupted by user feedback]")
					expect(ctx.abortStub.notCalled).to.be.true
				},
			},
			{
				name: "interrupts when another tool was already used",
				setup: (ctx) => {
					ctx.taskState.didAlreadyUseTool = true
				},
				verify: (ctx, result) => {
					expect(result.didReceiveUsageChunk).to.be.false
					expect(ctx.streamingState.assistantMessage).to.include(
						"[Response interrupted by a tool use result. Only one tool may be used at a time and should be placed at the end of the message.]",
					)
					expect(ctx.abortStub.notCalled).to.be.true
				},
			},
		]

		for (const interruptionCase of interruptionCases) {
			it(`processStream ${interruptionCase.name}`, async () => {
				const ctx = createProcessorContext(sandbox)
				interruptionCase.setup(ctx)

				const result = await ctx.processor.processStream(createStream(interruptionChunks))

				interruptionCase.verify(ctx, result)
			})
		}
	})

	it("processStream finalizes tool calls and aggregates usage when native tools enabled", async () => {
		const ctx = createProcessorContext(sandbox, { useNativeToolCalls: true })

		const chunks: ApiStreamChunk[] = [
			{
				type: "tool_calls",
				tool_call: {
					function: {
						id: "tool-2",
						name: ClineDefaultTool.FILE_READ,
						arguments: JSON.stringify({ path: "README.md" }),
					},
				},
			},
			{
				type: "usage",
				inputTokens: 4,
				outputTokens: 6,
				cacheReadTokens: 1,
			},
		]

		const result = await ctx.processor.processStream(createStream(chunks))

		expect(result.didReceiveUsageChunk).to.be.true
		expect(ctx.processor.getUsageSnapshot()).to.deep.equal({
			inputTokens: 4,
			outputTokens: 6,
			cacheWriteTokens: 0,
			cacheReadTokens: 1,
			totalCost: undefined,
		})
		expect(ctx.taskState.assistantMessageContent).to.have.lengthOf(1)
		const finalizedBlock = ctx.taskState.assistantMessageContent[0] as any
		expect(finalizedBlock.partial).to.be.false
		expect(finalizedBlock.name).to.equal(ClineDefaultTool.FILE_READ)
		expect(ctx.presentStub.callCount).to.equal(2)
	})
})
