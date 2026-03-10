import { type ApiHandler, buildApiHandler } from "@core/api"
import type {
	ApiStream,
	ApiStreamChunk,
	ApiStreamTextChunk,
	ApiStreamThinkingChunk,
	ApiStreamToolCallsChunk,
	ApiStreamUsageChunk,
} from "@core/api/transform/stream"
import { getContextWindowInfo } from "@core/context/context-management/context-window-utils"
import { isNextGenModelFamily } from "@utils/model-utils"
import { ClineError, ClineErrorType } from "@/services/error/ClineError"
import type { ApiConfiguration } from "@/shared/api"
import type { Mode } from "@/shared/storage/types"

export interface InitialStreamRetryDecision {
	isAuthError: boolean
	isBalanceError: boolean
	shouldRetry: boolean
}

export type CoreLoopStatus = "continue" | "complete" | "failed"

export interface CoreLoopTurnResult<TInput, TOutput> {
	status: CoreLoopStatus
	nextInput?: TInput
	output?: TOutput
	error?: string
}

export interface CoreLoopParams<TInput, TOutput> {
	initialInput: TInput
	runTurn: (input: TInput, iteration: number) => Promise<CoreLoopTurnResult<TInput, TOutput>>
	shouldAbort?: () => boolean
}

export type CoreLoopResult<TOutput> =
	| { status: "complete"; output: TOutput }
	| { status: "failed"; error?: string }
	| { status: "aborted" }

export interface CoreStreamUsage {
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number
	totalCost?: number
}

export interface CoreStreamResult {
	requestId?: string
	assistantText: string
	assistantTextSignature?: string
	usage: CoreStreamUsage
	aborted: boolean
	interrupted: boolean
}

export interface CoreStreamParams {
	stream: ApiStream
	onUsageChunk?: (chunk: ApiStreamUsageChunk, state: CoreStreamResult) => Promise<void> | void
	onTextChunk?: (chunk: ApiStreamTextChunk, state: CoreStreamResult) => Promise<void> | void
	onToolCallChunk?: (chunk: ApiStreamToolCallsChunk, state: CoreStreamResult) => Promise<void> | void
	onReasoningChunk?: (chunk: ApiStreamThinkingChunk, state: CoreStreamResult) => Promise<void> | void
	onChunkProcessed?: (chunk: ApiStreamChunk, state: CoreStreamResult) => Promise<"break" | void> | "break" | void
	shouldAbort?: () => boolean
	onAbort?: (state: CoreStreamResult) => Promise<void> | void
}

export class CoreAgent {
	static readonly AUTO_CONDENSE_THRESHOLD = 0.75
	private apiHandler?: ApiHandler

	constructor(params?: { apiConfiguration: ApiConfiguration; mode: Mode }) {
		if (params) {
			this.apiHandler = buildApiHandler(params.apiConfiguration, params.mode)
		}
	}

	initializeApiHandler(apiConfiguration: ApiConfiguration, mode: Mode): ApiHandler {
		this.apiHandler = buildApiHandler(apiConfiguration, mode)
		return this.apiHandler
	}

	getApiHandler(): ApiHandler {
		if (!this.apiHandler) {
			throw new Error("CoreAgent API handler has not been initialized")
		}
		return this.apiHandler
	}

	getModel(): ReturnType<ApiHandler["getModel"]> {
		return this.getApiHandler().getModel()
	}

	createMessage(...args: Parameters<ApiHandler["createMessage"]>): ReturnType<ApiHandler["createMessage"]> {
		return this.getApiHandler().createMessage(...args)
	}

	abortCurrentRequest(): void {
		this.getApiHandler().abort?.()
	}

	getApiStreamUsage(): ReturnType<NonNullable<ApiHandler["getApiStreamUsage"]>> | undefined {
		return this.getApiHandler().getApiStreamUsage?.()
	}

