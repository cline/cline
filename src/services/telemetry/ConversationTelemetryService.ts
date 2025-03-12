import { trace, context, SpanKind, SpanStatusCode } from "@opentelemetry/api"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { Resource } from "@opentelemetry/resources"
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base"
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node"
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions"
import * as vscode from "vscode"

interface ConversationMetadata {
	apiProvider: string
	model: string
	tokensIn: number
	tokensOut: number
}

/**
 * Service for collecting conversation data using OpenTelemetry
 */
export class ConversationTelemetryService {
	private static instance: ConversationTelemetryService
	private enabled: boolean = false
	private distinctId: string
	private clineApiKey?: string
	private apiEndpoint: string = "http://localhost:8100/v1/traces"
	private tracerProvider: NodeTracerProvider | undefined
	private tracer: any
	private messageIndices: Map<string, number> = new Map()

	private constructor(distinctId: string) {
		this.distinctId = distinctId
	}

	public static getInstance(distinctId: string): ConversationTelemetryService {
		if (!ConversationTelemetryService.instance) {
			ConversationTelemetryService.instance = new ConversationTelemetryService(distinctId)
		}
		return ConversationTelemetryService.instance
	}

	public updateTelemetryState(enabled: boolean, clineApiKey?: string): void {
		// If state is changing from disabled to enabled, initialize the tracer
		if (!this.enabled && enabled) {
			this.initializeTracer()
		}

		this.enabled = enabled
		this.clineApiKey = clineApiKey
	}

	private initializeTracer(): void {
		try {
			// Create a resource that identifies our service
			const resource = new Resource({
				[ATTR_SERVICE_NAME]: "cline-extension",
				[ATTR_SERVICE_VERSION]: "1.0.0",
			})

			// Configure the OTLP exporter
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			}

			// Add API key to headers if available
			if (this.clineApiKey) {
				headers["Authorization"] = `Bearer ${this.clineApiKey}`
			}

			const exporter = new OTLPTraceExporter({
				url: this.apiEndpoint,
				headers,
			})

			// Create the span processor
			const spanProcessor = new SimpleSpanProcessor(exporter as any)

			// Create the trace provider with the span processor in the config
			this.tracerProvider = new NodeTracerProvider({
				resource,
				spanProcessors: [spanProcessor as any],
			})

			// Register the provider
			this.tracerProvider.register()

			// Get a tracer
			this.tracer = trace.getTracer("cline-conversation-tracer")

			console.log("OpenTelemetry tracer initialized successfully")
		} catch (error) {
			console.error("Failed to initialize OpenTelemetry tracer:", error)
		}
	}

	/**
	 * Captures a message in the conversation as an OpenTelemetry span
	 * ONLY HAPPENS IF USER IS OPTED INTO CONVERSATION TELEMETRY IN ADVANCED SETTINGS
	 */
	public captureMessage(taskId: string, message: any, metadata: ConversationMetadata): void {
		// Do NOT capture message if user has not explicitly opted in
		if (!this.enabled || !this.tracer) return

		try {
			// Convert taskId to a valid trace ID (must be 32 hex chars)
			const traceId = this.generateTraceIdFromTimestamp(taskId)

			// Convert message timestamp to a valid span ID (must be 16 hex chars)
			if (!message.ts) {
				throw new Error("Message timestamp is required")
			}

			const timestamp = message.ts
			const spanId = this.generateSpanIdFromTimestamp(timestamp)

			// Create a span context with our IDs
			const spanContext = trace.setSpanContext(context.active(), {
				traceId,
				spanId,
				isRemote: false,
				traceFlags: 1, // Sampled
			})

			// Start a new span with the context
			const span = this.tracer.startSpan(
				`message.${message.role}`,
				{
					kind: SpanKind.CLIENT,
					startTime: timestamp * 1000000, // Convert to nanoseconds
				},
				spanContext,
			)

			// Get the message index for this task
			const messageIndex = this.getNextMessageIndex(taskId)

			// Add attributes to the span
			span.setAttribute("task.id", taskId)
			span.setAttribute("user.id", this.distinctId)
			span.setAttribute("message.role", message.role)
			span.setAttribute("message.timestamp", timestamp)
			span.setAttribute("message.index", messageIndex)

			// Add Braintrust-compatible attributes
			span.setAttribute("gen_ai.request.model", metadata.model)

			if (message.role === "user") {
				span.setAttribute("gen_ai.prompt", this.extractContent(message))
			} else if (message.role === "assistant") {
				span.setAttribute("gen_ai.completion", this.extractContent(message))
				span.setAttribute("gen_ai.usage.prompt_tokens", metadata.tokensIn)
				span.setAttribute("gen_ai.usage.completion_tokens", metadata.tokensOut)
			}

			// Add custom metadata in Braintrust format
			span.setAttribute("braintrust.metadata.api_provider", metadata.apiProvider)

			// End the span immediately since messages are discrete events
			span.end(timestamp * 1000000) // Convert to nanoseconds

			console.log(`Captured ${message.role} message for task ${taskId}`, { span })
		} catch (error) {
			console.error("Error capturing message:", error)
		}
	}

	/**
	 * Convert a decimal timestamp to a valid trace ID (32 hex chars)
	 */
	private generateTraceIdFromTimestamp(timestamp: string): string {
		// Pad with zeros and convert to hex
		const hex = BigInt(timestamp).toString(16).padStart(32, "0")
		return hex.substring(0, 32) // Ensure it's exactly 32 chars
	}

	/**
	 * Convert a decimal timestamp to a valid span ID (16 hex chars)
	 */
	private generateSpanIdFromTimestamp(timestamp: number): string {
		// Pad with zeros and convert to hex
		const hex = BigInt(timestamp).toString(16).padStart(16, "0")
		return hex.substring(0, 16) // Ensure it's exactly 16 chars
	}

	/**
	 * Helper to extract content from different message formats
	 */
	private extractContent(message: any): string {
		if (typeof message.content === "string") {
			return message.content
		} else if (Array.isArray(message.content)) {
			return message.content
				.filter((block: any) => block.type === "text")
				.map((block: any) => block.text)
				.join("\n")
		}
		return ""
	}

	/**
	 * Track message indices per task
	 */
	private getNextMessageIndex(taskId: string): number {
		const currentIndex = this.messageIndices.get(taskId) || 0
		this.messageIndices.set(taskId, currentIndex + 1)
		return currentIndex
	}

	/**
	 * Shutdown the tracer provider
	 */
	public async shutdown(): Promise<void> {
		if (this.tracerProvider) {
			await this.tracerProvider.shutdown()
		}
	}
}

export const conversationTelemetryService = ConversationTelemetryService.getInstance(vscode.env.machineId)
