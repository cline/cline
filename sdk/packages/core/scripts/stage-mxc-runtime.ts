/// <reference types="@types/bun" />
/**
 * Stages the MXC sandbox runtime ("Only allow edits in project directory") into
 * <destination>/node_modules so a packaged host can ship it next to its
 * executable. Compiled and bundled hosts cannot inline MXC because its FFI
 * layer (koffi) loads native files from its package directory.
 *
 * Usage: bun scripts/stage-mxc-runtime.ts <destination> [<platform>-<arch> | all]
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { $ } from "bun";

const MXC_FFI_LIBRARY: Record<string, string> = {
	linux: "libmxc_ffi.so",
	darwin: "libmxc_ffi.dylib",
	win32: "mxc_ffi.dll",
};

function packageDir(requireFrom: string, name: string): string {
	return dirname(createRequire(requireFrom).resolve(`${name}/package.json`));
}

async function koffiPlatformPackageDir(
	koffiDir: string,
	platform: string,
	arch: string,
): Promise<string> {
	const name = `@koromix/koffi-${platform}-${arch}`;
	try {
		return packageDir(join(koffiDir, "package.json"), name);
	} catch {
		// Only the host platform's variant is installed; fetch the others.
		const { version } = await Bun.file(join(koffiDir, "package.json")).json();
		const tarball = `https://registry.npmjs.org/${name}/-/koffi-${platform}-${arch}-${version}.tgz`;
		const response = await fetch(tarball);
		if (!response.ok) {
			throw new Error(`Failed to download ${tarball}: ${response.status}`);
		}
		const workDir = mkdtempSync(join(tmpdir(), "koffi-"));
		const archive = join(workDir, "package.tgz");
		await Bun.write(archive, response);
		await $`tar -xzf ${archive} -C ${workDir}`.quiet();
		return join(workDir, "package");
	}
}

export const ALL_MXC_TARGETS = [
	{ platform: "linux", arch: "x64" },
	{ platform: "linux", arch: "arm64" },
	{ platform: "darwin", arch: "arm64" },
	{ platform: "win32", arch: "x64" },
	{ platform: "win32", arch: "arm64" },
];

/**
 * Stages one runtime that serves every given target (MXC keeps each OS's
 * library under bin/<arch>/). Targets MXC ships no native library for are
 * skipped. Returns the staged @microsoft/mxc-sdk directory, or undefined
 * when no target is supported.
 */
export async function stageMxcRuntime(options: {
	destination: string;
	targets?: Array<{ platform: string; arch: string }>;
}): Promise<string | undefined> {
	const mxcDir = packageDir(import.meta.url, "@microsoft/mxc-sdk");
	const targets = (
		options.targets ?? [{ platform: process.platform, arch: process.arch }]
	).filter(({ platform, arch }) => {
		const library = MXC_FFI_LIBRARY[platform];
		if (library && existsSync(join(mxcDir, "bin", arch, library))) {
			return true;
		}
		console.warn(
			`MXC has no native runtime for ${platform}-${arch}; skipping.`,
		);
		return false;
	});
	rmSync(options.destination, { recursive: true, force: true });
	if (targets.length === 0) {
		return undefined;
	}
	const mxcPackageJson = join(mxcDir, "package.json");
	const koffiDir = packageDir(mxcPackageJson, "koffi");
	const modules = join(resolve(options.destination), "node_modules");
	const stagedMxc = join(modules, "@microsoft", "mxc-sdk");
	for (const entry of ["package.json", "LICENSE.md", "dist"]) {
		cpSync(join(mxcDir, entry), join(stagedMxc, entry), {
			recursive: true,
			dereference: true,
			filter: (source) => !source.endsWith(".map"),
		});
	}

	const copyPackage = (source: string, name: string) =>
		cpSync(source, join(modules, name), { recursive: true, dereference: true });
	copyPackage(packageDir(mxcPackageJson, "semver"), "semver");
	copyPackage(koffiDir, "koffi");
	for (const { platform, arch } of targets) {
		const library = MXC_FFI_LIBRARY[platform];
		mkdirSync(join(stagedMxc, "bin", arch), { recursive: true });
		cpSync(
			join(mxcDir, "bin", arch, library),
			join(stagedMxc, "bin", arch, library),
		);
		copyPackage(
			await koffiPlatformPackageDir(koffiDir, platform, arch),
			`@koromix/koffi-${platform}-${arch}`,
		);
	}
	return stagedMxc;
}

async function main(): Promise<void> {
	const [destination, target] = process.argv.slice(2);
	if (!destination) {
		console.error(
			"Usage: bun scripts/stage-mxc-runtime.ts <destination> [<platform>-<arch> | all]",
		);
		process.exit(1);
	}
	const [platform, arch] = target?.split("-") ?? [];
	const staged = await stageMxcRuntime({
		destination,
		targets:
			target === "all"
				? ALL_MXC_TARGETS
				: platform && arch
					? [{ platform, arch }]
					: undefined,
	});
	if (staged) {
		console.log(`Staged MXC runtime at ${staged}`);
	}
}

if (import.meta.main) {
	main().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
}
