import { Laminar, LaminarAttributes, observe, observeDecorator, Span } from "@lmnr-ai/lmnr"
import { laminarConfig } from "@shared/services/config/laminar-config"
import { Logger } from "@/services/logging/Logger"

export class LaminarService {
	private static instance: LaminarService | undefined
	private enabled = false
	private recordInputs = false
	private userId?: string
	public agentSpan?: Span = undefined
	public llmSpan?: Span = undefined
	public shouldEndAgentSpan?: boolean = false

	private constructor() {}

	static getInstance(): LaminarService {
		if (!LaminarService.instance) {
			LaminarService.instance = new LaminarService()
		}
		return LaminarService.instance
	}

	setUserId(userId: string): void {
		this.userId = userId
	}

	async initialize(): Promise<void> {
		try {
			Laminar.initialize({
				projectApiKey: laminarConfig.apiKey,
			})
			this.enabled = true

			if (laminarConfig.recordInputs) {
				this.recordInputs = laminarConfig.recordInputs
			}
			console.info("Laminar instrumentation initialized successfully")
		} catch (error) {
			Logger.error(`Failed to initialize Laminar: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	startSpan(options: { name: string; input?: any; spanType?: "LLM" | "DEFAULT" | "TOOL"; sessionId?: string }) {
		if (!this.enabled) {
			return
		}

		const spanOptions = {
			name: options.name,
			spanType: options.spanType,
			sessionId: options.sessionId,
			userId: this.userId,
			...(this.recordInputs && options.input && { input: options.input }),
		}

		return Laminar.startSpan(spanOptions)
	}

	startActiveSpan(options: { name: string; input?: any; spanType?: "LLM" | "DEFAULT" | "TOOL"; sessionId?: string }) {
		if (!this.enabled) {
			return
		}
		const spanOptions = {
			name: options.name,
			spanType: options.spanType,
			sessionId: options.sessionId,
			userId: this.userId,
			...(this.recordInputs && options.input && { input: options.input }),
		}

		return Laminar.startActiveSpan(spanOptions)
	}

	startLlmSpan(options: { name: string; input?: any; spanType?: "LLM" | "DEFAULT" | "TOOL"; sessionId?: string }) {
		if (!this.enabled) {
			return
		}

		this.llmSpan = Laminar.startSpan(options)
	}

	endLlmSpan(): void {
		const llmSpan = this.llmSpan
		if (llmSpan) {
			this.endSpan(llmSpan)
		}
		this.llmSpan = undefined
	}

	endAgentSpan(): void {
		const agentSpan = this.agentSpan
		if (agentSpan) {
			this.endSpan(agentSpan)
			this.agentSpan = undefined
		}
	}

	addSpanAttributes(attributes: Record<string, any>, span?: Span): void {
		if (!this.enabled || !span) {
			return
		}
		span.setAttributes(attributes)
	}

	recordException(span: Span, error: Error): void {
		if (!this.enabled) {
			return
		}
		span.recordException(error)
	}

	endSpan(span: Span): void {
		if (!this.enabled) {
			return
		}
		span.end()
	}
}

export const laminarService = LaminarService.getInstance()

export { observeDecorator, observe, LaminarAttributes }
