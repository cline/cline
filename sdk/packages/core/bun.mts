/// <reference types="@types/bun" />
import { cpSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
export {};

type PackageManifest = {
	dependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
};

const packageJson = (await Bun.file(
	new URL("./package.json", import.meta.url),
).json()) as PackageManifest;

// Keep declared runtime packages external so they are not duplicated inside each
// bundled entrypoint and installed again from package.json.
const external = Object.keys({
	...(packageJson.dependencies ?? {}),
	...(packageJson.peerDependencies ?? {}),
});

const sourcemap = Bun.env.CLINE_SOURCEMAPS === "1" ? "linked" : "none";
// minify: true keeps identifier mangling active even when sourcemaps are enabled.
const minify = Bun.env.CLINE_SOURCEMAPS !== "1";

const buildConfig = {
	target: "node",
	format: "esm",
	minify,
	packages: "bundle",
	sourcemap,
	external,
} as const;

const builds: Parameters<typeof Bun.build>[0][] = [
	// Build main exports separately to avoid Bun bundler output path conflicts
	{
		entrypoints: ["./src/index.ts"],
		outdir: "./dist",
		...buildConfig,
	},
	{
		entrypoints: ["./src/hub/index.ts"],
		outdir: "./dist/hub",
		...buildConfig,
	},
	{
		entrypoints: ["./src/hub/daemon/entry.ts"],
		outdir: "./dist/hub/daemon",
		...buildConfig,
	},
	{
		entrypoints: ["./src/services/telemetry/index.ts"],
		outdir: "./dist/services/telemetry",
		...buildConfig,
	},
	{
		entrypoints: ["./src/services/feature-flags/posthog.ts"],
		outdir: "./dist/services/feature-flags",
		...buildConfig,
	},
	// The plugin sandbox bootstrap runs in an isolated child process via
	// SubprocessSandbox and must be emitted as a separate executable entrypoint.
	{
		entrypoints: ["./src/extensions/plugin/plugin-sandbox-bootstrap.ts"],
		outdir: "./dist/extensions",
		...buildConfig,
	},
];

for (const config of builds) {
	const result = await Bun.build(config as Parameters<typeof Bun.build>[0]);

	if (!result.success) {
		console.error("Build failed for entrypoints:", config.entrypoints);
		process.exit(1);
	}

	if (result.logs.length > 0) {
		for (const log of result.logs) {
			console.warn(log);
		}
	}
}

// File-based plugins run in a separate process, where packages bundled into a
// host executable are not visible to Node's module resolver. Emit one portable,
// shared-chunk runtime that contains the sandbox bootstrap and every @cline/*
// entry point promised by plugin-module-import.ts. Hosts copy this directory as
// a unit; aliases.json keeps import resolution inside the shipped artifact.
const pluginRuntimeEntries = [
	"./src/extensions/plugin/plugin-sandbox-bootstrap.ts",
	"./src/index.ts",
	"./src/hub/index.ts",
	"./src/hub/daemon/entry.ts",
	"./src/services/telemetry/index.ts",
	"../sdk/src/index.ts",
	"../agents/src/index.ts",
	"../llms/src/index.ts",
	"../llms/src/index.browser.ts",
	"../shared/src/index.ts",
	"../shared/src/index.browser.ts",
	"../shared/src/storage/index.ts",
	"../shared/src/db/index.ts",
	"../shared/src/types/index.ts",
	"../shared/src/automation/index.ts",
];
rmSync("./dist/plugin-runtime", { recursive: true, force: true });
const pluginRuntime = await Bun.build({
	entrypoints: pluginRuntimeEntries,
	root: "..",
	outdir: "./dist/plugin-runtime",
	target: "node",
	format: "esm",
	packages: "bundle",
	splitting: true,
	minify,
	sourcemap,
	// These packages are optional runtime integrations or native bindings. A
	// plugin that imports and uses the corresponding API must install it itself.
	external: [
		"better-sqlite3",
		"posthog-node",
		"@aws-sdk/client-bedrock-runtime",
		"ai-sdk-provider-claude-code",
		"ai-sdk-provider-codex-cli",
	],
});
if (!pluginRuntime.success) {
	console.error("Plugin runtime build failed", pluginRuntime.logs);
	process.exit(1);
}

const pluginRuntimeAliases = {
	"@cline/sdk": ["node_modules/@cline/sdk/index.js", "sdk/src/index.js"],
	"@cline/agents": ["node_modules/@cline/agents/index.js", "agents/src/index.js"],
	"@cline/core": ["node_modules/@cline/core/index.js", "core/src/index.js"],
	"@cline/core/hub": ["node_modules/@cline/core/hub.js", "core/src/hub/index.js"],
	"@cline/core/hub/daemon-entry": ["node_modules/@cline/core/hub-daemon-entry.js", "core/src/hub/daemon/entry.js"],
	"@cline/core/telemetry": ["node_modules/@cline/core/telemetry.js", "core/src/services/telemetry/index.js"],
	"@cline/llms": ["node_modules/@cline/llms/index.js", "llms/src/index.js"],
	"@cline/llms/browser": ["node_modules/@cline/llms/browser.js", "llms/src/index.browser.js"],
	"@cline/shared": ["node_modules/@cline/shared/index.js", "shared/src/index.js"],
	"@cline/shared/automation": ["node_modules/@cline/shared/automation.js", "shared/src/automation/index.js"],
	"@cline/shared/browser": ["node_modules/@cline/shared/browser.js", "shared/src/index.browser.js"],
	"@cline/shared/storage": ["node_modules/@cline/shared/storage.js", "shared/src/storage/index.js"],
	"@cline/shared/db": ["node_modules/@cline/shared/db.js", "shared/src/db/index.js"],
	"@cline/shared/types": ["node_modules/@cline/shared/types.js", "shared/src/types/index.js"],
} as const;
const aliasManifest: Record<string, string> = {};
for (const [specifier, [wrapperPath, targetPath]] of Object.entries(
	pluginRuntimeAliases,
)) {
	const wrapperAbsolutePath = resolve("./dist/plugin-runtime", wrapperPath);
	const targetAbsolutePath = resolve("./dist/plugin-runtime", targetPath);
	const wrapperImport = relative(dirname(wrapperAbsolutePath), targetAbsolutePath)
		.replaceAll("\\", "/");
	await Bun.write(
		wrapperAbsolutePath,
		`export * from ${JSON.stringify(wrapperImport.startsWith(".") ? wrapperImport : `./${wrapperImport}`)};\n`,
	);
	aliasManifest[specifier] = wrapperPath;
}
for (const packageName of ["sdk", "agents", "core", "llms", "shared"]) {
	await Bun.write(
		`./dist/plugin-runtime/node_modules/@cline/${packageName}/package.json`,
		JSON.stringify({ private: true, type: "module" }, null, 2) + "\n",
	);
}
await Bun.write(
	"./dist/plugin-runtime/aliases.json",
	JSON.stringify(aliasManifest, null, 2) + "\n",
);
await Bun.write(
	"./dist/plugin-runtime/package.json",
	JSON.stringify({ private: true, type: "module" }, null, 2) + "\n",
);
const requireFromCore = createRequire(import.meta.url);
const jitiRoot = dirname(requireFromCore.resolve("jiti/package.json"));
cpSync(jitiRoot, resolve("./dist/plugin-runtime/vendor/jiti"), {
	recursive: true,
});
