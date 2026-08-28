import {
	DEFAULT_CLINE_PROVIDER_LANGFUSE_BASE_URL,
	isClineProvider,
	type LangfuseTelemetryConfig,
} from "@cline/shared";
import type { Telemetry } from "ai";

type LangfuseTelemetryRuntime = {
	integration: Telemetry;
	tracerProvider: {
		forceFlush(): Promise<void>;
		shutdown(): Promise<void>;
	};
};

type LangfuseEnvironmentKeys = {
	baseUrl: string;
	publicKey: string;
	secretKey: string;
};

type LangfuseCredentialEnvironmentKeys = Omit<
	LangfuseEnvironmentKeys,
	"baseUrl"
>;

type LangfuseEnvironmentConfig = {
	present: boolean;
	config?: LangfuseTelemetryConfig;
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

	const { propagateAttributes } = await import("@langfuse/core");
	return await propagateAttributes(attributes, callback);
}

const LANGFUSE_DEBUG_ENV = "CLINE_DEBUG_LANGFUSE";
const CLINE_PROVIDER_LANGFUSE_CREDENTIAL_ENV: LangfuseCredentialEnvironmentKeys =
	{
		publicKey: "CLINE_PROVIDER_LANGFUSE_PUBLIC_KEY",
		secretKey: "CLINE_PROVIDER_LANGFUSE_SECRET_KEY",
	};
const LANGFUSE_ENV: LangfuseEnvironmentKeys = {
	baseUrl: "LANGFUSE_BASE_URL",
	publicKey: "LANGFUSE_PUBLIC_KEY",
	secretKey: "LANGFUSE_SECRET_KEY",
};

let langfuseTelemetryRuntimes = new Map<
	string,
	Promise<LangfuseTelemetryRuntime | undefined>
>();
let langfuseDisposableRegistration: Promise<void> | undefined;
let langfuseContextManagerInitialization: Promise<void> | undefined;

function normalizeLangfuseTelemetryConfig(
	config: Partial<LangfuseTelemetryConfig> | undefined,
): LangfuseTelemetryConfig | undefined {
	const baseUrl = config?.baseUrl?.trim();
	const publicKey = config?.publicKey?.trim();
	const secretKey = config?.secretKey?.trim();
	if (!baseUrl || !publicKey || !secretKey) {
		return undefined;
	}
	return { baseUrl, publicKey, secretKey };
}

function readLangfuseEnvironmentConfig(
	keys: LangfuseEnvironmentKeys,
): LangfuseEnvironmentConfig {
	const values = {
		baseUrl: process.env[keys.baseUrl],
		publicKey: process.env[keys.publicKey],
		secretKey: process.env[keys.secretKey],
	};
	const present = Object.values(values).some((value) => value !== undefined);
	return {
		present,
		config: normalizeLangfuseTelemetryConfig(values),
	};
}

function readClineProviderLangfuseEnvironmentConfig(): LangfuseEnvironmentConfig {
	const values = {
		publicKey: process.env[CLINE_PROVIDER_LANGFUSE_CREDENTIAL_ENV.publicKey],
		secretKey: process.env[CLINE_PROVIDER_LANGFUSE_CREDENTIAL_ENV.secretKey],
	};
	const present = Object.values(values).some((value) => value !== undefined);
	return {
		present,
		config: normalizeLangfuseTelemetryConfig({
			baseUrl: DEFAULT_CLINE_PROVIDER_LANGFUSE_BASE_URL,
			...values,
		}),
	};
}

function resolveLangfuseTelemetryConfig(
	providerId: string,
	featureFlagConfig: LangfuseTelemetryConfig | undefined,
): LangfuseTelemetryConfig | undefined {
	if (!isClineProvider(providerId)) {
		return readLangfuseEnvironmentConfig(LANGFUSE_ENV).config;
	}

	// A feature-flag configuration is transported in memory across the Hub
	// boundary. If it is present but malformed, fail closed instead of silently
	// sending Cline-owned traces to an ambient exporter.
	if (featureFlagConfig !== undefined) {
		return normalizeLangfuseTelemetryConfig(featureFlagConfig);
	}

	const clineProviderConfig = readClineProviderLangfuseEnvironmentConfig();
	if (clineProviderConfig.present) {
		// Never mix variables across namespaces. A partially configured prefixed
		// credential pair disables Cline-provider tracing rather than falling back.
		return clineProviderConfig.config;
	}

	return readLangfuseEnvironmentConfig(LANGFUSE_ENV).config;
}

