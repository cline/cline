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

const builds: Parameters<typeof Bun.build>[0][] = [
	{
		entrypoints: [
			"./src/index.ts",
			"./src/hub/index.ts",
			"./src/services/telemetry/index.ts",
		],
		outdir: "./dist",
		target: "node",
		format: "esm",
		minify: true,
		packages: "bundle",
		sourcemap: "none",
		external,
	},
	// The plugin sandbox bootstrap runs in an isolated child process via
	// SubprocessSandbox and must be emitted as a standalone file with no
	// external dependencies.
	{
		entrypoints: ["./src/extensions/plugin/plugin-sandbox-bootstrap.ts"],
		outdir: "./dist/extensions",
		target: "node",
		format: "esm",
		minify: true,
		packages: "bundle",
		sourcemap: "none",
	},
];

for (const config of builds) {
	const result = await Bun.build(config as Parameters<typeof Bun.build>[0]);

	if (result.logs.length > 0) {
		for (const log of result.logs) {
			console.warn(log);
		}
	}
}
