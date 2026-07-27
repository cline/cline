/**
 * Rewrite an apps/vscode package.json to the nightly identity, in place.
 *
 * Reproduces updatePackageJson() from apps/vscode/scripts/publish-nightly.mjs
 * (the same script exists on BOTH main and legacy-extension — those copies are
 * the source of truth for the mutation; if they change, change this too):
 *   - textual rewrites: "claude-dev" -> "cline-nightly" everywhere, and every
 *     `"cline.` ID prefix -> `"cline-nightly.` (commands, settings, view IDs,
 *     when-clauses that START with the key — mid-string references like
 *     `config.cline.x` are NOT rewritten, same as the standalone nightly)
 *   - name / displayName / activity bar title / version
 *
 * Differences from publish-nightly.mjs, on purpose:
 *   - the version is an explicit ARGUMENT, not computed here: the combined
 *     VSIX applies ONE version to the next bundle, the legacy bundle, and the
 *     union manifest, so gen-manifest's identity-equality assertions hold.
 *   - no backup/restore, README swapping, or workspace-self-link reconciling:
 *     this runs against a disposable CI checkout, BEFORE the bundle build and
 *     never followed by vsce in that checkout (vsce only runs in the stitched
 *     staging dir with --no-dependencies).
 *
 * Run it AFTER dependency install (the workspace self-link resolution keys off
 * the original package name) and BEFORE the bundle's package build.
 *
 * Usage: node nightlify.mjs --dir <apps/vscode checkout> --version <x.y.ts>
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const NIGHTLY_NAME = "cline-nightly";
export const NIGHTLY_DISPLAY_NAME = "Cline (Nightly)";

export function nightlifyPackageJson(rawContent, version) {
	if (!version) {
		throw new Error("version is required");
	}
	const content = rawContent
		.replaceAll("claude-dev", NIGHTLY_NAME)
		.replaceAll('"cline.', `"${NIGHTLY_NAME}.`);
	const pkg = JSON.parse(content);

	pkg.name = NIGHTLY_NAME;
	pkg.displayName = NIGHTLY_DISPLAY_NAME;
	pkg.version = version;
	// publish-nightly.mjs assigns `.title` on the activitybar value directly,
	// which is a silent no-op on the real manifest (activitybar is an ARRAY —
	// JSON.stringify drops non-index properties). Retitle the actual entries.
	const activitybar = pkg.contributes?.viewsContainers?.activitybar;
	for (const container of Array.isArray(activitybar) ? activitybar : []) {
		container.title = NIGHTLY_DISPLAY_NAME;
	}

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
			"usage: node nightlify.mjs --dir <apps/vscode checkout> --version <x.y.ts>",
		);
		process.exit(1);
	}
	const packageJsonPath = path.join(dir, "package.json");
	const before = readFileSync(packageJsonPath, "utf8");
	const beforeName = JSON.parse(before).name;
	writeFileSync(packageJsonPath, nightlifyPackageJson(before, version));
	console.log(
		`nightlified ${packageJsonPath}: ${beforeName} -> ${NIGHTLY_NAME}@${version}`,
	);
}