async function registerLangfuseDisposable(): Promise<void> {
	if (!langfuseDisposableRegistration) {
		langfuseDisposableRegistration = import("@cline/shared").then(
			({ registerDisposable }) => {
				registerDisposable(disposeLangfuseTelemetry);
			},
		);
	}
	await langfuseDisposableRegistration;
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

export async function ensureLangfuseTelemetry(
	providerId: string,
	featureFlagConfig?: LangfuseTelemetryConfig,
): Promise<Telemetry | undefined> {
	const config = resolveLangfuseTelemetryConfig(providerId, featureFlagConfig);
	if (!config) {
		debugLangfuse(`configuration missing for provider ${providerId}`);
		return undefined;
	}

	const configKey = JSON.stringify(config);
	let runtimePromise = langfuseTelemetryRuntimes.get(configKey);
	if (!runtimePromise) {
		runtimePromise = registerLangfuseDisposable().then(
			async () => await initializeLangfuseTelemetry(config),
		);
		langfuseTelemetryRuntimes.set(configKey, runtimePromise);
	}

	const runtime = await runtimePromise;
	debugLangfuse(
		`resolved integration=${String(Boolean(runtime))} provider=${providerId}`,
	);
	return runtime?.integration;
}

async function initializeLangfuseTelemetry(
	config: LangfuseTelemetryConfig,
): Promise<LangfuseTelemetryRuntime | undefined> {
	try {
		// Give Langfuse a stable resource identity without replacing the process's
		// global tracer provider. Each credential set gets an isolated provider and
		// is selected through AI SDK's per-call telemetry integration.
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

		const spanProcessor = new LangfuseSpanProcessor({
			baseUrl: config.baseUrl,
			publicKey: config.publicKey,
			secretKey: config.secretKey,
		});
		const tracerProvider = new NodeTracerProvider({
			spanProcessors: [spanProcessor],
		} as unknown as ConstructorParameters<typeof NodeTracerProvider>[0]);
		const integration = new LangfuseVercelAiSdkIntegration({
			tracer: tracerProvider.getTracer("cline-langfuse"),
		});
		debugLangfuse(`created isolated exporter baseUrl=${config.baseUrl}`);

		return { integration, tracerProvider };
	} catch (error) {
		debugLangfuse(
			`initialization failed error=${error instanceof Error ? error.message : String(error)}`,
		);
		return undefined;
	}
}

export async function disposeLangfuseTelemetry(): Promise<void> {
	const pendingRuntimes = [...langfuseTelemetryRuntimes.values()];
	langfuseTelemetryRuntimes.clear();
	langfuseDisposableRegistration = undefined;
	const settledRuntimes = await Promise.allSettled(pendingRuntimes);
	const runtimes = settledRuntimes.flatMap((result) =>
		result.status === "fulfilled" && result.value ? [result.value] : [],
	);

	await Promise.all(
		runtimes.map(async ({ tracerProvider }) => {
			try {
				await tracerProvider.forceFlush();
				debugLangfuse("forceFlush completed");
			} catch (error) {
				debugLangfuse(
					`forceFlush failed error=${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}),
	);
	await Promise.all(
		runtimes.map(async ({ tracerProvider }) => {
			try {
				await tracerProvider.shutdown();
				debugLangfuse("shutdown completed");
			} catch (error) {
				debugLangfuse(
					`shutdown failed error=${error instanceof Error ? error.message : String(error)}`,
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
	langfuseTelemetryRuntimes = new Map();
	langfuseDisposableRegistration = undefined;
	langfuseContextManagerInitialization = undefined;
}
