import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { packEmbeddedResources } from "./src/runtime/embedded-resources";

const packagesRoot = resolve(import.meta.dir, "..");
const outdir = resolve(import.meta.dir, "dist/plugin-runtime");

/** Run after SDK packages build, so the runtime uses the same compiled package exports. */
export async function buildPluginRuntime(): Promise<void> {
	const packages = ["sdk", "core", "agents", "llms", "shared"].map((name) => {
		const root = join(packagesRoot, name);
		const manifest = JSON.parse(
			readFileSync(join(root, "package.json"), "utf8"),
		) as {
			name: string;
			version: string;
			exports: Record<string, { import?: string } | string>;
		};
		const exports = Object.fromEntries(
			Object.entries(manifest.exports).flatMap(([subpath, entry]) => {
				const target = typeof entry === "string" ? entry : entry.import;
				// Declaration-only exports do not emit a JavaScript entrypoint.
				return target && existsSync(join(root, target))
					? [[subpath, target]]
					: [];
			}),
		);
		return { root, manifest, exports };
	});
	rmSync(outdir, { recursive: true, force: true });
	const results = await Promise.all([
		Bun.build({
			entrypoints: packages.flatMap(({ root, exports }) =>
				Object.values(exports).map((file) => join(root, file as string)),
			),
			root: packagesRoot,
			outdir: join(outdir, "node_modules/@cline"),
			naming: { chunk: "core/dist/[name]-[hash].[ext]" },
			target: "node",
			format: "esm",
			splitting: true,
			minify: true,
		}),
		Bun.build({
			entrypoints: [
				resolve(
					import.meta.dir,
					"./src/extensions/plugin/plugin-sandbox-bootstrap.ts",
				),
			],
			outdir,
			target: "node",
			format: "esm",
			minify: true,
		}),
	]);
	for (const result of results)
		if (!result.success)
			throw new AggregateError(result.logs, "Plugin runtime build failed");
	mkdirSync(outdir, { recursive: true });
	writeFileSync(
		join(outdir, "package.json"),
		JSON.stringify({
			name: "@cline/plugin-runtime",
			private: true,
			type: "module",
		}),
	);
	for (const { manifest, exports } of packages) {
		writeFileSync(
			join(outdir, "node_modules", manifest.name, "package.json"),
			JSON.stringify({
				name: manifest.name,
				version: manifest.version,
				type: "module",
				exports,
			}),
		);
	}
	const files: Record<string, string> = {};
	function collect(directory: string, prefix = "") {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const name = `${prefix}${entry.name}`;
			if (entry.isDirectory()) collect(join(directory, entry.name), `${name}/`);
			else if (entry.isFile())
				files[name] = readFileSync(join(directory, entry.name)).toString(
					"base64",
				);
		}
	}
	collect(outdir);
	writeFileSync(
		resolve(outdir, "../plugin-runtime-resources.json"),
		JSON.stringify(packEmbeddedResources(files)),
	);
}

if (import.meta.main) await buildPluginRuntime();
