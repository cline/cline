import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
	binaryArchitectures,
	encoderSource,
	encoderTarget,
	matchesTarget,
	playwrightCacheDir,
} from "./stage-video-encoder";

const header = (bytes: Array<[number, number, "LE" | "BE" | 16]>) => {
	const buffer = Buffer.alloc(256);
	for (const [offset, value, kind] of bytes) {
		if (kind === "LE") buffer.writeUInt32LE(value, offset);
		else if (kind === "BE") buffer.writeUInt32BE(value, offset);
		else buffer.writeUInt16LE(value, offset);
	}
	return buffer;
};
const MACHO_ARM64 = header([
	[0, 0xfeedfacf, "LE"],
	[4, 0x0100000c, "LE"],
]);
const MACHO_X64 = header([
	[0, 0xfeedfacf, "LE"],
	[4, 0x01000007, "LE"],
]);
const MACHO_FAT = header([
	[0, 0xcafebabe, "BE"],
	[4, 2, "BE"],
	[8, 0x01000007, "BE"],
	[28, 0x0100000c, "BE"],
]);
const ELF_X64 = (() => {
	const buffer = header([[18, 0x3e, 16]]);
	buffer.write("\x7fELF", 0, "latin1");
	return buffer;
})();
const PE_X64 = (() => {
	const buffer = header([
		[0x3c, 0x80, "LE"],
		[0x84, 0x8664, 16],
	]);
	buffer.write("MZ", 0, "latin1");
	buffer.write("PE\0\0", 0x80, "latin1");
	return buffer;
})();

describe("encoderTarget", () => {
	test("maps each desktop build target to Playwright's binary and installer platform", () => {
		const summary = (triple: string) => {
			const target = encoderTarget(triple);
			return [
				target.binary,
				target.format,
				target.slices.map(
					(slice) => `${slice.arch}@${slice.installerPlatform}`,
				),
			];
		};
		expect(summary("aarch64-apple-darwin")).toEqual([
			"ffmpeg-mac",
			"macho",
			["arm64@mac15-arm64"],
		]);
		expect(summary("x86_64-apple-darwin")).toEqual([
			"ffmpeg-mac",
			"macho",
			["x64@mac15"],
		]);
		expect(summary("universal-apple-darwin")).toEqual([
			"ffmpeg-mac",
			"macho",
			["arm64@mac15-arm64", "x64@mac15"],
		]);
		expect(summary("x86_64-pc-windows-msvc")).toEqual([
			"ffmpeg-win64.exe",
			"pe",
			["x64@win64"],
		]);
		expect(summary("x86_64-unknown-linux-gnu")).toEqual([
			"ffmpeg-linux",
			"elf",
			["x64@ubuntu22.04-x64"],
		]);
		expect(summary("aarch64-unknown-linux-gnu")).toEqual([
			"ffmpeg-linux",
			"elf",
			["arm64@ubuntu22.04-arm64"],
		]);
		expect(() => encoderTarget("aarch64-pc-windows-msvc")).toThrow(
			/no video encoder build/,
		);
	});
});

test("playwrightCacheDir follows Playwright's default per OS and an explicit path", () => {
	expect(playwrightCacheDir("darwin", {}, "/h")).toBe(
		path.join("/h", "Library", "Caches", "ms-playwright"),
	);
	expect(playwrightCacheDir("linux", {}, "/h")).toBe(
		path.join("/h", ".cache", "ms-playwright"),
	);
	expect(playwrightCacheDir("linux", { XDG_CACHE_HOME: "/x" }, "/h")).toBe(
		path.join("/x", "ms-playwright"),
	);
	expect(playwrightCacheDir("win32", { LOCALAPPDATA: "/l" }, "/h")).toBe(
		path.join("/l", "ms-playwright"),
	);
	expect(
		playwrightCacheDir("darwin", { PLAYWRIGHT_BROWSERS_PATH: "/p" }, "/h"),
	).toBe(path.resolve("/p"));
});

test("binaryArchitectures reads Mach-O, fat Mach-O, ELF and PE headers", () => {
	expect(binaryArchitectures(MACHO_ARM64)).toEqual({
		format: "macho",
		archs: ["arm64"],
	});
	expect(binaryArchitectures(MACHO_FAT)).toEqual({
		format: "macho",
		archs: ["x64", "arm64"],
	});
	expect(binaryArchitectures(ELF_X64)).toEqual({
		format: "elf",
		archs: ["x64"],
	});
	expect(binaryArchitectures(PE_X64)).toEqual({ format: "pe", archs: ["x64"] });
	expect(binaryArchitectures(Buffer.from("#!/bin/sh\n".padEnd(80)))).toBe(
		undefined,
	);
	const universal = encoderTarget("universal-apple-darwin");
	expect(matchesTarget(binaryArchitectures(MACHO_FAT), universal)).toBe(true);
	expect(matchesTarget(binaryArchitectures(MACHO_ARM64), universal)).toBe(
		false,
	);
});

describe("encoderSource", () => {
	const arm64 = encoderTarget("aarch64-apple-darwin");
	const x64 = encoderTarget("x86_64-apple-darwin");
	const slice = (target: typeof arm64) =>
		target.slices[0] as (typeof arm64.slices)[0];

	test("copies a complete cached install of the target's architecture", () => {
		expect(
			encoderSource(arm64, slice(arm64), {
				complete: true,
				header: MACHO_ARM64,
			}),
		).toBe("cache");
	});

	test("installs when the cache is missing, incomplete or another architecture", () => {
		expect(encoderSource(arm64, slice(arm64), { complete: false })).toBe(
			"installer",
		);
		expect(
			encoderSource(arm64, slice(arm64), {
				complete: false,
				header: MACHO_ARM64,
			}),
		).toBe("installer");
		// An Apple silicon build machine's cache must not ship in an Intel build.
		expect(
			encoderSource(x64, slice(x64), { complete: true, header: MACHO_ARM64 }),
		).toBe("installer");
		expect(
			encoderSource(encoderTarget("x86_64-unknown-linux-gnu"), slice(x64), {
				complete: true,
				header: MACHO_X64,
			}),
		).toBe("installer");
	});
});
