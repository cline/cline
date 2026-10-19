import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { isBuiltin } from "node:module";
import { join, resolve } from "node:path";

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
				// Declaration-only exports need no runtime file. Declared JavaScript
				// exports must exist; silently omitting one ships an incomplete SDK.
				if (!target || /\.d\.[cm]?ts$/.test(target)) return [];
				if (!existsSync(join(root, target)))
					throw new Error(
						`Missing plugin runtime export ${manifest.name}${subpath === "." ? "" : subpath.slice(1)}: ${target}. Build the SDK before packaging.`,
					);
				return [[subpath, target]];
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
	// Any unresolved bare import would require node_modules beside a lone binary.
	// Validate every emitted module, including the SDK's split chunks.
	const scanner = new Bun.Transpiler({ loader: "js" });
	for (const file of new Bun.Glob("**/*.js").scanSync({ cwd: outdir })) {
		for (const { path } of scanner.scanImports(
			readFileSync(join(outdir, file), "utf8"),
		)) {
			if (
				!isBuiltin(path) &&
				!path.startsWith("./") &&
				!path.startsWith("../")
			) {
				throw new Error(
					`Plugin runtime is not self-contained: ${file} imports ${path}`,
				);
			}
		}
	}
}

if (import.meta.main) await buildPluginRuntime();
