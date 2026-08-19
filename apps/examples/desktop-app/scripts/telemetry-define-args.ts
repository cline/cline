/**
 * Build-time inlining of the telemetry configuration, mirroring the CLI
 * bundle (`apps/cli/bun.mts`). `getTelemetryBuildTimeConfig` in
 * `@cline/shared` reads `process.env.OTEL_*` at runtime, which is always
 * empty for a packaged app launched from Finder/the Dock — so the packaged
 * sidecar binary must have these values substituted into the bundle at
 * build time. Vars that are unset at build time inline as "" (telemetry
 * stays disabled), which keeps local/dev builds opted out without any
 * keys living in the repo.
 */

/** Inlined only when present so secrets never inline as empty markers. */
const OPTIONAL_SECRET_ENV_VARS = [
	"TELEMETRY_SERVICE_API_KEY",
	"ERROR_SERVICE_API_KEY",
] as const;

/**
 * Every env var `getTelemetryBuildTimeConfig` reads
 * (sdk/packages/shared/src/services/telemetry-config.ts). Always inlined,
 * defaulting to "", so a packaged binary never falls back to runtime env.
 */
const OTEL_ENV_VARS = [
	"OTEL_TELEMETRY_ENABLED",
	"OTEL_METRICS_EXPORTER",
	"OTEL_LOGS_EXPORTER",
	"OTEL_TRACES_EXPORTER",
	"OTEL_EXPORTER_OTLP_PROTOCOL",
	"OTEL_EXPORTER_OTLP_ENDPOINT",
	"OTEL_EXPORTER_OTLP_HEADERS",
	"OTEL_METRIC_EXPORT_INTERVAL",
] as const;

/**
 * `--define` argument pairs for `bun build`, e.g.
 * `["--define", 'process.env.OTEL_TELEMETRY_ENABLED="1"', ...]`.
 */
export function telemetryDefineArgs(
	env: Record<string, string | undefined> = process.env,
): string[] {
	const args: string[] = [];
	const define = (name: string, value: string) => {
		args.push("--define", `process.env.${name}=${JSON.stringify(value)}`);
	};
	for (const name of OPTIONAL_SECRET_ENV_VARS) {
		const value = env[name];
		if (value) {
			define(name, value);
		}
	}
	for (const name of OTEL_ENV_VARS) {
		define(name, env[name] ?? "");
	}
	return args;
}
