import type { Tracer } from "@opentelemetry/api";
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

function isClineProviderId(providerId: string): boolean {
	return providerId === "cline" || providerId === "cline-pass";
}

export type AiSdkTelemetryDecision = {
	isEnabled: boolean;
	integrations?: Telemetry;
	recordInputs?: boolean;
	recordOutputs?: boolean;
};

const TELEMETRY_DISABLED: AiSdkTelemetryDecision = { isEnabled: false };

/**
 * Select exactly one per-call integration. A host OTLP relay takes precedence
 * over direct credentials, and its sampling, opt-out and content policy is
 * checked on every stream. Direct exports own an isolated tracer provider.
 */
export async function resolveAiSdkTelemetry(
	providerId: string,
	samplingKey?: string,
): Promise<AiSdkTelemetryDecision> {
	if (!isClineProviderId(providerId)) {
		return TELEMETRY_DISABLED;
	}

	const relayTracer = await getHostOtlpTracer();
	if (!relayTracer) {
		const config = readDirectLangfuseTelemetryConfig();
		if (!config) return TELEMETRY_DISABLED;
		const integration = await ensureDirectLangfuseIntegration(
			providerId,
			config,
		);
		return integration
			? { isEnabled: true, integrations: integration }
			: TELEMETRY_DISABLED;
	}

	if (await isTelemetryOptedOutGlobally()) {
		return TELEMETRY_DISABLED;
	}

	const percent = readTraceSamplePercent();
	if (percent <= 0) {
		return TELEMETRY_DISABLED;
	}
	if (percent < 100) {
		// No stable key means no deterministic decision; stay off rather than
		// flickering per request and fragmenting tasks across the sample line.
		if (!samplingKey) {
			return TELEMETRY_DISABLED;
		}
		if (fnv1a32(samplingKey) % 100 >= percent) {
			return TELEMETRY_DISABLED;
		}
	}
	const { LangfuseVercelAiSdkIntegration } = await import(
		"@langfuse/vercel-ai-sdk"
	);
	// Resolve the host tracer per call so remote-config replacement cannot
	// leave a cached integration attached to a shut-down provider.
	const integration = new LangfuseVercelAiSdkIntegration({
		tracer: relayTracer,
	});
	const recordContent = isEnvTruthy(process.env.CLINE_TRACE_RECORD_CONTENT);
	return {
		isEnabled: true,
		integrations: integration,
		recordInputs: recordContent,
		recordOutputs: recordContent,
	};
}

function readTraceSamplePercent(): number {
	// Literal env access so bundlers can inline a build-time value.
	const raw = process.env.CLINE_TRACE_SAMPLE_PERCENT?.trim();
	if (!raw) {
		// Registering a traces exporter is the host's opt-in; default to
		// everything and let the env (or the collector) reduce volume.
		return 100;
	}
	const percent = Number.parseFloat(raw);
	return Number.isFinite(percent) ? percent : 100;
}

/**
 * The user's global telemetry opt-out (shared settings file written by the
 * extension/CLI settings flows). Spans bypass the ITelemetryService wrapper
 * that enforces opt-out for events and metrics, so the relay path re-checks
 * the setting per stream — which also honors mid-session opt-outs. The
 * direct Langfuse path is intentionally not gated here: it only activates
 * on explicit operator-supplied credentials.
 */
async function isTelemetryOptedOutGlobally(): Promise<boolean> {
	let raw: string;
	try {
		const [{ readFileSync }, { resolveGlobalSettingsPath }] = await Promise.all(
			[import("node:fs"), import("@cline/shared/storage")],
		);
		raw = readFileSync(resolveGlobalSettingsPath(), "utf8");
	} catch (error) {
		// A genuinely absent file means no opt-out was ever recorded (first
		// run). Every other failure — permissions, I/O, no fs in this runtime —
		// fails closed: consent that cannot be verified is not consent.
		return (error as NodeJS.ErrnoException)?.code !== "ENOENT";
	}
	try {
		return JSON.parse(raw)?.telemetryOptOut === true;
	} catch {
		// Malformed settings (e.g. a torn read while the non-atomic writer is
		// mid-rewrite) fail closed: a user who opted out must not start
		// tracing because their settings file was corrupted.
		return true;
	}
}

/**
 * True only when the globally registered tracer provider is the intended
 * OTLP collector relay — identified by the marker its creator stamped, not
 * by "some recording tracer exists". A console-only tracer must neither
 * enable the relay path nor suppress direct Langfuse export.
 */
async function getHostOtlpTracer(): Promise<Tracer | undefined> {
	const [{ trace }, { isOtlpTraceRelayProvider }] = await Promise.all([
		import("@opentelemetry/api"),
		import("@cline/shared"),
	]);
	const provider = trace.getTracerProvider() as { getDelegate?: () => unknown };
	if (
		isOtlpTraceRelayProvider(provider) ||
		isOtlpTraceRelayProvider(provider.getDelegate?.())
	) {
		return trace.getTracer("cline-provider-langfuse");
	}
	return undefined;
}

/** FNV-1a: stable across processes so a task samples identically on retries. */
function fnv1a32(value: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash;
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
		});
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

function isEnvTruthy(raw: string | undefined): boolean {
	if (!raw) return false;
	const normalized = raw.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function resetLangfuseTelemetryForTests(): void {
	directLangfuseRuntimes = new Map();
	directLangfuseDisposableRegistration = undefined;
	langfuseContextManagerInitialization = undefined;
}
