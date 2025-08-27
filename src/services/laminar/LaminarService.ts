import { Laminar, LaminarAttributes, observe, observeDecorator, Span } from "@lmnr-ai/lmnr"
import { laminarConfig } from "@shared/services/config/laminar-config"
import { Logger } from "@/services/logging/Logger"

type SpanType = "LLM" | "DEFAULT" | "TOOL"
type SpanKey = "agent" | "llm" | "tool"

class LaminarService {
	private static instance: LaminarService | undefined
	private enabled = false
	private recordIO = false
	private userId?: string
	private spans = new Map<SpanKey, Span>()

	private constructor() {}

	static getInstance(): LaminarService {
		if (!LaminarService.instance) {
			LaminarService.instance = new LaminarService()
		}
		return LaminarService.instance
	}

	async initialize(): Promise<void> {
		try {
			Laminar.initialize({
				projectApiKey: laminarConfig.apiKey,
			})

			this.enabled = true
			this.recordIO = laminarConfig.recordIO ?? false

			console.info("Laminar instrumentation initialized successfully")
		} catch (error) {
			Logger.error(`Failed to initialize Laminar: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	setUserId(userId: string): void {
		this.userId = userId
	}

	getSpan(key: SpanKey) {
		return this.spans.get(key)
	}

	createSpan(options: { name: string; input?: any; spanType?: SpanType; sessionId?: string }, active?: boolean) {
		if (!this.enabled) {
			return
		}

		const spanOptions = {
			name: options.name,
			spanType: options.spanType,
			sessionId: options.sessionId,
			userId: this.userId,
			...(this.recordIO && options.input && { input: options.input }),
		}

		return active ? Laminar.startActiveSpan(spanOptions) : Laminar.startSpan(spanOptions)
	}

	startSpan(spanKey: SpanKey, options: { name: string; input?: any; sessionId?: string }, active?: boolean): Span | undefined {
		const spanTypeMap: Record<SpanKey, SpanType> = {
			agent: "DEFAULT",
			llm: "LLM",
			tool: "TOOL",
		}

		const span = this.createSpan(
			{
				name: options.name,
				input: options.input,
				sessionId: options.sessionId,
				spanType: spanTypeMap[spanKey],
			},
			active,
		)

		if (span) {
			this.spans.set(spanKey, span)
		}

		return span
	}

	endSpan(key: SpanKey): void {
		const span = this.getSpan(key)
		if (this.enabled && span) {
			this.spans.delete(key)
			span.end()
		}
	}

	addAttributes(key: SpanKey, attributes: Record<string, any>): void {
		const span = this.spans.get(key)
		if (this.enabled && span) {
			const { "lmnr.span.output": output, ...rest } = attributes
			const filteredAttributes = this.recordIO ? attributes : rest

			span.setAttributes(filteredAttributes)
		}
	}

	recordException(key: SpanKey, error: Error): void {
		const span = this.spans.get(key)
		if (this.enabled && span) {
			span.recordException(error)
		}
	}
}

const laminarService = LaminarService.getInstance()

export default laminarService

export { observeDecorator, observe, LaminarAttributes }
