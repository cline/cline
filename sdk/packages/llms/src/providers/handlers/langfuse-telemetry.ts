type MutableTracerProvider = {
	addSpanProcessor?: (spanProcessor: unknown) => void;
	constructor?: {
		name?: string;
	};
};

type LangfuseTelemetryConfig = {
	baseUrl: string;
	publicKey: string;
	secretKey: string;
};

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
	providerId: string,
): Promise<boolean> {
	// Currently Cline provider only when enabled
	if (!hasLangfuseTelemetryConfig() || providerId !== "cline") {
		debugLangfuse(`config missing or provider ${providerId} not cline`);
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
	const { registerDisposable } = await import("@clinebot/shared");
	registerDisposable(disposeLangfuseTelemetry);
	const config = readLangfuseTelemetryConfig();
	if (!config) {
		return false;
	}

	try {
		const [{ LangfuseSpanProcessor }, { trace }, { NodeTracerProvider }] =
			await Promise.all([
				import("@langfuse/otel"),
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
			debugLangfuse(
				`attached processor to existing tracer provider delegateReady=${String(hasDelegate)}`,
			);
			return hasDelegate;
		}

		const providerName = tracerProvider?.constructor?.name;
		if (
			providerName &&
			providerName !== "ProxyTracerProvider" &&
			providerName !== "NoopTracerProvider"
		) {
			return false;
		}

		const nodeTracerProvider = new NodeTracerProvider({
			spanProcessors: [spanProcessor],
		} as unknown as ConstructorParameters<typeof NodeTracerProvider>[0]);
		nodeTracerProvider.register();
		const hasDelegate = hasActiveTracerDelegate(trace);
		debugLangfuse(
			`registered NodeTracerProvider delegateReady=${String(hasDelegate)}`,
		);
		return hasDelegate;
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
	const tracerProvider = traceApi.getTracerProvider() as {
		getDelegate?: () => { constructor?: { name?: string } };
	};
	const delegate = tracerProvider.getDelegate?.();
	const delegateName = delegate?.constructor?.name;

	return Boolean(delegateName && delegateName !== "NoopTracerProvider");
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