	getLastRequestIdSafe(): string | undefined {
		const apiLike = this.getApiHandler() as Partial<{
			getLastRequestId: () => string | undefined
			lastGenerationId?: string
		}>
		return apiLike.getLastRequestId?.() ?? apiLike.lastGenerationId
	}

	async runLoop<TInput, TOutput>(params: CoreLoopParams<TInput, TOutput>): Promise<CoreLoopResult<TOutput>> {
		let iteration = 0
		let currentInput = params.initialInput

		while (!params.shouldAbort?.()) {
			iteration += 1
			const turn = await params.runTurn(currentInput, iteration)
			if (turn.status === "complete") {
				return { status: "complete", output: turn.output as TOutput }
			}
			if (turn.status === "failed") {
				return { status: "failed", error: turn.error }
			}
			currentInput = turn.nextInput as TInput
		}

		return { status: "aborted" }
	}

	async consumeStream(params: CoreStreamParams): Promise<CoreStreamResult> {
		const state: CoreStreamResult = {
			requestId: undefined,
			assistantText: "",
			assistantTextSignature: undefined,
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
				totalCost: undefined,
			},
			aborted: false,
			interrupted: false,
		}

		for await (const chunk of params.stream) {
			state.requestId = state.requestId ?? chunk.id

			switch (chunk.type) {
				case "usage":
					state.usage.inputTokens += chunk.inputTokens
					state.usage.outputTokens += chunk.outputTokens
					state.usage.cacheWriteTokens += chunk.cacheWriteTokens ?? 0
					state.usage.cacheReadTokens += chunk.cacheReadTokens ?? 0
					state.usage.totalCost = chunk.totalCost ?? state.usage.totalCost
					await params.onUsageChunk?.(chunk, state)
					break
				case "text":
					state.assistantText += chunk.text || ""
					state.assistantTextSignature = chunk.signature || state.assistantTextSignature
					await params.onTextChunk?.(chunk, state)
					break
				case "tool_calls":
					await params.onToolCallChunk?.(chunk, state)
					break
				case "reasoning":
					await params.onReasoningChunk?.(chunk, state)
					break
			}

			const shouldBreak = await params.onChunkProcessed?.(chunk, state)
			if (shouldBreak === "break") {
				state.interrupted = true
				break
			}

			if (params.shouldAbort?.()) {
				state.aborted = true
				await params.onAbort?.(state)
				break
			}
		}

		return state
	}

	isAutoCondenseEnabledForModel(useAutoCondense: boolean, modelId: string): boolean {
		return useAutoCondense && isNextGenModelFamily(modelId)
	}

	getAutoCondenseThresholdTokens(contextWindow: number, maxAllowedSize: number): number {
		const roundedThreshold = Math.floor(contextWindow * CoreAgent.AUTO_CONDENSE_THRESHOLD)
		return Math.min(roundedThreshold, maxAllowedSize)
	}

	shouldCompactBeforeNextRequest(
		previousRequestTotalTokens: number,
		api: ApiHandler,
		modelId: string,
		useAutoCondense: boolean,
	): boolean {
		const { contextWindow, maxAllowedSize } = getContextWindowInfo(api)
		if (this.isAutoCondenseEnabledForModel(useAutoCondense, modelId)) {
			const thresholdTokens = this.getAutoCondenseThresholdTokens(contextWindow, maxAllowedSize)
			return previousRequestTotalTokens >= thresholdTokens
		}

		return previousRequestTotalTokens >= maxAllowedSize
	}

	classifyInitialStreamRetry(error: unknown, providerId: string, modelId: string): InitialStreamRetryDecision {
		const parsedError = ClineError.transform(error, modelId, providerId)
		const isAuthError = parsedError.isErrorType(ClineErrorType.Auth)
		const isBalanceError = parsedError.isErrorType(ClineErrorType.Balance)
		return {
			isAuthError,
			isBalanceError,
			shouldRetry: !isAuthError && !isBalanceError,
		}
	}
}
