import { describe, expect, test } from "bun:test";
import {
	isExpectedElfExecutable,
	resolveWindowsCrossCompileRuntime,
} from "./bun-cross-compile-runtime";

describe("resolveWindowsCrossCompileRuntime", () => {
	test("maps Bun's x64 target to its pinned release asset and cache name", () => {
		expect(
			resolveWindowsCrossCompileRuntime("bun-linux-x64", "1.3.13"),
		).toMatchObject({
			archiveName: "bun-linux-x64",
			cacheFilename: "bun-linux-x64-v1.3.13",
			downloadUrl:
				"https://github.com/oven-sh/bun/releases/download/bun-v1.3.13/bun-linux-x64.zip",
			expectedMachine: 62,
		});
	});

	test("maps Bun's arm64 target to its aarch64 asset and cache name", () => {
		expect(
			resolveWindowsCrossCompileRuntime("bun-linux-arm64", "1.3.13"),
		).toMatchObject({
			archiveName: "bun-linux-aarch64",
			cacheFilename: "bun-linux-aarch64-v1.3.13",
			expectedMachine: 183,
		});
	});

	test("does not intercept native or non-Linux targets", () => {
		expect(
			resolveWindowsCrossCompileRuntime("bun-windows-x64", "1.3.13"),
		).toBeUndefined();
		expect(
			resolveWindowsCrossCompileRuntime("bun-darwin-arm64", "1.3.13"),
		).toBeUndefined();
	});

	test("fails closed when Bun changes without updated checksums", () => {
		expect(() =>
			resolveWindowsCrossCompileRuntime("bun-linux-x64", "1.3.14"),
		).toThrow("requires Bun 1.3.13");
	});
});

describe("isExpectedElfExecutable", () => {
	const elfHeader = (machine: number): Uint8Array => {
		const header = new Uint8Array(20);
		header.set([0x7f, 0x45, 0x4c, 0x46]);
		header[5] = 1;
		header[18] = machine & 0xff;
		header[19] = (machine >> 8) & 0xff;
		return header;
	};

	test("accepts the expected little-endian ELF architecture", () => {
		expect(isExpectedElfExecutable(elfHeader(62), 62)).toBe(true);
		expect(isExpectedElfExecutable(elfHeader(183), 183)).toBe(true);
	});

	test("rejects the wrong architecture and malformed files", () => {
		expect(isExpectedElfExecutable(elfHeader(62), 183)).toBe(false);
		expect(isExpectedElfExecutable(new Uint8Array(20), 62)).toBe(false);
		expect(isExpectedElfExecutable(new Uint8Array(10), 62)).toBe(false);
	});
});
