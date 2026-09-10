import { registerDisposable } from "@cline/shared";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
	propagateAttributes,
	setLangfuseTracerProvider,
} from "@langfuse/tracing";
import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { registerTelemetry } from "ai";

export type LangfuseDirectTelemetryConfig = {
	mode: "direct";
	baseUrl?: string;
	publicKey?: string;
	secretKey?: string;
};

export type LangfuseCollectorTelemetryConfig = {
	mode: "collector";
};

export type LangfuseTelemetryConfig =
	| LangfuseDirectTelemetryConfig
	| LangfuseCollectorTelemetryConfig;

type ResolvedLangfuseTelemetryConfig = Required<
	Omit<LangfuseDirectTelemetryConfig, "mode">
>;

export type LangfuseTraceAttributes = {
	userId?: string;
	sessionId?: string;
	tags?: string[];
	metadata?: Record<string, string>;
	traceName?: string;
};

/** A Langfuse processor ready for a host-owned OpenTelemetry provider. */
export interface LangfuseTelemetryIntegration {
	readonly spanProcessor: LangfuseSpanProcessor;
}

const LANGFUSE_DEBUG_ENV = "CLINE_DEBUG_LANGFUSE";
type LangfuseTelemetryState = "unconfigured" | "active" | "disabled";
let langfuseTelemetryState: LangfuseTelemetryState = "unconfigured";
let standaloneTracerProvider: NodeTracerProvider | undefined;
let aiSdkIntegrationRegistered = false;
let standaloneDisposableRegistered = false;

function readLangfuseTelemetryConfig(
	config?: LangfuseDirectTelemetryConfig,
): ResolvedLangfuseTelemetryConfig | undefined {
	const baseUrl =
		config?.baseUrl?.trim() || process.env.LANGFUSE_BASE_URL?.trim();
	const publicKey =
		config?.publicKey?.trim() || process.env.LANGFUSE_PUBLIC_KEY?.trim();
	const secretKey =
		config?.secretKey?.trim() || process.env.LANGFUSE_SECRET_KEY?.trim();
	if (!baseUrl || !publicKey || !secretKey) return undefined;
	return { baseUrl, publicKey, secretKey };
}

export function hasLangfuseTelemetryConfig(
	config?: LangfuseDirectTelemetryConfig,
): boolean {
	return readLangfuseTelemetryConfig(config) !== undefined;
}

/**
 * Creates the Langfuse part of an OTel pipeline without claiming the global
 * provider. Cline hosts install this processor while constructing their
 * existing provider.
 */
export function createLangfuseTelemetryIntegration(
	config?: LangfuseDirectTelemetryConfig,
): LangfuseTelemetryIntegration | undefined {
	const resolved = readLangfuseTelemetryConfig(config);
	if (!resolved) return undefined;
	return { spanProcessor: new LangfuseSpanProcessor(resolved) };
}

/**
 * Activate AI SDK telemetry after either a direct processor or a collector
 * export path has been configured by the host.
 */
export function activateLangfuseTelemetry(): void {
	langfuseTelemetryState = "active";
	if (!aiSdkIntegrationRegistered) {
		registerTelemetry(new LangfuseVercelAiSdkIntegration());
		aiSdkIntegrationRegistered = true;
	}
}

/** Prevent standalone discovery when the Cline host disabled telemetry. */
export function disableLangfuseTelemetry(): void {
	langfuseTelemetryState = "disabled";
}

export async function withLangfuseTraceAttributes<T>(
	enabled: boolean,
	attributes: LangfuseTraceAttributes,
	callback: () => T | Promise<T>,
): Promise<T> {
	if (!enabled) return await callback();
	return await propagateAttributes(attributes, callback);
}

/**
 * Standalone fallback for direct `@cline/llms` use. Full Cline hosts activate
 * their injected integration first, so this never creates a competing provider
 * in those processes.
 */
export async function ensureLangfuseTelemetry(
	_providerId: string,
): Promise<boolean> {
	if (langfuseTelemetryState === "active") return true;
	if (langfuseTelemetryState === "disabled") return false;
	const integration = createLangfuseTelemetryIntegration();
	if (!integration) return false;

	try {
		if (!process.env.OTEL_SERVICE_NAME?.trim()) {
			process.env.OTEL_SERVICE_NAME = "cline-sdk";
		}
		const provider = new NodeTracerProvider({
			spanProcessors: [integration.spanProcessor],
		});
		setLangfuseTracerProvider(provider);
		standaloneTracerProvider = provider;
		activateLangfuseTelemetry();
		if (!standaloneDisposableRegistered) {
			registerDisposable(disposeLangfuseTelemetry);
			standaloneDisposableRegistered = true;
		}
		debugLangfuse("initialized isolated standalone tracer provider");
		return true;
	} catch (error) {
		debugLangfuse(
			`initialization failed error=${error instanceof Error ? error.message : String(error)}`,
		);
		return false;
	}
}

/** Dispose only the provider created by the standalone fallback. */
export async function disposeLangfuseTelemetry(): Promise<void> {
	const provider = standaloneTracerProvider;
	standaloneTracerProvider = undefined;
	if (!provider) return;
	try {
		await provider.forceFlush();
		await provider.shutdown();
		setLangfuseTracerProvider(null);
		langfuseTelemetryState = "unconfigured";
		debugLangfuse("standalone provider shutdown completed");
	} catch (error) {
		debugLangfuse(
			`shutdown failed error=${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export function debugLangfuse(message: string): void {
	if (!isLangfuseDebugEnabled()) return;
	console.warn(`[langfuse-debug] ${message}`);
}

function isLangfuseDebugEnabled(): boolean {
	const raw = process.env[LANGFUSE_DEBUG_ENV];
	if (!raw) return false;
	const normalized = raw.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function resetLangfuseTelemetryForTests(): void {
	langfuseTelemetryState = "unconfigured";
	standaloneTracerProvider = undefined;
	aiSdkIntegrationRegistered = false;
	standaloneDisposableRegistered = false;
	setLangfuseTracerProvider(null);
}
