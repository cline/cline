import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// The helper ships as CommonJS in the published wrapper package, so it is
// loaded via require rather than an ESM import.
const binaryInstall = require("../../bin/binary-install.cjs") as {
	DEFAULT_REGISTRY: string;
	getPlatformTarget: (
		platform: string,
		arch: string,
	) =>
		| { packageName: string; binaryName: string; cacheName: string }
		| undefined;
	resolveRegistryBase: (env: Record<string, string | undefined>) => string;
	buildTarballUrl: (
		registryBase: string,
		packageName: string,
		version: string,
	) => string;
	extractEntryFromTarGz: (
		tgzBuffer: Buffer,
		entryPath: string,
	) => Buffer | undefined;
	installBinaryFromRegistry: (options: {
		packageName: string;
		version: string;
		binaryName: string;
		destPath: string;
		env?: Record<string, string | undefined>;
		downloadImpl?: (url: string) => Promise<Buffer>;
	}) => Promise<string>;
	missingBinaryHelp: (packageName: string) => string;
};

// Builds a real .tgz with the system tar so extraction is validated against
// genuine tar output rather than a hand-rolled archive.
function makeTarGz(dir: string, files: Record<string, Buffer | string>) {
	for (const [entryPath, contents] of Object.entries(files)) {
		const filePath = join(dir, entryPath);
		mkdirSync(join(filePath, ".."), { recursive: true });
		writeFileSync(filePath, contents);
	}
	const result = spawnSync(
		"tar",
		["-czf", "archive.tgz", ...Object.keys(files).map((f) => f.split("/")[0])],
		{ cwd: dir },
	);
	expect(result.status).toBe(0);
	return readFileSync(join(dir, "archive.tgz"));
}

describe("binary-install", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "cline-binary-install-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	describe("getPlatformTarget", () => {
		it("maps win32 x64 to the windows package with an .exe binary", () => {
			expect(binaryInstall.getPlatformTarget("win32", "x64")).toEqual({
				packageName: "@cline/cli-windows-x64",
				binaryName: "cline.exe",
				cacheName: ".cline.exe",
			});
		});

		it("maps posix platforms", () => {
			expect(binaryInstall.getPlatformTarget("linux", "x64")).toEqual({
				packageName: "@cline/cli-linux-x64",
				binaryName: "cline",
				cacheName: ".cline",
			});
			expect(binaryInstall.getPlatformTarget("darwin", "arm64")).toEqual({
				packageName: "@cline/cli-darwin-arm64",
				binaryName: "cline",
				cacheName: ".cline",
			});
		});

		it("returns undefined for unsupported platforms", () => {
			expect(binaryInstall.getPlatformTarget("freebsd", "x64")).toBeUndefined();
			expect(binaryInstall.getPlatformTarget("linux", "ia32")).toBeUndefined();
		});
	});

	describe("resolveRegistryBase", () => {
		it("defaults to the public npm registry", () => {
			expect(binaryInstall.resolveRegistryBase({})).toBe(
				"https://registry.npmjs.org",
			);
		});

		it("uses npm_config_registry and strips trailing slashes", () => {
			expect(
				binaryInstall.resolveRegistryBase({
					npm_config_registry: "https://registry.npmmirror.com/",
				}),
			).toBe("https://registry.npmmirror.com");
		});

		it("ignores malformed registry values", () => {
			expect(
				binaryInstall.resolveRegistryBase({ npm_config_registry: "not-a-url" }),
			).toBe("https://registry.npmjs.org");
		});
	});

	describe("buildTarballUrl", () => {
		it("builds scoped tarball URLs with the unscoped filename", () => {
			expect(
				binaryInstall.buildTarballUrl(
					"https://registry.npmjs.org",
					"@cline/cli-windows-x64",
					"3.0.49",
				),
			).toBe(
				"https://registry.npmjs.org/@cline/cli-windows-x64/-/cli-windows-x64-3.0.49.tgz",
			);
		});
	});

	describe("extractEntryFromTarGz", () => {
		it("extracts a file from a gzipped tarball", () => {
			const contents = Buffer.from("binary contents \x00\x01\x02", "latin1");
			const tgz = makeTarGz(dir, {
				"package/package.json": '{"name":"@cline/cli-windows-x64"}',
				"package/bin/cline.exe": contents,
			});
			const extracted = binaryInstall.extractEntryFromTarGz(
				tgz,
				"package/bin/cline.exe",
			);
			expect(extracted).toBeDefined();
			expect(Buffer.compare(extracted as Buffer, contents)).toBe(0);
		});

		it("returns undefined when the entry is missing", () => {
			const tgz = makeTarGz(dir, {
				"package/package.json": "{}",
			});
			expect(
				binaryInstall.extractEntryFromTarGz(tgz, "package/bin/cline.exe"),
			).toBeUndefined();
		});
	});

	describe("installBinaryFromRegistry", () => {
		it("downloads, extracts, and writes the binary with exec permissions", async () => {
			const contents = Buffer.from("#!/bin/sh\necho fake-cline\n");
			const tgz = makeTarGz(dir, { "package/bin/cline": contents });
			const requestedUrls: string[] = [];
			const destPath = join(dir, "out", ".cline");

			const written = await binaryInstall.installBinaryFromRegistry({
				packageName: "@cline/cli-linux-x64",
				version: "3.0.49",
				binaryName: "cline",
				destPath,
				env: { npm_config_registry: "https://registry.example.com/" },
				downloadImpl: async (url) => {
					requestedUrls.push(url);
					return tgz;
				},
			});

			expect(written).toBe(destPath);
			expect(requestedUrls).toEqual([
				"https://registry.example.com/@cline/cli-linux-x64/-/cli-linux-x64-3.0.49.tgz",
			]);
			expect(Buffer.compare(readFileSync(destPath), contents)).toBe(0);
			expect(statSync(destPath).mode & 0o111).not.toBe(0);
			// No temp files left behind
			expect(existsSync(`${destPath}.download-${process.pid}`)).toBe(false);
		});

		it("rejects when the tarball does not contain the binary", async () => {
			const tgz = makeTarGz(dir, { "package/package.json": "{}" });
			await expect(
				binaryInstall.installBinaryFromRegistry({
					packageName: "@cline/cli-linux-x64",
					version: "3.0.49",
					binaryName: "cline",
					destPath: join(dir, ".cline"),
					env: {},
					downloadImpl: async () => tgz,
				}),
			).rejects.toThrow("Could not find package/bin/cline");
		});
	});

	describe("missingBinaryHelp", () => {
		it("names the missing package and suggests remedies", () => {
			const help = binaryInstall.missingBinaryHelp("@cline/cli-windows-x64");
			expect(help).toContain("@cline/cli-windows-x64");
			expect(help).toContain("npm install -g cline --force");
			expect(help).toContain("--omit=optional");
		});
	});
});
