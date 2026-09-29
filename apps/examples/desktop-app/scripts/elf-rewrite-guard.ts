#!/usr/bin/env bun
// patchelf stand-in for linuxdeploy, wired up by scripts/tauri-build-linux.ts
// through linuxdeploy's `$PATCHELF` variable.
//
// Tauri's AppImage bundler hands the staged AppDir to linuxdeploy, which
// rewrites every executable it deploys: `patchelf --set-rpath '$ORIGIN/../lib'`
// so the binary finds the bundled libraries. That destroys a `bun build
// --compile` binary. The compiled program is carried in a non-allocated `.bun`
// ELF section and located by a fixed offset, which patchelf invalidates when
// it rewrites the file's layout. The desktop sidecar
// (src-tauri/bin/code-sidecar-*) and the UPX-packed SSH remote helpers are
// exactly those binaries.
//
// The corruption is invisible at bundle time and fatal right after: patchelf
// grows the sidecar by a page, the rewritten binary segfaults, and linuxdeploy
// aborts with "Failed to run ldd: exited with code 1" — a message that names
// neither patchelf nor the sidecar.
//
// So this forwards every call to the real patchelf except a rewrite of such a
// binary, which becomes a no-op. Nothing is lost by skipping it: the sidecar
// links only against libc/libm/libdl/libpthread, none of which linuxdeploy
// bundles into the AppImage, so it resolves through the system loader exactly
// as it does from the .deb and .rpm bundles.
//
// A PATH shim would not work: linuxdeploy ships its own patchelf inside its
// AppImage and prefers it over anything on PATH. `$PATCHELF` is the only hook.

import { closeSync, openSync, readSync, type Stats, statSync } from "node:fs";

const ELF_MAGIC = 0x7f454c46;
const ELF_CLASS_64 = 2;
const ELF_DATA_LITTLE_ENDIAN = 1;

const readAt = (fd: number, length: number, position: number): Buffer => {
	const buffer = Buffer.alloc(length);
	const read = readSync(fd, buffer, 0, length, position);
	return read === length ? buffer : buffer.subarray(0, read);
};

// True when the ELF carries a `.bun` section, i.e. it is a `bun build
// --compile` executable. Only 64-bit little-endian ELFs are parsed; that
// covers every target this repo builds, and anything else falls through to
// the real patchelf rather than being silently skipped.
const hasBunSection = (fd: number): boolean => {
	const header = readAt(fd, 64, 0);
	if (header.length < 64 || header.readUInt32BE(0) !== ELF_MAGIC) {
		return false;
	}
	if (header[4] !== ELF_CLASS_64 || header[5] !== ELF_DATA_LITTLE_ENDIAN) {
		return false;
	}

	const tableOffset = Number(header.readBigUInt64LE(0x28));
	const entrySize = header.readUInt16LE(0x3a);
	const entryCount = header.readUInt16LE(0x3c);
	const nameTableIndex = header.readUInt16LE(0x3e);
	// A UPX-packed or otherwise section-stripped ELF reports no section table.
	if (!tableOffset || entrySize < 40 || nameTableIndex >= entryCount) {
		return false;
	}

	const nameTableHeader = readAt(
		fd,
		entrySize,
		tableOffset + nameTableIndex * entrySize,
	);
	if (nameTableHeader.length < entrySize) {
		return false;
	}
	const nameTable = readAt(
		fd,
		Number(nameTableHeader.readBigUInt64LE(32)),
		Number(nameTableHeader.readBigUInt64LE(24)),
	);

	const sectionHeaders = readAt(fd, entrySize * entryCount, tableOffset);
	for (let index = 0; index < entryCount; index++) {
		const nameStart = sectionHeaders.readUInt32LE(index * entrySize);
		const nameEnd = nameTable.indexOf(0, nameStart);
		const name = nameTable
			.subarray(nameStart, nameEnd < 0 ? undefined : nameEnd)
			.toString("latin1");
		if (name === ".bun") {
			return true;
		}
	}
	return false;
};

// UPX-packed executables are just as unrewritable: the packer keeps its own
// header at the end of the file and the decompression stub resolves against
// fixed offsets. `UPX!` terminates that header.
const isUpxPacked = (fd: number, size: number): boolean => {
	const length = Math.min(128, size);
	return readAt(fd, length, size - length).includes("UPX!");
};

export const isRewriteProtected = (file: string): boolean => {
	let stats: Stats;
	try {
		stats = statSync(file);
	} catch {
		return false;
	}
	if (!stats.isFile() || stats.size < 64) {
		return false;
	}

	const fd = openSync(file, "r");
	try {
		return hasBunSection(fd) || isUpxPacked(fd, stats.size);
	} finally {
		closeSync(fd);
	}
};

// patchelf reads without writing only through its --print-* queries; every
// other flag rewrites the file in place.
const READ_ONLY_FLAGS: Record<string, true> = {
	"--version": true,
	"--help": true,
	"--debug": true,
};

export const protectedTargetsOf = (args: string[]): string[] => {
	const rewrites = args.some(
		(arg) =>
			arg.startsWith("--") &&
			!arg.startsWith("--print-") &&
			!READ_ONLY_FLAGS[arg],
	);
	if (!rewrites) {
		return [];
	}
	return args.filter((arg) => !arg.startsWith("-") && isRewriteProtected(arg));
};

const main = async (): Promise<number> => {
	const args = process.argv.slice(2);

	const skipped = protectedTargetsOf(args);
	if (skipped.length > 0) {
		console.error(
			`[elf-rewrite-guard] skipped patchelf on ${skipped.join(", ")}: rewriting would corrupt the embedded payload`,
		);
		return 0;
	}

	// No recursion risk: this script is never installed on PATH as `patchelf`,
	// only handed to linuxdeploy through $PATCHELF.
	const real = Bun.which("patchelf");
	if (!real) {
		throw new Error("no patchelf found on PATH");
	}

	const child = Bun.spawn([real, ...args], {
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	return await child.exited;
};

if (import.meta.main) {
	main()
		.then((code) => {
			process.exit(code);
		})
		.catch((error: unknown) => {
			console.error(error instanceof Error ? error.message : error);
			process.exit(1);
		});
}
