import { Laminar, LaminarAttributes, Span } from "@lmnr-ai/lmnr"
import * as vscode from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import { Setting } from "@/shared/proto/index.host"
import { laminarConfig, isLaminarConfigValid } from "@/shared/services/config/laminar-config"

type SpanType = "LLM" | "DEFAULT" | "TOOL"

interface TelemetrySettings {
	extensionEnabled: boolean
	hostEnabled: boolean
	level: "all" | "error" | "crash" | "off"
}

export class LaminarService {
	private static instance: LaminarService | null = null
	private telemetrySettings: TelemetrySettings
	private userId?: string
	private recordIO: boolean
	private spans = new Map<string, Span>()
	private isInitialized: boolean = false

	private constructor() {
		this.recordIO = laminarConfig.recordIO ?? false
		this.telemetrySettings = {
			extensionEnabled: true,
			hostEnabled: true,
			level: "all",
		}
	}

	public static getInstance(): LaminarService {
		if (!LaminarService.instance) {
			LaminarService.instance = new LaminarService()
		}
		return LaminarService.instance
	}

	public async initialize(): Promise<LaminarService> {
		if (this.isInitialized) {
			return this
		}

		if (!isLaminarConfigValid(laminarConfig)) {
			console.log("[Laminar] API key not found. Laminar observability will be disabled.")
			return this
		}

		try {
			Laminar.initialize({
				projectApiKey: laminarConfig.apiKey,
			})
			console.info("[Laminar] SDK initialized successfully")
		} catch (error) {
			console.error(`[Laminar] Failed to initialize SDK: ${error instanceof Error ? error.message : String(error)}`)
			return this
		}

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
		this.isInitialized = true
		return this
	}

	public setUserId(userId: string): void {
		this.userId = userId
	}

	public setOptIn(optIn: boolean): void {
		this.telemetrySettings.extensionEnabled = optIn
	}

	public isEnabled(): boolean {
		return this.isInitialized
	}

	public getSpan(key: string): Span | undefined {
		return this.spans.get(key)
	}

	public startSpan(
		spanKey: string,
		options: { name: string; spanType?: SpanType; input?: any; sessionId?: string },
		active?: boolean,
	): void {
		if (!this.isEnabled() || this.spans.has(spanKey)) {
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

	public recordExceptionOnSpan(key: string, error: Error): void {
		if (!this.isEnabled()) {
			return
		}

		const span = this.spans.get(key)
		if (span && this.recordIO) {
			span.recordException(error)
		}
	}

	public async dispose(): Promise<void> {
		if (!this.isInitialized) {
			return
		}

		for (const [key, span] of this.spans.entries()) {
			try {
				span.end()
			} catch (error) {
				console.error(`Error ending span ${key}:`, error)
			}
		}
		this.spans.clear()

		try {
			await Laminar.shutdown()
			this.isInitialized = false
		} catch (error) {
			console.error("Error shutting down Laminar SDK:", error)
		}
	}

	private async getTelemetryLevel(): Promise<TelemetrySettings["level"]> {
		const hostSettings = await HostProvider.env.getTelemetrySettings({})
		if (hostSettings.isEnabled === Setting.DISABLED) {
			return "off"
		}
		const config = vscode.workspace.getConfiguration("telemetry")
		return config?.get<TelemetrySettings["level"]>("telemetryLevel") || "all"
	}
}

export function getLaminarService(): LaminarService {
	return LaminarService.getInstance()
}