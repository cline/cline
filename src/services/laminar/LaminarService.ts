import { Laminar, LaminarAttributes, observe, observeDecorator, Span } from "@lmnr-ai/lmnr"
import { laminarConfig } from "@shared/services/config/laminar-config"
import { Logger } from "@/services/logging/Logger"

type SpanType = "LLM" | "DEFAULT" | "TOOL"

class LaminarService {
	private static instance: LaminarService | undefined
	private enabled: boolean = false
	private isInitialized: boolean = false
	private recordSpanIO: boolean = false
	private userId?: string
	private spans = new Map<string, Span>()

	private constructor() {}

	static getInstance(): LaminarService {
		if (!LaminarService.instance) {
			LaminarService.instance = new LaminarService()
		}
		return LaminarService.instance
	}

	async initialize(): Promise<void> {
		if (this.isInitialized) {
			return
		}

		this.enabled = laminarConfig.enabled ?? false

		try {
			Laminar.initialize({
				projectApiKey: laminarConfig.apiKey,
			})

			this.isInitialized = true
			this.recordSpanIO = laminarConfig.recordIO ?? false

			console.info("Laminar instrumentation initialized successfully")
		} catch (error) {
			Logger.error(`Failed to initialize Laminar: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	updateTelemetryState(isOptedIn: boolean): void {
		this.enabled = isOptedIn
		console.info("Laminar telemetry state updated:", this.enabled)
	}

	setUserId(userId: string): void {
		this.userId = userId
	}

	getSpan(key: string) {
		return this.spans.get(key)
	}

	// Start a span and keep track of it in the spans map
	// We expose this convenience method and track spans in the spans map so that manual spans can be freely started and ended in different parts of the codebase
	// without passing around the span object.
	//
	// Use this method when you want to manually start and end spans. To instrument a full function prefer to use observeDecorator.
	//
	// If Laminar is not initialized or the span with the same key already running (i.e. it was not ended), this method will do nothing.
	//
	// @param spanKey - The key to use to store the span in the spans map
	// @param options - The options to pass to the span, such as the name, input, sessionId, and spanType. If spanType is not provided, it will default to "DEFAULT".
	// @param active - Whether the span should be active. Active span is a powerful feature which sets all spans that are started after it to be children of
	// 				   the active span without the need to wrap functions in observe wrapper.
	//

	startSpan(
		spanKey: string,
		options: { name: string; spanType?: SpanType; input?: any; sessionId?: string },
		active?: boolean,
	): void {
		if (!this.enabled || this.spans.has(spanKey)) {
			return
		}

		const spanOptions = {
			name: options.name,
			spanType: options.spanType ?? "DEFAULT",
			sessionId: options.sessionId,
			userId: this.userId,
			...(this.recordSpanIO && options.input && { input: options.input }),
		}

		const span = active ? Laminar.startActiveSpan(spanOptions) : Laminar.startSpan(spanOptions)
		this.spans.set(spanKey, span)
	}

	endSpan(key: string): void {
		if (!this.enabled) {
			return
		}

		const span = this.getSpan(key)
		if (span) {
			span.end()
			this.spans.delete(key)
		}
	}

	addAttributesToSpan(key: string, attributes: Record<string, any>): void {
		if (!this.enabled) {
			return
		}

		const span = this.spans.get(key)
		if (span) {
			const { "lmnr.span.output": _output, ...rest } = attributes
			const filteredAttributes = this.recordSpanIO ? attributes : rest

			span.setAttributes(filteredAttributes)
		}
	}

	addLlmAttributesToSpan(
		key: string,
		attributes: {
			inputTokens: number
			outputTokens: number
			totalCost: number
			modelId: string
			providerId: string
			cacheWriteTokens: number
			cacheReadTokens: number
		},
	): void {
		if (!this.enabled) {
			return
		}

		const span = this.spans.get(key)
		if (span) {
			span.setAttributes({
				[LaminarAttributes.INPUT_TOKEN_COUNT]: attributes.inputTokens,
				[LaminarAttributes.OUTPUT_TOKEN_COUNT]: attributes.outputTokens,
				[LaminarAttributes.TOTAL_COST]: attributes.totalCost,
				[LaminarAttributes.REQUEST_MODEL]: attributes.modelId,
				[LaminarAttributes.PROVIDER]: attributes.providerId,
				"gen_ai.usage.cache_creation_input_tokens": attributes.cacheWriteTokens,
				"gen_ai.usage.cache_read_input_tokens": attributes.cacheReadTokens,
			})
		}
	}

	recordExceptionOnSpan(key: string, error: Error): void {
		if (!this.enabled) {
			return
		}

		const span = this.spans.get(key)
		if (span && this.recordSpanIO) {
			span.recordException(error)
		}
	}
}

const laminarService = LaminarService.getInstance()

export default laminarService

export { observeDecorator, observe, LaminarAttributes }
