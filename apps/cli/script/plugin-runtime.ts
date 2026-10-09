import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { $ } from "bun";

const repoRoot = resolve(import.meta.dir, "../../..");
let resources: Promise<{ hash: string; payload: string }> | undefined;

/** Embed disk-only plugin modules in every compiled CLI, including SSH runtimes. */
export function buildPluginRuntimeResources() {
	resources ??= buildResources();
	return resources;
}
async function buildResources() {
	const directory = mkdtempSync(join(tmpdir(), "cline-plugin-runtime-"));
	try {
		await $`bun build ${join(repoRoot, "sdk/packages/core/src/extensions/plugin/plugin-sandbox-bootstrap.ts")} --target=node --outfile ${join(directory, "plugin-sandbox-bootstrap.js")}`;
		const requireFromCore = createRequire(
			join(repoRoot, "sdk/packages/core/package.json"),
		);
		const jitiDir = dirname(requireFromCore.resolve("jiti/package.json"));
		await buildPluginHostSdk(directory);
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
		function collect(dir: string, prefix = "") {
			for (const entry of readdirSync(dir, { withFileTypes: true }).sort(
				(a, b) => a.name.localeCompare(b.name),
			)) {
				const name = prefix + entry.name;
				if (entry.isDirectory()) collect(join(dir, entry.name), `${name}/`);
				else files[name] = readFileSync(join(dir, entry.name), "utf8");
			}
		}
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

// Public SDK entry points a plugin may import. Anything a plugin could
// reasonably `import` is here; process entrypoints (hub daemon, remote helper)
// and optional peer boundaries are not.
const PLUGIN_HOST_SDK_SUBPATHS: Record<string, string[]> = {
	shared: [
		".",
		"./browser",
		"./storage",
		"./db",
		"./node",
		"./automation",
		"./remote-config",
	],
	llms: [".", "./browser"],
	agents: ["."],
	core: [".", "./hub", "./telemetry", "./cloud"],
	sdk: ["."],
};

// Plugins import the host SDK (`import { createTool } from "@cline/core"`).
// The sandbox resolves those specifiers to a `node_modules/@cline/<pkg>` it
// finds next to its bootstrap, which an npm install of the CLI provides and
// the packaged app does not. Ship one self-contained bundle of every public
// SDK entry point (the packages share most of their code) plus CommonJS
// package entry files exposing the corresponding namespace for each @cline/* export.
const buildPluginHostSdk = async (resourceDir: string): Promise<void> => {
	const sdkPackagesDir = join(repoRoot, "sdk/packages");
	const nodeModulesDir = join(resourceDir, "node_modules");
	const bundleDir = join(nodeModulesDir, "cline-host-sdk");
	const bundleFile = join(bundleDir, "index.cjs");
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

	await $`mkdir -p ${bundleDir}`;
	const entryFile = join(bundleDir, "entry.ts");
	await Bun.write(entryFile, `${entryLines.join("\n")}\n`);
	await $`bun build ${entryFile} --target=node --format=cjs --minify --outfile ${bundleFile}`;
	await $`rm ${entryFile}`;

	for (const shim of shims) {
		const shimDir = join(nodeModulesDir, "@cline", shim.pkg);
		await $`mkdir -p ${shimDir}`;
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
};
