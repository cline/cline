import {
	type GatewayManagedTelemetryConfig,
	isClineProvider,
} from "@cline/shared";
import type { Telemetry } from "ai";

type DirectLangfuseTelemetryConfig = {
	baseUrl: string;
	publicKey: string;
	secretKey: string;
};

type DirectLangfuseTelemetryRuntime = {
	integration: Telemetry;
	tracerProvider: {
		forceFlush(): Promise<void>;
		shutdown(): Promise<void>;
	};
};

export type LangfuseTraceAttributes = {
	userId?: string;
	sessionId?: string;
	tags?: string[];
	metadata?: Record<string, string>;
	traceName?: string;
};

/**
 * Set Langfuse trace-level attributes for the duration of an SDK operation.
 * Runtime context is useful observation metadata, but Langfuse's Sessions and
 * Users views are indexed from propagated trace attributes instead.
 */
export async function withLangfuseTraceAttributes<T>(
	enabled: boolean,
	attributes: LangfuseTraceAttributes,
	callback: () => T | Promise<T>,
): Promise<T> {
	if (!enabled) {
		return await callback();
	}

	const { propagateAttributes } = await import("@langfuse/tracing");
	return await propagateAttributes(attributes, callback);
}

const LANGFUSE_DEBUG_ENV = "CLINE_DEBUG_LANGFUSE";

let managedLangfuseIntegrationPromise:
	| Promise<Telemetry | undefined>
	| undefined;
let directLangfuseRuntimes = new Map<
	string,
	Promise<DirectLangfuseTelemetryRuntime | undefined>
>();
let directLangfuseDisposableRegistration: Promise<void> | undefined;
let langfuseContextManagerInitialization: Promise<void> | undefined;

function readDirectLangfuseTelemetryConfig():
	| DirectLangfuseTelemetryConfig
	| undefined {
	const baseUrl = process.env.LANGFUSE_BASE_URL?.trim();
	const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim();
	const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim();

	if (!baseUrl || !publicKey || !secretKey) {
		return undefined;
	}

	return { baseUrl, publicKey, secretKey };
}

function isManagedClineLangfuseBuildEnabled(): boolean {
	const raw = process.env.CLINE_PROVIDER_LANGFUSE_ENABLED;
	if (!raw) {
		return false;
	}
	const normalized = raw.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes";
}

/**
 * Resolve the AI SDK v7 Langfuse integration for one provider call.
 *
 * Cline/ClinePass managed telemetry never creates a Langfuse exporter in the
 * client. It emits Langfuse-compatible spans through the process's existing
 * global OTLP tracer, whose collector owns the Langfuse credentials. Generic
 * `LANGFUSE_*` configuration retains the standalone direct-export path for SDK
 * consumers and is also the Cline-provider fallback when managed telemetry was
 * not requested.
 */
export async function ensureLangfuseTelemetry(
	providerId: string,
	managedTelemetry?: GatewayManagedTelemetryConfig,
	managedTelemetryAllowed = true,
): Promise<Telemetry | undefined> {
	if (isClineProvider(providerId) && managedTelemetry?.langfuse === true) {
		if (!managedTelemetryAllowed) {
			debugLangfuse(
				`managed telemetry disabled by host policy provider=${providerId}`,
			);
			return undefined;
		}
		if (!isManagedClineLangfuseBuildEnabled()) {
			debugLangfuse(
				`managed telemetry requested without build capability provider=${providerId}`,
			);
			return undefined;
		}
		return await ensureManagedLangfuseIntegration(providerId);
	}

	const config = readDirectLangfuseTelemetryConfig();
	if (!config) {
		debugLangfuse(`direct configuration missing provider=${providerId}`);
		return undefined;
	}

	return await ensureDirectLangfuseIntegration(providerId, config);
}

async function ensureManagedLangfuseIntegration(
	providerId: string,
): Promise<Telemetry | undefined> {
	if (!managedLangfuseIntegrationPromise) {
		managedLangfuseIntegrationPromise = initializeManagedLangfuseIntegration();
	}

	const pending = managedLangfuseIntegrationPromise;
	const integration = await pending;
	if (!integration && managedLangfuseIntegrationPromise === pending) {
		// The host may register its OTEL provider after an early request. Do not
		// permanently cache that timing failure.
		managedLangfuseIntegrationPromise = undefined;
	}
	debugLangfuse(
		`resolved managed integration=${String(Boolean(integration))} provider=${providerId}`,
	);
	return integration;
}

async function initializeManagedLangfuseIntegration(): Promise<
	Telemetry | undefined
> {
	try {
		await ensureLangfuseContextManager();
		const [{ trace }, { LangfuseVercelAiSdkIntegration }] = await Promise.all([
			import("@opentelemetry/api"),
			import("@langfuse/vercel-ai-sdk"),
		]);

		if (!hasActiveTracerProvider(trace)) {
			debugLangfuse("managed OTLP tracer provider is not active");
			return undefined;
		}

		const integration = new LangfuseVercelAiSdkIntegration({
			tracer: trace.getTracer("cline-provider-langfuse"),
		});
		debugLangfuse("created managed integration using global OTLP tracer");
		return integration;
	} catch (error) {
		debugLangfuse(
			`managed initialization failed error=${error instanceof Error ? error.message : String(error)}`,
		);
		return undefined;
	}
}

