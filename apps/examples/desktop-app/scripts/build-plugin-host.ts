import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { $ } from "bun";

// Plugins run in a sandbox process that imports @cline/core, @cline/shared,
// and friends from real files on disk, and jiti transpiles TypeScript plugins
// from its on-disk babel bundle. The npm-installed CLI gets all of that from
// its node_modules; the compiled sidecar has nothing on disk, so the desktop
// bundles the same tree as a Tauri resource (sidecar/plugin-host.ts locates
// it). The SDK packages come from this checkout, not the registry, so the
// tree always matches the sidecar's own SDK build.
const SDK_PACKAGES = ["shared", "llms", "agents", "core", "sdk"] as const;
const PRUNED_FILE_PATTERN = /\.(d\.[cm]?ts|map|mdx?)$/i;

const desktopDir = fileURLToPath(new URL("..", import.meta.url));
const sdkDir = join(desktopDir, "..", "..", "..", "sdk");
const outDir = join(desktopDir, "src-tauri", "plugin-host");

function readPackageVersion(packageDir: string): string {
	const pkg = JSON.parse(
		readFileSync(join(packageDir, "package.json"), "utf8"),
	) as { version: string };
	return pkg.version;
}

function pruneTree(dir: string): void {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			pruneTree(path);
		} else if (PRUNED_FILE_PATTERN.test(entry.name)) {
			rmSync(path);
		}
	}
}

export const buildPluginHost = async (): Promise<string> => {
	rmSync(outDir, { recursive: true, force: true });
	const packDir = join(outDir, ".pack");
	mkdirSync(packDir, { recursive: true });

	const dependencies: Record<string, string> = {};
	for (const name of SDK_PACKAGES) {
		const packageDir = join(sdkDir, "packages", name);
		await $`bun pm pack --destination ${packDir} --quiet`.cwd(packageDir);
		dependencies[`@cline/${name}`] =
			`file:./.pack/cline-${name}-${readPackageVersion(packageDir)}.tgz`;
	}
	const manifest = { name: "cline-desktop-plugin-host", private: true };
	// `bun pm pack` rewrites workspace:* to exact versions, so without the
	// overrides bun would fetch those from the registry as nested duplicates.
	await Bun.write(
		join(outDir, "package.json"),
		JSON.stringify(
			{ ...manifest, dependencies, overrides: dependencies },
			null,
			2,
		),
	);
	await $`bun install --production --no-save --ignore-scripts`.cwd(outDir);

	// The tarballs are only needed to install; leave a manifest that does not
	// point at files that no longer exist.
	rmSync(packDir, { recursive: true, force: true });
	await Bun.write(
		join(outDir, "package.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
	// Symlinked bin shims are useless here and trip up resource bundling.
	rmSync(join(outDir, "node_modules", ".bin"), {
		recursive: true,
		force: true,
	});
	pruneTree(join(outDir, "node_modules"));
	return outDir;
};

if (import.meta.main) {
	buildPluginHost().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
}
