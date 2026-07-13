/**
 * Assemble the combined (loader + next + legacy) VSIX staging directory.
 *
 * Layout produced:
 *   <out>/
 *     extension.js        loader bundle (this package's dist/extension.js)
 *     package.json        union manifest (gen-manifest.mjs)
 *     README.md           next's marketplace README
 *     LICENSE, CHANGELOG.md, assets/, walkthrough/   from next (manifest-referenced, VSIX-root-relative)
 *     next/               SDK extension payload   (dist/, webview-ui/build/, assets/, package.json)
 *     legacy/             legacy extension payload (dist/, webview-ui/build/, assets/,
 *                         node_modules/@vscode/codicons/dist/, package.json)
 *
 * Each bundle resolves its own resources under its subdirectory because the
 * loader hands it an ExtensionContext whose extensionUri/extensionPath point
 * there (see src/scoped-context.ts). Manifest-referenced resources (icons,
 * walkthrough media, codicon font declared in contributes.icons) resolve from
 * the VSIX root, where the stitcher places next's copies.
 *
 * Usage:
 *   node stitch.mjs --next <apps/vscode dir, built> --legacy <apps/vscode dir, built> \
 *     --loader <dist/extension.js> --version <x.y.z> --out <staging dir>
 */
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { generateManifest } from "./gen-manifest.mjs";

// Legacy's webview loads codicon.css straight from node_modules (see its
// WebviewProvider); next bundles the font into its webview build but its own
// .vscodeignore still re-includes the codicons dist, so mirror that here.
const BUNDLE_PAYLOAD = {
	next: [
		"dist",
		"webview-ui/build",
		"assets",
		"package.json",
		"node_modules/@vscode/codicons/dist",
	],
	legacy: [
		"dist",
		"webview-ui/build",
		"assets",
		"package.json",
		"node_modules/@vscode/codicons/dist",
	],
};

/** VSIX-root files, all taken from the next checkout (manifest fields come from next too). */
const ROOT_PAYLOAD = ["LICENSE", "CHANGELOG.md", "assets", "walkthrough"];

function parseArgs(argv) {
	const args = {};
	for (let i = 2; i < argv.length; i += 2) {
		args[argv[i].replace(/^--/, "")] = argv[i + 1];
	}
	return args;
}

function copyInto(sourceRoot, relPaths, destRoot, { optional = [] } = {}) {
	for (const rel of relPaths) {
		const source = path.join(sourceRoot, rel);
		if (!existsSync(source)) {
			if (optional.includes(rel)) {
				console.warn(`  skip (missing, optional): ${rel}`);
				continue;
			}
			throw new Error(
				`required payload missing: ${source} — did the bundle build run?`,
			);
		}
		cpSync(source, path.join(destRoot, rel), {
			recursive: true,
			dereference: true,
		});
		console.log(`  + ${rel}`);
	}
}

export function stitch({ next, legacy, loader, version, out }) {
	for (const [name, value] of Object.entries({
		next,
		legacy,
		loader,
		version,
		out,
	})) {
		if (!value) {
			throw new Error(`--${name} is required`);
		}
	}
	// Refuse to stage from an unbuilt tree early, with a clear message.
	for (const [name, root] of [
		["next", next],
		["legacy", legacy],
	]) {
		if (!existsSync(path.join(root, "dist", "extension.js"))) {
			throw new Error(
				`${name} bundle not built: ${root}/dist/extension.js missing`,
			);
		}
		if (
			!existsSync(path.join(root, "webview-ui", "build", "assets", "index.js"))
		) {
			throw new Error(
				`${name} webview not built: ${root}/webview-ui/build/assets/index.js missing`,
			);
		}
	}

	rmSync(out, { recursive: true, force: true });
	mkdirSync(out, { recursive: true });

	console.log("root payload (from next):");
	copyInto(next, ROOT_PAYLOAD, out, {
		optional: ["CHANGELOG.md", "walkthrough"],
	});
	cpSync(loader, path.join(out, "extension.js"));
	console.log("  + extension.js (loader)");

	const readme = path.join(next, "README.marketplace.md");
	cpSync(
		existsSync(readme) ? readme : path.join(next, "README.md"),
		path.join(out, "README.md"),
	);
	console.log("  + README.md");

	for (const [bundle, payload] of Object.entries(BUNDLE_PAYLOAD)) {
		const sourceRoot = bundle === "next" ? next : legacy;
		console.log(`${bundle} payload:`);
		copyInto(sourceRoot, payload, path.join(out, bundle), {
			optional: ["walkthrough"],
		});
	}

	const manifest = generateManifest(
		JSON.parse(readFileSync(path.join(next, "package.json"), "utf8")),
		JSON.parse(readFileSync(path.join(legacy, "package.json"), "utf8")),
		version,
	);
	writeFileSync(
		path.join(out, "package.json"),
		`${JSON.stringify(manifest, null, "\t")}\n`,
	);
	console.log("  + package.json (union manifest)");

	// vsce packages everything in the staging dir; only strip sourcemaps and
	// junk. The codicons files under legacy/node_modules must survive, so no
	// blanket node_modules ignore here — staging only ever contains what this
	// script copied.
	writeFileSync(
		path.join(out, ".vscodeignore"),
		["**/*.map", "**/.DS_Store", ""].join("\n"),
	);

	console.log(`\nstaged ${out} (version ${version})`);
	console.log(
		`package it with:\n  cd ${out} && vsce package --no-dependencies --allow-package-secrets sendgrid`,
	);
}

if (
	process.argv[1] &&
	import.meta.url === `file://${path.resolve(process.argv[1])}`
) {
	try {
		stitch(parseArgs(process.argv));
	} catch (error) {
		console.error(`stitch failed: ${error.message}`);
		process.exit(1);
	}
}