async function ensureDirectLangfuseIntegration(
	providerId: string,
	config: DirectLangfuseTelemetryConfig,
): Promise<Telemetry | undefined> {
	const configKey = JSON.stringify(config);
	let runtimePromise = directLangfuseRuntimes.get(configKey);
	if (!runtimePromise) {
		runtimePromise = registerDirectLangfuseDisposable().then(
			async () => await initializeDirectLangfuseTelemetry(config),
		);
		directLangfuseRuntimes.set(configKey, runtimePromise);
	}

	const runtime = await runtimePromise;
	if (!runtime && directLangfuseRuntimes.get(configKey) === runtimePromise) {
		directLangfuseRuntimes.delete(configKey);
	}
	debugLangfuse(
		`resolved direct integration=${String(Boolean(runtime))} provider=${providerId}`,
	);
	return runtime?.integration;
}

async function registerDirectLangfuseDisposable(): Promise<void> {
	if (!directLangfuseDisposableRegistration) {
		directLangfuseDisposableRegistration = import("@cline/shared").then(
			({ registerDisposable }) => {
				registerDisposable(disposeLangfuseTelemetry);
			},
		);
	}
	await directLangfuseDisposableRegistration;
}

async function ensureLangfuseContextManager(): Promise<void> {
	if (!langfuseContextManagerInitialization) {
		langfuseContextManagerInitialization = Promise.all([
			import("@opentelemetry/api"),
			import("@opentelemetry/context-async-hooks"),
		]).then(([{ context }, { AsyncLocalStorageContextManager }]) => {
			const contextManager = new AsyncLocalStorageContextManager().enable();
			if (!context.setGlobalContextManager(contextManager)) {
				// Another OpenTelemetry owner already installed a context manager.
				contextManager.disable();
			}
		});
	}
	await langfuseContextManagerInitialization;
}

async function initializeDirectLangfuseTelemetry(
	config: DirectLangfuseTelemetryConfig,
): Promise<DirectLangfuseTelemetryRuntime | undefined> {
	try {
		// Direct SDK consumers own this isolated exporter. It intentionally does
		// not replace or modify the process's global tracer provider.
		if (!process.env.OTEL_SERVICE_NAME?.trim()) {
			process.env.OTEL_SERVICE_NAME = "cline-sdk";
		}
		await ensureLangfuseContextManager();
		const [
			{ LangfuseSpanProcessor },
			{ LangfuseVercelAiSdkIntegration },
			{ NodeTracerProvider },
		] = await Promise.all([
			import("@langfuse/otel"),
			import("@langfuse/vercel-ai-sdk"),
			import("@opentelemetry/sdk-trace-node"),
		]);

		const spanProcessor = new LangfuseSpanProcessor(config);
		const tracerProvider = new NodeTracerProvider({
			spanProcessors: [spanProcessor],
		} as unknown as ConstructorParameters<typeof NodeTracerProvider>[0]);
		const integration = new LangfuseVercelAiSdkIntegration({
			tracer: tracerProvider.getTracer("cline-langfuse-direct"),
		});
		debugLangfuse(`created isolated direct exporter baseUrl=${config.baseUrl}`);

		return { integration, tracerProvider };
	} catch (error) {
		debugLangfuse(
			`direct initialization failed error=${error instanceof Error ? error.message : String(error)}`,
		);
		return undefined;
	}
}

function hasActiveTracerProvider(traceApi: {
	getTracerProvider: () => unknown;
}): boolean {
	const provider = traceApi.getTracerProvider() as {
		constructor?: { name?: string };
		getDelegate?: () => { constructor?: { name?: string } };
	};
	const activeProvider = provider.getDelegate?.() ?? provider;
	const providerName = activeProvider?.constructor?.name;

	return Boolean(
		providerName &&
			providerName !== "ProxyTracerProvider" &&
			providerName !== "NoopTracerProvider",
	);
}

export async function disposeLangfuseTelemetry(): Promise<void> {
	const pendingRuntimes = [...directLangfuseRuntimes.values()];
	directLangfuseRuntimes.clear();
	directLangfuseDisposableRegistration = undefined;
	const settledRuntimes = await Promise.allSettled(pendingRuntimes);
	const runtimes = settledRuntimes.flatMap((result) =>
		result.status === "fulfilled" && result.value ? [result.value] : [],
	);

	await Promise.all(
		runtimes.map(async ({ tracerProvider }) => {
			try {
				await tracerProvider.forceFlush();
				debugLangfuse("direct forceFlush completed");
			} catch (error) {
				debugLangfuse(
					`direct forceFlush failed error=${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}),
	);
	await Promise.all(
		runtimes.map(async ({ tracerProvider }) => {
			try {
				await tracerProvider.shutdown();
				debugLangfuse("direct shutdown completed");
			} catch (error) {
				debugLangfuse(
					`direct shutdown failed error=${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}),
	);
}

export function debugLangfuse(message: string): void {
	if (!isLangfuseDebugEnabled()) {
		return;
	}
	console.warn(`[langfuse-debug] ${message}`);
}

function isLangfuseDebugEnabled(): boolean {
	const raw = process.env[LANGFUSE_DEBUG_ENV];
	if (!raw) {
		return false;
	}
	const normalized = raw.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function resetLangfuseTelemetryForTests(): void {
	managedLangfuseIntegrationPromise = undefined;
	directLangfuseRuntimes = new Map();
	directLangfuseDisposableRegistration = undefined;
	langfuseContextManagerInitialization = undefined;
}
