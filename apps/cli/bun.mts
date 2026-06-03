import {
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { $ } from "bun";

function defineProcessEnv(name: string): string {
	return JSON.stringify(process.env[name] ?? "");
}

const sourcemap = Bun.env.CLINE_SOURCEMAPS === "1" ? "linked" : "none";
const rootDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(rootDir, "../../");
const hubWebviewSourcePath = join(repoRoot, "apps/cline-hub/src/webview");
const hubWebviewDistPath = join(repoRoot, "apps/cline-hub/dist/webview");
const hubWebviewIndexPath = join(hubWebviewDistPath, "index.html");
const cliHubWebviewDistPath = join(rootDir, "dist/cline-hub/webview");

function newestFileMtimeMs(dir: string): number {
	let newest = 0;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (
			entry.name === "node_modules" ||
			entry.name === "dist" ||
			entry.name === ".turbo"
		) {
			continue;
		}
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			newest = Math.max(newest, newestFileMtimeMs(path));
		} else if (entry.isFile()) {
			newest = Math.max(newest, statSync(path).mtimeMs);
		}
	}
	return newest;
}

function shouldBuildHubWebview(): boolean {
	if (!existsSync(hubWebviewIndexPath)) {
		return true;
	}
	try {
		return (
			newestFileMtimeMs(hubWebviewSourcePath) >
			statSync(hubWebviewIndexPath).mtimeMs
		);
	} catch {
		return true;
	}
}

if (shouldBuildHubWebview()) {
	console.log("Building Cline Hub webview...");
	await $`bun -F @cline/cline-hub build:webview`.cwd(repoRoot);
}

const result = await Bun.build({
	entrypoints: ["./src/index.ts"],
	outdir: "./dist",
	target: "node",
	format: "esm",
	sourcemap,
	packages: "bundle", // Keep private workspace packages bundled so npm consumers do not need @cline/* at runtime.
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

const coreBootstrapPath = join(
	rootDir,
	"../../sdk/packages/core/dist/extensions/plugin-sandbox-bootstrap.js",
);
const cliBootstrapPath = join(
	rootDir,
	"./dist/extensions/plugin-sandbox-bootstrap.js",
);
mkdirSync(dirname(cliBootstrapPath), { recursive: true });
copyFileSync(coreBootstrapPath, cliBootstrapPath);

if (existsSync(hubWebviewDistPath)) {
	mkdirSync(dirname(cliHubWebviewDistPath), { recursive: true });
	cpSync(hubWebviewDistPath, cliHubWebviewDistPath, { recursive: true });
}
