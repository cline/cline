/// <reference types="@types/bun" />
export {};

// Only externalize published packages; bundle internal workspace packages used by core.
const external = [
	"@clinebot/agents",
	"@clinebot/llms",
	"nanoid",
	"simple-git",
	"yaml",
	"zod",
];

const buildConfig = {
	target: "node",
	format: "esm",
	minify: true,
	packages: "bundle",
	sourcemap: "none",
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
		entrypoints: ["./src/hub/daemon-entry.ts"],
		outdir: "./dist/hub",
		...buildConfig,
	},
	{
		entrypoints: ["./src/services/telemetry/index.ts"],
		outdir: "./dist/services",
		...buildConfig,
	},
	// The plugin sandbox bootstrap runs in an isolated child process via
	// SubprocessSandbox and must be emitted as a standalone file with no
	// external dependencies.
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
