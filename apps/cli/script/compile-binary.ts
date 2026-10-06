import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { $ } from "bun";

const cliDir = resolve(import.meta.dir, "..");
const rootDir = resolve(cliDir, "../..");

// Telemetry / OTEL environment variables that should be baked into the
// compiled binary at build time. Mirrors the list of secrets injected by the
// `cli-publish` GitHub Actions workflow. These are inlined via Bun's `define`
// so the CLI ships with the production telemetry configuration without
// requiring the end user to set any env vars.
const BUILD_TIME_INLINED_ENV_VARS = [
	"TELEMETRY_SERVICE_API_KEY",
	"ERROR_SERVICE_API_KEY",
	"OTEL_TELEMETRY_ENABLED",
	"OTEL_LOGS_EXPORTER",
	"OTEL_METRICS_EXPORTER",
	"OTEL_TRACES_EXPORTER",
	"CLINE_TRACE_SAMPLE_PERCENT",
	"CLINE_TRACE_RECORD_CONTENT",
	"OTEL_EXPORTER_OTLP_PROTOCOL",
	"OTEL_EXPORTER_OTLP_ENDPOINT",
	"OTEL_EXPORTER_OTLP_HEADERS",
] as const;

function buildInlinedEnvDefines(): Record<string, string> {
	const defines: Record<string, string> = {};
	for (const name of BUILD_TIME_INLINED_ENV_VARS) {
		defines[`process.env.${name}`] = JSON.stringify(process.env[name] ?? "");
	}
	return defines;
}

function findOpenTuiParserWorker(): string {
	const localPath = resolve(
		cliDir,
		"node_modules/@opentui/core/parser.worker.js",
	);
	const rootPath = resolve(
		rootDir,
		"node_modules/@opentui/core/parser.worker.js",
	);
	const parserWorkerPath = existsSync(localPath) ? localPath : rootPath;
	return realpathSync(parserWorkerPath);
}

export function readOpenTuiVersion(): string | undefined {
	const pkg = JSON.parse(readFileSync(join(cliDir, "package.json"), "utf-8"));
	return pkg.dependencies?.["@opentui/core"];
}

/**
 * Bun only has the host platform's OpenTUI native package by default, and a
 * cross-compiled build cannot resolve the FFI layer without the target's.
 * Installs every platform variant of the pinned version.
 */
export async function installOpenTuiNativeVariants(): Promise<void> {
	const opentuiVersion = readOpenTuiVersion();
	if (!opentuiVersion) {
		return;
	}
	console.log(
		`Installing all platform variants of @opentui/core@${opentuiVersion}...`,
	);
	await $`bun install --no-save --os="*" --cpu="*" @opentui/core@${opentuiVersion}`.cwd(
		cliDir,
	);
}

export interface CompileCliBinaryOptions {
	bunTarget: Bun.Build.CompileTarget;
	outfile: string;
	/** Runtime flags baked into the executable, e.g. `--use-system-ca`. */
	execArgv?: string[];
	/**
	 * Read `.env` / `bunfig.toml` from the launch directory before the CLI
	 * starts. Bun's default; binaries launched in directories the user did not
	 * pick (an SSH home, a GUI app's cwd) should turn this off.
	 */
	autoloadLaunchDirectoryConfig?: boolean;
}

/** Compiles the CLI entrypoint into one self-contained executable. */
export async function compileCliBinary(
	input: CompileCliBinaryOptions,
): Promise<void> {
	const parserWorker = findOpenTuiParserWorker();
	const targetOs = input.bunTarget.includes("windows") ? "windows" : "posix";
	const bunfsRoot = targetOs === "windows" ? "B:/~BUN/root/" : "/$bunfs/root/";
	const parserWorkerPath = relative(rootDir, parserWorker).replaceAll(
		"\\",
		"/",
	);

	// Build to /tmp first so Bun's temp-file rename stays on one filesystem
	// layer in containerized environments (virtiofs, overlayfs).
	const entrypoint = join(cliDir, "src/index.ts");
	const scratchRoot = process.platform === "win32" ? tmpdir() : "/tmp";
	const tmpDir = join(
		scratchRoot,
		`cline-build-${input.bunTarget}-${process.pid}`,
	);
	const tmpOutfile = join(
		tmpDir,
		input.outfile.endsWith(".exe") ? "cline.exe" : "cline",
	);
	mkdirSync(tmpDir, { recursive: true });

	const previousCwd = process.cwd();
	process.chdir(scratchRoot);
	let result: Awaited<ReturnType<typeof Bun.build>>;
	try {
		const autoload = input.autoloadLaunchDirectoryConfig !== false;
		result = await Bun.build({
			entrypoints: [entrypoint, parserWorker],
			splitting: true,
			compile: {
				target: input.bunTarget,
				outfile: tmpOutfile,
				...(input.execArgv?.length ? { execArgv: input.execArgv } : {}),
				...(autoload ? {} : { autoloadDotenv: false, autoloadBunfig: false }),
			},
			minify: true,
			external: ["@anthropic-ai/vertex-sdk"],
			define: {
				OTUI_TREE_SITTER_WORKER_PATH: bunfsRoot + parserWorkerPath,
				// Inline telemetry/OTEL env vars at build time so the compiled
				// binary ships with production telemetry configuration baked in.
				...buildInlinedEnvDefines(),
			},
			throw: false,
		});
	} finally {
		process.chdir(previousCwd);
	}

	if (!result.success) {
		for (const log of result.logs) {
			console.error(log);
		}
		rmSync(tmpDir, { recursive: true, force: true });
		throw new Error(`CLI build failed for ${input.bunTarget}`);
	}

	mkdirSync(dirname(input.outfile), { recursive: true });
	copyFileSync(tmpOutfile, input.outfile);
	chmodSync(input.outfile, 0o755);
	rmSync(tmpDir, { recursive: true, force: true });
}
