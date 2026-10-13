/// <reference types="@types/bun" />
/**
 * Stages the MXC sandbox runtime ("Keep changes inside this project") for one
 * platform into <destination>/node_modules so a packaged host can ship it next
 * to its executable. Compiled and bundled hosts cannot inline MXC because its
 * FFI layer (koffi) loads native files from its package directory.
 *
 * Usage: bun scripts/stage-mxc-runtime.ts <destination> [platform] [arch]
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

/**
 * Returns the staged @microsoft/mxc-sdk directory, or undefined when MXC
 * ships no native library for the target.
 */
export async function stageMxcRuntime(options: {
	destination: string;
	platform?: string;
	arch?: string;
}): Promise<string | undefined> {
	const platform = options.platform ?? process.platform;
	const arch = options.arch ?? process.arch;
	const mxcDir = packageDir(import.meta.url, "@microsoft/mxc-sdk");
	const library = join(mxcDir, "bin", arch, MXC_FFI_LIBRARY[platform] ?? "");
	if (!MXC_FFI_LIBRARY[platform] || !existsSync(library)) {
		console.warn(
			`MXC has no native runtime for ${platform}-${arch}; skipping.`,
		);
		return undefined;
	}
	const mxcPackageJson = join(mxcDir, "package.json");
	const koffiDir = packageDir(mxcPackageJson, "koffi");
	const modules = join(resolve(options.destination), "node_modules");
	rmSync(options.destination, { recursive: true, force: true });

	const stagedMxc = join(modules, "@microsoft", "mxc-sdk");
	mkdirSync(join(stagedMxc, "bin", arch), { recursive: true });
	for (const entry of ["package.json", "LICENSE.md", "dist"]) {
		cpSync(join(mxcDir, entry), join(stagedMxc, entry), {
			recursive: true,
			dereference: true,
			filter: (source) => !source.endsWith(".map"),
		});
	}
	cpSync(library, join(stagedMxc, "bin", arch, MXC_FFI_LIBRARY[platform]));

	const copyPackage = (source: string, name: string) =>
		cpSync(source, join(modules, name), { recursive: true, dereference: true });
	copyPackage(packageDir(mxcPackageJson, "semver"), "semver");
	copyPackage(koffiDir, "koffi");
	copyPackage(
		await koffiPlatformPackageDir(koffiDir, platform, arch),
		`@koromix/koffi-${platform}-${arch}`,
	);
	return stagedMxc;
}

if (import.meta.main) {
	const [destination, platform, arch] = process.argv.slice(2);
	if (!destination) {
		console.error(
			"Usage: bun scripts/stage-mxc-runtime.ts <destination> [platform] [arch]",
		);
		process.exit(1);
	}
	const staged = await stageMxcRuntime({ destination, platform, arch });
	if (staged) {
		console.log(`Staged MXC runtime at ${staged}`);
	}
}
