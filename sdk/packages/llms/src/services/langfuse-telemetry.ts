type MutableTracerProvider = {
	addSpanProcessor?: (spanProcessor: unknown) => void;
	getDelegate?: () => unknown;
};

type LangfuseTelemetryConfig = {
	baseUrl: string;
	publicKey: string;
	secretKey: string;
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

let langfuseTelemetryReady: boolean | undefined;
let langfuseTelemetryInitPromise: Promise<boolean> | undefined;

function isClineProviderId(providerId: string): boolean {
	return providerId === "cline" || providerId === "cline-pass";
}

export type AiSdkTelemetryDecision = {
	isEnabled: boolean;
	recordInputs?: boolean;
	recordOutputs?: boolean;
};

const TELEMETRY_DISABLED: AiSdkTelemetryDecision = { isEnabled: false };

/**
 * Decide AI SDK telemetry for one stream. Two independent export paths:
 * - Direct Langfuse (env-configured credentials, hub/internal): unchanged
 *   behavior — full content, every request.
 * - Host OTLP tracer (collector relay): a host that registered a traces
 *   exporter gets every task (100%). CLINE_TRACE_SAMPLE_PERCENT reduces
 *   that, sampled per task by `samplingKey` so a task's requests trace
 *   together. Metadata-only unless CLINE_TRACE_RECORD_CONTENT is set.
 */
export async function resolveAiSdkTelemetry(
	providerId: string,
	samplingKey?: string,
): Promise<AiSdkTelemetryDecision> {
	if (await ensureLangfuseTelemetry(providerId)) {
		return { isEnabled: true };
	}

	if (!isClineProviderId(providerId)) {
		return TELEMETRY_DISABLED;
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
	if (!(await hasHostOtlpTracer())) {
		return TELEMETRY_DISABLED;
	}

	// Literal env access so bundlers can inline a build-time value.
	const recordContent = isEnvTruthy(process.env.CLINE_TRACE_RECORD_CONTENT);
	return {
		isEnabled: true,
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
	try {
		const [{ readFileSync }, { resolveGlobalSettingsPath }] = await Promise.all(
			[import("node:fs"), import("@cline/shared/storage")],
		);
		const raw = readFileSync(resolveGlobalSettingsPath(), "utf8");
		return JSON.parse(raw)?.telemetryOptOut === true;
	} catch {
		// No settings file (or unreadable) means no opt-out was recorded.
		return false;
	}
}

async function hasHostOtlpTracer(): Promise<boolean> {
	try {
		const { trace } = await import("@opentelemetry/api");
		return hasActiveTracerDelegate(trace);
	} catch {
		return false;
	}
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

function readLangfuseTelemetryConfig(): LangfuseTelemetryConfig | undefined {
	const env = process?.env;
	const baseUrl = env?.LANGFUSE_BASE_URL?.trim();
	const publicKey = env?.LANGFUSE_PUBLIC_KEY?.trim();
	const secretKey = env?.LANGFUSE_SECRET_KEY?.trim();

	if (!baseUrl || !publicKey || !secretKey) {
		return undefined;
	}

	return {
		baseUrl,
		publicKey,
		secretKey,
	};
}

export function hasLangfuseTelemetryConfig(): boolean {
	return readLangfuseTelemetryConfig() !== undefined;
}

export async function ensureLangfuseTelemetry(
	providerId: string,
): Promise<boolean> {
	if (!isClineProviderId(providerId)) {
		return false;
	}

	if (!hasLangfuseTelemetryConfig()) {
		return false;
	}

	if (langfuseTelemetryReady !== undefined) {
		debugLangfuse(`cached readiness=${String(langfuseTelemetryReady)}`);
		return langfuseTelemetryReady;
	}

	if (!langfuseTelemetryInitPromise) {
		langfuseTelemetryInitPromise = initializeLangfuseTelemetry();
	}

	langfuseTelemetryReady = await langfuseTelemetryInitPromise;
	debugLangfuse(`initialized readiness=${String(langfuseTelemetryReady)}`);
	return langfuseTelemetryReady;
}

async function initializeLangfuseTelemetry(): Promise<boolean> {
	// Register for cleanup once, when initialization begins.
	const { registerDisposable } = await import("@cline/shared");
	registerDisposable(disposeLangfuseTelemetry);
	const config = readLangfuseTelemetryConfig();
	if (!config) {
		return false;
	}

	try {
		// Give Langfuse and any other OTEL exporter a stable resource identity.
		// Respect an explicitly configured service name from the host.
		if (!process.env.OTEL_SERVICE_NAME?.trim()) {
			process.env.OTEL_SERVICE_NAME = "cline-sdk";
		}
		const [
			{ LangfuseSpanProcessor },
			{ LangfuseVercelAiSdkIntegration },
			{ registerTelemetry },
			{ trace },
			{ NodeTracerProvider },
		] = await Promise.all([
			import("@langfuse/otel"),
			import("@langfuse/vercel-ai-sdk"),
			import("ai"),
			import("@opentelemetry/api"),
			import("@opentelemetry/sdk-trace-node"),
		]);

		// One export path per host: a recording tracer provider means the host
		// already exports spans somewhere (the OTLP collector relay). Attaching
		// the direct Langfuse processor to it would ship every span twice —
		// once direct, once through the collector — so the direct path
		// declines instead of cooperating. Class names are unreliable here
		// (release binaries are minified), so provider detection is structural.
		const tracerProvider = trace.getTracerProvider() as MutableTracerProvider;
		const existingDelegate =
			typeof tracerProvider?.getDelegate === "function"
				? tracerProvider.getDelegate()
				: undefined;
		if (
			typeof tracerProvider?.addSpanProcessor === "function" ||
			isRecordingTracerProvider(existingDelegate)
		) {
			debugLangfuse(
				"host tracer provider already registered; declining direct Langfuse export (one export path per host)",
			);
			return false;
		}

		const spanProcessor = new LangfuseSpanProcessor({
			baseUrl: config.baseUrl,
			publicKey: config.publicKey,
			secretKey: config.secretKey,
		});
		debugLangfuse(`creating span processor baseUrl=${config.baseUrl}`);

		const nodeTracerProvider = new NodeTracerProvider({
			spanProcessors: [spanProcessor],
		} as unknown as ConstructorParameters<typeof NodeTracerProvider>[0]);
		nodeTracerProvider.register();
		if (!isRegisteredGlobalTracerProvider(trace, nodeTracerProvider)) {
			debugLangfuse(
				"tracer provider registration was not accepted; disabling Langfuse export",
			);
			// Shut the orphaned provider down so its span processor does not
			// keep buffering spans that can never be exported.
			await nodeTracerProvider.shutdown?.();
			return false;
		}
		registerTelemetry(new LangfuseVercelAiSdkIntegration());
		debugLangfuse("registered NodeTracerProvider delegateReady=true");
		return true;
	} catch (error) {
		debugLangfuse(
			`initialization failed error=${error instanceof Error ? error.message : String(error)}`,
		);
		return false;
	}
}

function hasActiveTracerDelegate(traceApi: {
	getTracerProvider: () => unknown;
}): boolean {
	const tracerProvider = traceApi.getTracerProvider() as MutableTracerProvider;
	if (typeof tracerProvider.getDelegate !== "function") {
		// Some runtimes expose the registered tracer provider directly rather
		// than through OpenTelemetry's ProxyTracerProvider. A direct provider
		// has no delegate to inspect, but its addSpanProcessor API is sufficient
		// evidence that it can receive and export spans.
		return typeof tracerProvider.addSpanProcessor === "function";
	}

	return isRecordingTracerProvider(tracerProvider.getDelegate());
}

/**
 * Distinguishes a recording tracer provider from OpenTelemetry's no-op
 * fallback without relying on constructor names, which minified release
 * builds rename. Real SDK providers expose lifecycle methods the no-op
 * provider lacks.
 */
function isRecordingTracerProvider(provider: unknown): boolean {
	if (!provider || typeof provider !== "object") {
		return false;
	}
	const candidate = provider as {
		addSpanProcessor?: unknown;
		forceFlush?: unknown;
		shutdown?: unknown;
	};
	return (
		typeof candidate.addSpanProcessor === "function" ||
		typeof candidate.forceFlush === "function" ||
		typeof candidate.shutdown === "function"
	);
}

/**
 * Confirms the OpenTelemetry API accepted a provider registration. The API
 * silently keeps the previous owner when the global slot is taken, so the
 * only reliable signal is identity: the global provider (or its proxy
 * delegate) must be the exact instance that was just registered.
 */
function isRegisteredGlobalTracerProvider(
	traceApi: { getTracerProvider: () => unknown },
	provider: unknown,
): boolean {
	const globalProvider = traceApi.getTracerProvider() as
		| MutableTracerProvider
		| null
		| undefined;
	if (globalProvider === provider) {
		return true;
	}
	return (
		typeof globalProvider?.getDelegate === "function" &&
		globalProvider.getDelegate() === provider
	);
}

async function flushLangfuseTelemetry(): Promise<void> {
	try {
		const { trace } = await import("@opentelemetry/api");
		const tracerProvider = trace.getTracerProvider() as {
			getDelegate?: () => {
				forceFlush?: () => Promise<void>;
			};
		};
		await tracerProvider.getDelegate?.()?.forceFlush?.();
		debugLangfuse("forceFlush completed");
	} catch (error) {
		debugLangfuse(
			`forceFlush failed error=${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export async function disposeLangfuseTelemetry(): Promise<void> {
	try {
		await flushLangfuseTelemetry();
		const { trace } = await import("@opentelemetry/api");
		const tracerProvider = trace.getTracerProvider() as {
			getDelegate?: () => {
				shutdown?: () => Promise<void>;
			};
		};
		await tracerProvider.getDelegate?.()?.shutdown?.();
		debugLangfuse("shutdown completed");
	} catch (error) {
		debugLangfuse(
			`shutdown failed error=${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export function debugLangfuse(message: string): void {
	if (!isLangfuseDebugEnabled()) {
		return;
	}
	console.warn(`[langfuse-debug] ${message}`);
}

function isLangfuseDebugEnabled(): boolean {
	return isEnvTruthy(process.env[LANGFUSE_DEBUG_ENV]);
}

function isEnvTruthy(raw: string | undefined): boolean {
	if (!raw) {
		return false;
	}
	const normalized = raw.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function resetLangfuseTelemetryForTests(): void {
	langfuseTelemetryReady = undefined;
	langfuseTelemetryInitPromise = undefined;
}
