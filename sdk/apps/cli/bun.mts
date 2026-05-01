import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function defineProcessEnv(name: string): string {
	return JSON.stringify(process.env[name] ?? "");
}

const sourcemap = Bun.env.CLINE_SOURCEMAPS === "1" ? "linked" : "none";

const result = await Bun.build({
	entrypoints: ["./src/index.ts"],
	outdir: "./dist",
	target: "node",
	format: "esm",
	sourcemap,
	packages: "bundle", // Keep private workspace packages bundled so npm consumers do not need @clinebot/* at runtime.
	external: [
		// OpenTUI resolves a platform-specific native package at runtime.
		// Bundling through that resolution path rewrites the import in a way that
		// breaks Linux e2e runs from dist/. Keep React external too so OpenTUI and
		// the CLI share one React runtime instead of ending up with duplicate hook
		// dispatchers in the bundle.
		"@opentui/core",
		"@opentui/react",
		"@opentui-ui/dialog",
		"opentui-spinner",
		"react",
		"react/jsx-runtime",
		"react/jsx-dev-runtime",
		"react-devtools-core",
	],
	define: {
		"process.env.NODE_ENV": '"production"',
		"process.env.OTEL_TELEMETRY_ENABLED": defineProcessEnv(
			"OTEL_TELEMETRY_ENABLED",
		),
		"process.env.OTEL_EXPORTER_OTLP_ENDPOINT": defineProcessEnv(
			"OTEL_EXPORTER_OTLP_ENDPOINT",
		),
		"process.env.OTEL_METRICS_EXPORTER": defineProcessEnv(
			"OTEL_METRICS_EXPORTER",
		),
		"process.env.OTEL_LOGS_EXPORTER": defineProcessEnv("OTEL_LOGS_EXPORTER"),
		"process.env.OTEL_EXPORTER_OTLP_PROTOCOL": defineProcessEnv(
			"OTEL_EXPORTER_OTLP_PROTOCOL",
		),
		"process.env.OTEL_METRIC_EXPORT_INTERVAL": defineProcessEnv(
			"OTEL_METRIC_EXPORT_INTERVAL",
		),
		"process.env.OTEL_EXPORTER_OTLP_HEADERS": defineProcessEnv(
			"OTEL_EXPORTER_OTLP_HEADERS",
		),
	},
	env: "OTEL_*",
	banner:
		'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
});

if (result.logs.length > 0) {
	for (const log of result.logs) {
		console.warn(log);
	}
}

const rootDir = dirname(fileURLToPath(import.meta.url));
const coreBootstrapPath = join(
	rootDir,
	"../../packages/core/dist/extensions/plugin-sandbox-bootstrap.js",
);
const cliBootstrapPath = join(
	rootDir,
	"./dist/extensions/plugin-sandbox-bootstrap.js",
);
mkdirSync(dirname(cliBootstrapPath), { recursive: true });
copyFileSync(coreBootstrapPath, cliBootstrapPath);
