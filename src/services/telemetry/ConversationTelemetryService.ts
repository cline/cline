import { context, SpanKind, trace } from "@opentelemetry/api"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { Resource } from "@opentelemetry/resources"
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base"
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node"
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions"
import { Anthropic } from "@anthropic-ai/sdk"
import * as vscode from "vscode"
import { ClineProvider } from "../../core/webview/ClineProvider"

export type TelemetryChatMessage = {
	role: "user" | "assistant" | "system"
	ts: number
	content: Anthropic.Messages.MessageParam["content"]
}

const { IS_DEV } = process.env

interface ConversationMetadata {
	apiProvider?: string
	model?: string
	tokensIn: number
	tokensOut: number
}

/**
 * Service for collecting conversation data using OpenTelemetry
 */
export class ConversationTelemetryService {
	private providerRef: WeakRef<ClineProvider>
	private distinctId: string = vscode.env.machineId
	private apiEndpoint: string = "https://api.cline.bot/v1/traces"
	private tracerProvider: NodeTracerProvider | undefined
	private tracer: any
	private messageIndices: Map<string, number> = new Map()

	constructor(provider: ClineProvider) {
		this.providerRef = new WeakRef(provider)
		this.initializeTracer()
	}

	private async getClineApiKey(): Promise<string | undefined> {
		const provider = this.providerRef.deref()
		if (!provider) {
			return undefined
		}
		const { apiConfiguration } = await provider.getStateToPostToWebview()
		return apiConfiguration?.clineApiKey
	}

	public isOptedInToConversationTelemetry(): boolean {
		// First check global telemetry level - telemetry should only be enabled when level is "all"
		const telemetryLevel = vscode.workspace.getConfiguration("telemetry").get<string>("telemetryLevel", "all")
		const isGlobalTelemetryEnabled = telemetryLevel === "all"

		// User has to manually opt in to conversation telemetry in Advanced Settings
		const isConversationTelemetryEnabled =
			vscode.workspace.getConfiguration("cline").get<boolean>("conversationTelemetry") ?? false

		// Currently only enabled in dev environment
		const isDevEnvironment = !!IS_DEV

		return isDevEnvironment && isGlobalTelemetryEnabled && isConversationTelemetryEnabled
	}

	private async initializeTracer() {
		try {
			// Create a resource that identifies our service
			const resource = new Resource({
				[ATTR_SERVICE_NAME]: "cline-extension",
				[ATTR_SERVICE_VERSION]: "1.0.0",
			})

			const clineApiKey = await this.getClineApiKey()

			console.log("[ConversationTelemetry] Initializing OpenTelemetry tracer...")

			// Configure the OTLP exporter
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			}

			// Add API key to headers if available
			if (clineApiKey) {
				headers["Authorization"] = `Bearer ${clineApiKey}`
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

			console.log("[ConversationTelemetry] OpenTelemetry tracer initialized successfully")
		} catch (error) {
			console.error("[ConversationTelemetry] Failed to initialize OpenTelemetry tracer:", error)
		}
	}

	/**
	 * Captures a message in the conversation as an OpenTelemetry span
	 * ONLY HAPPENS IF USER IS OPTED INTO CONVERSATION TELEMETRY IN ADVANCED SETTINGS
	 */
	public async captureMessage(taskId: string, message: TelemetryChatMessage, metadata: ConversationMetadata) {
		// Do NOT capture message if user has not explicitly opted in
		if (!this.isOptedInToConversationTelemetry()) {
			return
		}

		if (!this.tracer) {
			return
		}

		try {
			// Convert taskId to a valid trace ID (must be 32 hex chars)
			const traceId = this.generateTraceIdFromTimestamp(taskId)

			// Convert message timestamp to a valid span ID (must be 16 hex chars)
			if (!message.ts && message.ts !== 0) {
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
					startTime: this.millisecondsToHrTime(timestamp), // Convert to nanoseconds
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

			const c = message.content

			// Add Braintrust-compatible attributes
			span.setAttribute("gen_ai.request.model", metadata.model)

			if (message.role === "user") {
				span.setAttribute("gen_ai.prompt", this.extractContent(message))
			} else if (message.role === "assistant") {
				span.setAttribute("gen_ai.completion", this.extractContent(message))
				span.setAttribute("gen_ai.usage.prompt_tokens", metadata.tokensIn)
				span.setAttribute("gen_ai.usage.completion_tokens", metadata.tokensOut)
			} else if (message.role === "system") {
				span.setAttribute("gen_ai.system_prompt", this.extractContent(message))
			}

			// Add custom metadata in Braintrust format
			span.setAttribute("braintrust.metadata.api_provider", metadata.apiProvider)
			span.setAttribute("braintrust.metadata.ts", message.ts)

			// End the span immediately since messages are discrete events
			span.end(this.millisecondsToHrTime(timestamp)) // Convert to nanoseconds

			console.log(`[ConversationTelemetry] Captured ${message.role} message for task ${taskId}`, { span })
		} catch (error) {
			console.error("[ConversationTelemetry] Error capturing message:", error)
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
	 * Converts milliseconds to high-resolution time format expected by OpenTelemetry
	 * Returns [seconds, nanoseconds]
	 */
	private millisecondsToHrTime(milliseconds: number): [number, number] {
		return [
			Math.floor(milliseconds / 1000), // seconds
			(milliseconds % 1000) * 1000000, // nanoseconds (remainder in ms * 10^6)
		]
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
	private extractContent(message: TelemetryChatMessage): string {
		if (typeof message.content === "string") {
			return message.content
		}

		return message.content
			.map((block) => (block.type === "text" ? block.text : null))
			.filter(Boolean)
			.join("\n")
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
	 * Sends conversation data to cleanup endpoint to remove deleted messages from telemetry
	 * ONLY HAPPENS IF USER IS OPTED INTO CONVERSATION TELEMETRY IN ADVANCED SETTINGS
	 */
	public async cleanupTask(taskId: string, conversationData: any): Promise<void> {
		// Do NOT send data if user has not explicitly opted in
		if (!this.isOptedInToConversationTelemetry()) {
			return
		}

		const clineApiKey = await this.getClineApiKey()
		if (!clineApiKey) {
			return
		}

		try {
			// Configure the headers with API key
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			}

			// Add API key to headers
			headers["Authorization"] = `Bearer ${clineApiKey}`

			// Send the data to the cleanup endpoint
			const cleanupEndpoint = `${this.apiEndpoint.replace("/traces", "/traces/cleanup")}`

			// Use fetch API to send the data
			const response = await fetch(cleanupEndpoint, {
				method: "POST",
				headers,
				body: JSON.stringify({
					taskId: taskId,
					conversationData,
					userId: this.distinctId,
				}),
			})

			if (!response.ok) {
				throw new Error(`Failed to send cleanup data: ${response.status} ${response.statusText}`)
			}

			console.log(`[ConversationTelemetry] Cleanup data sent for task ${taskId}`)
		} catch (error) {
			console.error("[ConversationTelemetry] Error sending cleanup data:", error)
		}
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
