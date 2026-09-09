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
	_providerId: string,
): Promise<boolean> {
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

		const spanProcessor = new LangfuseSpanProcessor({
			baseUrl: config.baseUrl,
			publicKey: config.publicKey,
			secretKey: config.secretKey,
		});
		debugLangfuse(`creating span processor baseUrl=${config.baseUrl}`);

		const tracerProvider = trace.getTracerProvider() as MutableTracerProvider;
		if (typeof tracerProvider?.addSpanProcessor === "function") {
			tracerProvider.addSpanProcessor(spanProcessor);
			const hasDelegate = hasActiveTracerDelegate(trace);
			if (hasDelegate) {
				registerTelemetry(new LangfuseVercelAiSdkIntegration());
			}
			debugLangfuse(
				`attached processor to existing tracer provider delegateReady=${String(hasDelegate)}`,
			);
			return hasDelegate;
		}

		// Class names are unreliable here: release binaries are minified, which
		// renames classes like ProxyTracerProvider, so all provider detection
		// below is structural (method presence, object identity) instead of
		// comparing constructor names.
		const existingDelegate =
			typeof tracerProvider?.getDelegate === "function"
				? tracerProvider.getDelegate()
				: undefined;
		if (isRecordingTracerProvider(existingDelegate)) {
			// Another provider already owns the global slot, so registering our
			// own would be rejected. Attach to it when it accepts processors.
			const delegate = existingDelegate as MutableTracerProvider;
			if (typeof delegate.addSpanProcessor === "function") {
				delegate.addSpanProcessor(spanProcessor);
				registerTelemetry(new LangfuseVercelAiSdkIntegration());
				debugLangfuse("attached processor to registered tracer delegate");
				return true;
			}
			debugLangfuse(
				"tracer provider slot already owned; disabling Langfuse export",
			);
			return false;
		}

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
	const raw = process.env[LANGFUSE_DEBUG_ENV];
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
