import { ClineEndpoint } from "@/config"
import {
	getValidOpenTelemetryConfig,
	getValidRuntimeOpenTelemetryConfig,
	type OpenTelemetryClientValidConfig,
} from "@/shared/services/config/otel-config"
import { Logger } from "@/shared/services/Logger"
import { OpenTelemetryClientProvider } from "./providers/opentelemetry/OpenTelemetryClientProvider"
import { RUNTIME_ENV_OTEL_BYPASSES_USER_OPT_OUT } from "./telemetry-policy"

/**
 * The process's shared OpenTelemetry clients (ENG-2397).
 *
 * Both telemetry pipelines — the classic host TelemetryService providers and the
 * SDK handle's adapters — export through the clients in this registry, so each
 * configured destination has exactly one exporter, one batcher, and one
 * connection pool per process, and runtime env configuration affects all
 * telemetry uniformly instead of only the classic half.
 */
export interface SharedOtelClient {
	/** Which config source produced this client. */
	readonly id: "build-time" | "runtime-env"
	readonly client: OpenTelemetryClientProvider
	readonly config: OpenTelemetryClientValidConfig
	/** See {@link RUNTIME_ENV_OTEL_BYPASSES_USER_OPT_OUT}. */
	readonly bypassUserSettings: boolean
}

let sharedClients: SharedOtelClient[] | null = null

/**
 * Lazily constructs the process's OpenTelemetry clients from the unified config:
 * - "build-time": `OTEL_*` values inlined into the bundle at build time
 *   (production collector defaults; skipped in self-hosted deployments).
 * - "runtime-env": `CLINE_OTEL_*` environment variables read live at runtime
 *   (user-controlled debugging/override collector).
 */
export function getSharedOtelClients(): SharedOtelClient[] {
	if (sharedClients) {
		return sharedClients
	}

	const clients: SharedOtelClient[] = []

	// Skip build-time OTEL in selfHosted mode - enterprise customers should not
	// send telemetry to Cline's collector. Runtime env OTEL (and remote config
	// OTEL) are still allowed: the user/org explicitly configured them.
	const buildTimeConfig = getValidOpenTelemetryConfig()
	if (!ClineEndpoint.isSelfHosted() && buildTimeConfig) {
		try {
			clients.push({
				id: "build-time",
				client: new OpenTelemetryClientProvider(buildTimeConfig),
				config: buildTimeConfig,
				bypassUserSettings: false,
			})
		} catch (error) {
			Logger.error("[OTEL] Failed to create build-time OpenTelemetry client", error)
		}
	}

	const runtimeEnvConfig = getValidRuntimeOpenTelemetryConfig()
	if (runtimeEnvConfig) {
		try {
			clients.push({
				id: "runtime-env",
				client: new OpenTelemetryClientProvider(runtimeEnvConfig),
				config: runtimeEnvConfig,
				bypassUserSettings: RUNTIME_ENV_OTEL_BYPASSES_USER_OPT_OUT,
			})
		} catch (error) {
			Logger.error("[OTEL] Failed to create runtime-env OpenTelemetry client", error)
		}
	}

	sharedClients = clients
	return sharedClients
}

/** Best-effort flush of every shared client's pending batches. */
export async function flushSharedOtelClients(): Promise<void> {
	if (!sharedClients) {
		return
	}
	await Promise.allSettled(
		sharedClients.flatMap(({ client }) => [
			client.meterProvider?.forceFlush() ?? Promise.resolve(),
			client.loggerProvider?.forceFlush() ?? Promise.resolve(),
		]),
	)
}

/**
 * Shuts down every shared client (flushing pending batches). Called from
 * extension teardown, after both pipelines have stopped capturing.
 */
export async function disposeSharedOtelClients(): Promise<void> {
	if (!sharedClients) {
		return
	}
	const clients = sharedClients
	sharedClients = null
	await Promise.allSettled(clients.map(({ client }) => client.dispose()))
}

/** Test-only: reset module state between test cases (does not shut down clients). */
export function resetSharedOtelClientsForTests(): void {
	sharedClients = null
}
