/**
 * Build-time packing of the plugin sandbox resources a compiled host must
 * carry inside its binary. Consumed by every `bun build --compile` host
 * (desktop sidecar, SSH remote helper, CLI) through a `define`:
 *
 *   define: await pluginRuntimeDefine()
 *
 * `embedded-plugin-runtime.ts` in core reads that define and extracts the
 * files on first use, so plugins load without node, npm, or any on-disk
 * install next to the executable. Requires the SDK packages to be built
 * first (`bun run build:sdk`): the SDK bundle is produced from their `dist/`.
 */

import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const coreDir = resolve(import.meta.dir, "..");
const sdkPackagesDir = resolve(coreDir, "..");

export interface PluginRuntimeResources {
	hash: string;
	/** gzip(JSON of relative path -> file content), base64. */
	payload: string;
}

// Public SDK entry points a plugin may import. Process entrypoints (hub
// daemon, remote helper) and optional peer boundaries are deliberately absent.
const PLUGIN_HOST_SDK_SUBPATHS: Record<string, string[]> = {
	shared: [
		".",
		"./storage",
		"./db",
		"./node",
		"./automation",
		"./remote-config",
	],
	llms: ["."],
	agents: ["."],
	core: [".", "./hub", "./telemetry", "./cloud"],
	sdk: ["."],
};

let resources: Promise<PluginRuntimeResources> | undefined;

export function buildPluginRuntimeResources(): Promise<PluginRuntimeResources> {
	resources ??= buildResources();
	return resources;
}

/** `define` entries for `Bun.build` that embed the resources into a host. */
export async function pluginRuntimeDefine(): Promise<Record<string, string>> {
	return {
		CLINE_PLUGIN_RUNTIME_RESOURCES: JSON.stringify(
			await buildPluginRuntimeResources(),
		),
	};
}

async function bundle(options: {
	entrypoint: string;
	outfile: string;
	format?: "esm" | "cjs";
	minify?: boolean;
}): Promise<void> {
	const result = await Bun.build({
		entrypoints: [options.entrypoint],
		// Runtime-agnostic output: the sandbox runtime may be the host binary
		// re-executing itself as bun, or a node/bun pointed at via env.
		target: "node",
		format: options.format ?? "esm",
		minify: options.minify ?? false,
		outdir: dirname(options.outfile),
		naming: options.outfile.slice(dirname(options.outfile).length + 1),
		throw: false,
	});
	if (!result.success) {
		for (const log of result.logs) console.error(log);
		throw new Error(`Failed to bundle ${options.entrypoint}`);
	}
}

async function buildResources(): Promise<PluginRuntimeResources> {
	const directory = mkdtempSync(join(tmpdir(), "cline-plugin-runtime-"));
	try {
		// Self-contained bootstrap: inlines @cline/shared and jiti.
		await bundle({
			entrypoint: join(
				coreDir,
				"src/extensions/plugin/plugin-sandbox-bootstrap.ts",
			),
			outfile: join(directory, "plugin-sandbox-bootstrap.js"),
		});
		await buildPluginHostSdk(directory);

		// jiti lazily requires its babel transform relative to its own package,
		// which does not survive bundling. The bootstrap prefers a transform
		// found under a `node_modules/jiti` next to itself, so ship that.
		const requireFromCore = createRequire(join(coreDir, "package.json"));
		const jitiDir = dirname(requireFromCore.resolve("jiti/package.json"));
		const files: Record<string, string> = {
			"node_modules/jiti/package.json": readFileSync(
				join(jitiDir, "package.json"),
				"utf8",
			),
			"node_modules/jiti/dist/babel.cjs": readFileSync(
				join(jitiDir, "dist/babel.cjs"),
				"utf8",
			),
		};
		const collect = (dir: string, prefix = ""): void => {
			const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
				a.name.localeCompare(b.name),
			);
			for (const entry of entries) {
				const name = prefix + entry.name;
				if (entry.isDirectory()) collect(join(dir, entry.name), `${name}/`);
				else files[name] = readFileSync(join(dir, entry.name), "utf8");
			}
		};
		collect(directory);

		const json = JSON.stringify(files);
		return {
			hash: createHash("sha256").update(json).digest("hex"),
			payload: gzipSync(json).toString("base64"),
		};
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

// Plugins import the host SDK (`import { createTool } from "@cline/core"`).
// The sandbox resolves those specifiers to a `node_modules/@cline/<pkg>` next
// to its bootstrap. Emit one self-contained CommonJS bundle of every public
// SDK entry point (the packages share most of their code) plus a tiny shim
// package per @cline/* name whose exports point into it.
async function buildPluginHostSdk(resourceDir: string): Promise<void> {
	const nodeModulesDir = join(resourceDir, "node_modules");
	const bundleDir = join(nodeModulesDir, "cline-host-sdk");
	const namespaceFor = (pkg: string, subpath: string): string =>
		`${pkg}${subpath === "." ? "" : subpath.replace(/\W+/g, "_")}`;

	const entryLines: string[] = [];
	const shims: Array<{
		pkg: string;
		version: string;
		exports: Record<string, string>;
		files: Array<{ name: string; namespace: string }>;
	}> = [];
	for (const [pkg, subpaths] of Object.entries(PLUGIN_HOST_SDK_SUBPATHS)) {
		const packageDir = join(sdkPackagesDir, pkg);
		const manifest = (await Bun.file(
			join(packageDir, "package.json"),
		).json()) as {
			version: string;
			exports: Record<string, { import?: string } | string>;
		};
		const shim: (typeof shims)[number] = {
			pkg,
			version: manifest.version,
			exports: {},
			files: [],
		};
		for (const subpath of subpaths) {
			const exportValue = manifest.exports[subpath];
			const distEntry =
				typeof exportValue === "string" ? exportValue : exportValue?.import;
			if (!distEntry) {
				throw new Error(`@cline/${pkg} has no "${subpath}" export`);
			}
			const namespace = namespaceFor(pkg, subpath);
			entryLines.push(
				`export * as ${namespace} from ${JSON.stringify(join(packageDir, distEntry))};`,
			);
			const fileName =
				subpath === "."
					? "index.cjs"
					: `${subpath.slice(2).replace(/\//g, "-")}.cjs`;
			shim.exports[subpath] = `./${fileName}`;
			shim.files.push({ name: fileName, namespace });
		}
		shims.push(shim);
	}

	const entryFile = join(bundleDir, "entry.ts");
	await Bun.write(entryFile, `${entryLines.join("\n")}\n`);
	await bundle({
		entrypoint: entryFile,
		outfile: join(bundleDir, "index.cjs"),
		format: "cjs",
		minify: true,
	});
	rmSync(entryFile);

	for (const shim of shims) {
		const shimDir = join(nodeModulesDir, "@cline", shim.pkg);
		await Bun.write(
			join(shimDir, "package.json"),
			`${JSON.stringify(
				{
					name: `@cline/${shim.pkg}`,
					version: shim.version,
					private: true,
					exports: shim.exports,
				},
				null,
				"\t",
			)}\n`,
		);
		for (const file of shim.files) {
			await Bun.write(
				join(shimDir, file.name),
				`module.exports = require("../../cline-host-sdk/index.cjs").${file.namespace};\n`,
			);
		}
	}
}
