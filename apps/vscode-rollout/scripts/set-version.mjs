/**
 * Stamp the combined VSIX's version into a bundle checkout's package.json,
 * in place, BEFORE that bundle builds.
 *
 * Why: the union manifest's version (what the Marketplace and auto-update
 * see) is supplied at stitch time, but each bundle's runtime reads its OWN
 * package.json — the About tab and every telemetry event's extension_version
 * come from there. Without this stamp the stable combined VSIX would report
 * three different versions (union input, main's base version, legacy's base
 * version) depending on where you look, which turns user bug reports into
 * archaeology. The nightly path gets the same alignment via nightlify.mjs
 * (which also rewrites identity); this script is the identity-preserving
 * version-only equivalent for the stable channel.
 *
 * Usage: node set-version.mjs --dir <apps/vscode checkout> --version <x.y.z>
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export function setPackageVersion(rawContent, version) {
	if (!version) {
		throw new Error("version is required");
	}
	const pkg = JSON.parse(rawContent);
	pkg.version = version;
	return `${JSON.stringify(pkg, null, "\t")}\n`;
}

function parseArgs(argv) {
	const args = {};
	for (let i = 2; i < argv.length; i += 2) {
		args[argv[i].replace(/^--/, "")] = argv[i + 1];
	}
	return args;
}

if (
	process.argv[1] &&
	import.meta.url === `file://${path.resolve(process.argv[1])}`
) {
	const { dir, version } = parseArgs(process.argv);
	if (!dir || !version) {
		console.error(
			"usage: node set-version.mjs --dir <apps/vscode checkout> --version <x.y.z>",
		);
		process.exit(1);
	}
	const packageJsonPath = path.join(dir, "package.json");
	const before = JSON.parse(readFileSync(packageJsonPath, "utf8")).version;
	writeFileSync(
		packageJsonPath,
		setPackageVersion(readFileSync(packageJsonPath, "utf8"), version),
	);
	console.log(`set ${packageJsonPath} version: ${before} -> ${version}`);
}
