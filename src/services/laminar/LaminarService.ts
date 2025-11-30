import { Laminar, LaminarAttributes, Span } from "@lmnr-ai/lmnr"
import * as vscode from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import { Setting } from "@/shared/proto/index.host"
import { laminarConfig } from "@/shared/services/config/laminar-config"
import { LaminarClientProvider } from "./LaminarClientProvider"

type SpanType = "LLM" | "DEFAULT" | "TOOL"

interface TelemetrySettings {
	extensionEnabled: boolean
	hostEnabled: boolean
	level: "all" | "error" | "crash" | "off"
}

/**
 * Laminar Observability Service
 * Provides LLM tracing and observability using Laminar
 * This is NOT a telemetry provider - it's specifically for LLM observability
 */
export class LaminarService {
	private static _instance: LaminarService | null = null
	private telemetrySettings: TelemetrySettings
	private userId?: string
	private recordIO: boolean
	private spans = new Map<string, Span>()
	private isInitialized: boolean = false
	private isServiceInitialized: boolean = false

	private constructor() {
		this.recordIO = laminarConfig.recordIO ?? false
		this.isInitialized = LaminarClientProvider.isInitialized()

		this.telemetrySettings = {
			extensionEnabled: true,
			hostEnabled: true,
			level: "all",
		}
	}

	public static getInstance(): LaminarService {
		if (!LaminarService._instance) {
			LaminarService._instance = new LaminarService()
		}
		return LaminarService._instance
	}

	public async initialize(): Promise<LaminarService> {
		if (this.isServiceInitialized) {
			return this
		}

		// VSCode settings
		HostProvider.env.subscribeToTelemetrySettings(
			{},
			{
				onResponse: (event: { isEnabled: Setting }) => {
					const hostEnabled = event.isEnabled === Setting.ENABLED || event.isEnabled === Setting.UNSUPPORTED
					this.telemetrySettings.hostEnabled = hostEnabled
				},
			},
		)

		const hostSettings = await HostProvider.env.getTelemetrySettings({})
		if (hostSettings.isEnabled === Setting.DISABLED) {
			this.telemetrySettings.hostEnabled = false
		}

		this.telemetrySettings.level = await this.getTelemetryLevel()
		this.isServiceInitialized = true
		return this
	}

	/**
	 * Set user ID directly
	 */
	public setUserId(userId: string): void {
		this.userId = userId
	}

	/**
	 * Set extension-specific opt-in status
	 */
	public setOptIn(optIn: boolean): void {
		this.telemetrySettings.extensionEnabled = optIn
	}

	/**
	 * Check if Laminar observability is enabled
	 * Respects both extension and host telemetry settings
	 */
	public isEnabled(): boolean {
		// return this.isInitialized && this.telemetrySettings.extensionEnabled && this.telemetrySettings.hostEnabled
		return this.isInitialized
	}

	// ==================== Span Management API ====================

	/**
	 * Get a span by its key
	 */
	public getSpan(key: string): Span | undefined {
		return this.spans.get(key)
	}

	/**
	 * Start a new span for tracing
	 */
	public startSpan(
		spanKey: string,
		options: { name: string; spanType?: SpanType; input?: any; sessionId?: string },
		active?: boolean,
	): void {
        console.log('[Laminar] startSpan called:', spanKey, 'isEnabled:', this.isEnabled(), 'spanExists:', this.spans.has(spanKey))
        if (!this.isEnabled() || this.spans.has(spanKey)) {
            console.log('[Laminar] Span creation blocked:', { isEnabled: this.isEnabled(), exists: this.spans.has(spanKey) })
            return
		}

		const spanOptions = {
			name: options.name,
			spanType: options.spanType ?? "DEFAULT",
			sessionId: options.sessionId,
			userId: this.userId,
			...(this.recordIO && options.input && { input: options.input }),
		}

		const span = active ? Laminar.startActiveSpan(spanOptions) : Laminar.startSpan(spanOptions)
		this.spans.set(spanKey, span)
	}

	/**
	 * End a span by its key
	 */
	public endSpan(key: string): void {
		if (!this.isEnabled()) {
			return
		}

		const span = this.getSpan(key)
		if (span) {
			span.end()
			this.spans.delete(key)
		}
	}

	/**
	 * Add arbitrary attributes to a span
	 */
	public addAttributesToSpan(key: string, attributes: Record<string, any>): void {
		if (!this.isEnabled()) {
			return
		}

		const span = this.spans.get(key)
		if (span) {
			const { "lmnr.span.output": _output, ...rest } = attributes
			const filteredAttributes = this.recordIO ? attributes : rest

			span.setAttributes(filteredAttributes)
		}
	}

	/**
	 * Add LLM-specific attributes to a span (tokens, cost, model, etc.)
	 */
	public addLlmAttributesToSpan(
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
		if (!this.isEnabled()) {
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

	/**
	 * Record an exception on a span
	 */
	public recordExceptionOnSpan(key: string, error: Error): void {
		if (!this.isEnabled()) {
			return
		}

		const span = this.spans.get(key)
		if (span && this.recordIO) {
			span.recordException(error)
		}
	}

	/**
	 * Clean up resources when the service is disposed
	 */
	public async dispose(): Promise<void> {
		if (!this.isInitialized) {
			return
		}

		// Close any open spans
		for (const [key, span] of this.spans.entries()) {
			try {
				span.end()
			} catch (error) {
				console.error(`Error ending span ${key}:`, error)
			}
		}
		this.spans.clear()

		// Shutdown Laminar client
		try {
			await Laminar.shutdown()
		} catch (error) {
			console.error("Error shutting down Laminar client:", error)
		}
	}

	/**
	 * Get the current telemetry level from VS Code settings
	 */
	private async getTelemetryLevel(): Promise<TelemetrySettings["level"]> {
		const hostSettings = await HostProvider.env.getTelemetrySettings({})
		if (hostSettings.isEnabled === Setting.DISABLED) {
			return "off"
		}
		const config = vscode.workspace.getConfiguration("telemetry")
		return config?.get<TelemetrySettings["level"]>("telemetryLevel") || "all"
	}
}

export const laminarService = LaminarService.getInstance()
