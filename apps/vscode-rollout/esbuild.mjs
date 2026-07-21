import esbuild from "esbuild";

const production = process.argv.includes("--production");

// Same build-time secret injection scheme as apps/vscode/esbuild.mjs: CI
// provides TELEMETRY_SERVICE_API_KEY; local builds leave it undefined and the
// loader skips all PostHog calls (everyone stays on legacy).
const define = {};
if (process.env.TELEMETRY_SERVICE_API_KEY) {
	define["process.env.TELEMETRY_SERVICE_API_KEY"] = JSON.stringify(
		process.env.TELEMETRY_SERVICE_API_KEY,
	);
}

await esbuild.build({
	entryPoints: ["src/extension.ts"],
	bundle: true,
	outfile: "dist/extension.js",
	platform: "node",
	format: "cjs",
	target: "node18",
	external: ["vscode"],
	minify: production,
	sourcemap: !production,
	define,
	logLevel: "info",
});
