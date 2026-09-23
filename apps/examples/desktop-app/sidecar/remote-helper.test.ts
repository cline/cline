import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { remoteHelperBinaryFilename } from "@cline/core";
import { expect, it } from "vitest";
import { resolveDesktopRemoteHelper } from "./remote-helper";

it("finds SSH helpers in the installed Windows resource layout", () => {
	const root = mkdtempSync(join(tmpdir(), "cline-packaged-helpers-"));
	try {
		const target = { platform: "linux", arch: "x64" } as const;
		const directory = join(root, "bin", "remote-helpers");
		mkdirSync(directory, { recursive: true });
		const helper = join(directory, remoteHelperBinaryFilename(target));
		writeFileSync(helper, "helper");
		expect(
			resolveDesktopRemoteHelper(target, {
				execPath: join(root, "code-sidecar.exe"),
				cwd: tmpdir(),
				env: {},
			}),
		).toBe(helper);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

// First 8 bytes of a universal (fat) Mach-O and of a thin arm64 Mach-O.
const FAT_MACHO_HEADER = Buffer.from("cafebabe00000002", "hex");
const THIN_ARM64_MACHO_HEADER = Buffer.from("cffaedfe0c000001", "hex");

it("uses the packaged universal macOS sidecar as the helper for Mac remotes", () => {
	const root = mkdtempSync(join(tmpdir(), "cline-packaged-helpers-"));
	try {
		const macOS = join(root, "Cline.app", "Contents", "MacOS");
		mkdirSync(macOS, { recursive: true });
		const sidecar = join(macOS, "code-sidecar");
		writeFileSync(sidecar, FAT_MACHO_HEADER);
		for (const arch of ["arm64", "x64"] as const) {
			expect(
				resolveDesktopRemoteHelper(
					{ platform: "darwin", arch },
					{ execPath: sidecar, cwd: tmpdir(), env: {}, platform: "darwin" },
				),
			).toBe(sidecar);
		}
		expect(
			resolveDesktopRemoteHelper(
				{ platform: "linux", arch: "arm64" },
				{ execPath: sidecar, cwd: tmpdir(), env: {}, platform: "darwin" },
			),
		).toBeUndefined();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it("only offers a thin packaged macOS sidecar to Mac remotes of its own architecture", () => {
	const root = mkdtempSync(join(tmpdir(), "cline-packaged-helpers-"));
	try {
		const macOS = join(root, "Cline.app", "Contents", "MacOS");
		mkdirSync(macOS, { recursive: true });
		const sidecar = join(macOS, "code-sidecar");
		writeFileSync(sidecar, THIN_ARM64_MACHO_HEADER);
		const options = {
			execPath: sidecar,
			cwd: tmpdir(),
			env: {},
			platform: "darwin" as const,
		};
		expect(
			resolveDesktopRemoteHelper(
				{ platform: "darwin", arch: "arm64" },
				options,
			),
		).toBe(sidecar);
		expect(
			resolveDesktopRemoteHelper({ platform: "darwin", arch: "x64" }, options),
		).toBeUndefined();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it("uses the compiled sidecar for Mac remotes under tauri dev on macOS", () => {
	const root = mkdtempSync(join(tmpdir(), "cline-dev-helpers-"));
	try {
		const bin = join(root, "src-tauri", "bin");
		mkdirSync(bin, { recursive: true });
		const sidecar = join(bin, "code-sidecar-aarch64-apple-darwin");
		writeFileSync(sidecar, "sidecar");
		const options = {
			execPath: "/usr/local/bin/bun",
			cwd: root,
			env: {},
			platform: "darwin" as const,
		};
		expect(
			resolveDesktopRemoteHelper(
				{ platform: "darwin", arch: "arm64" },
				options,
			),
		).toBe(sidecar);
		expect(
			resolveDesktopRemoteHelper({ platform: "darwin", arch: "x64" }, options),
		).toBeUndefined();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it("finds SSH helpers in the installed Linux resource layout", () => {
	const root = mkdtempSync(join(tmpdir(), "cline-packaged-helpers-"));
	try {
		const target = { platform: "linux", arch: "arm64" } as const;
		const directory = join(
			root,
			"usr",
			"lib",
			"Cline Beta",
			"bin",
			"remote-helpers",
		);
		mkdirSync(directory, { recursive: true });
		const helper = join(directory, remoteHelperBinaryFilename(target));
		writeFileSync(helper, "helper");
		expect(
			resolveDesktopRemoteHelper(target, {
				execPath: join(root, "usr", "bin", "code-sidecar"),
				cwd: tmpdir(),
				env: {},
			}),
		).toBe(helper);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
