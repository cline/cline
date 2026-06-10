/**
 * Unit tests for the pure helper functions from bin/resolver-helpers.cjs.
 *
 * Why: bin/cline is a plain Node CommonJS script whose top-level code calls
 * process.exit() when no binary is found, making it impossible to require()
 * in tests. The pure logic is extracted into bin/resolver-helpers.cjs so it
 * can be tested in isolation without any platform side effects.
 *
 * Test coverage:
 *   (a) buildNames for x64 without AVX2 = ["@cline/cli-linux-x64-baseline","@cline/cli-linux-x64"]
 *   (b) buildNames for x64 with AVX2    = ["@cline/cli-linux-x64"]
 *   (c) cpuHasAvx2 with an AVX2 cpuinfo line → true
 *   (d) cpuHasAvx2 without avx2 flag (Sandy Bridge) → false
 *   (e) cpuHasAvx2 must not match "avx" alone or "avx512" as "avx2"
 */

import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Import the CJS helper module directly. createRequire lets us load a .cjs
// file from an ESM/vitest context without fighting the module system.
const requireCjs = createRequire(import.meta.url);
const helpers = requireCjs(
	join(import.meta.dirname, "..", "bin", "resolver-helpers.cjs"),
) as {
	cpuHasAvx2: (text: string) => boolean;
	buildNames: (base: string, arch: string, hasAvx2: boolean) => string[];
};
const { cpuHasAvx2, buildNames } = helpers;

// ── Sample /proc/cpuinfo excerpts ─────────────────────────────────────────────

const AVX2_CPUINFO = `
processor	: 0
flags		: fpu vme de pse tsc msr pae mce cx8 apic sep mtrr pge mca cmov pat pse36 clflush mmx fxsr sse sse2 ss ht syscall nx rdtscp lm constant_tsc avx avx2 f16c rdrand lahf_lm
`;

// Intel Sandy Bridge / Xeon E5-2620 v1: has avx but NOT avx2
const NO_AVX2_CPUINFO = `
processor	: 0
flags		: fpu vme de pse tsc msr pae mce cx8 apic sep mtrr pge mca cmov pat pse36 clflush mmx fxsr sse sse2 ss ht syscall nx rdtscp lm constant_tsc avx pclmulqdq aes f16c rdrand lahf_lm
`;

// Tricky case: avx512 contains "avx" but not "avx2"
const AVX512_NO_AVX2_CPUINFO = `
processor	: 0
flags		: fpu avx avx512f avx512dq
`;

// ── cpuHasAvx2 ────────────────────────────────────────────────────────────────

describe("cpuHasAvx2", () => {
	it("(c) returns true when cpuinfo contains the avx2 flag", () => {
		expect(cpuHasAvx2(AVX2_CPUINFO)).toBe(true);
	});

	it("(d) returns false when cpuinfo lacks avx2 (Sandy Bridge / no-AVX2 CPU)", () => {
		expect(cpuHasAvx2(NO_AVX2_CPUINFO)).toBe(false);
	});

	it("(e) does not mistake 'avx' alone for 'avx2'", () => {
		// The flag line has "avx" but not "avx2" — must return false.
		expect(cpuHasAvx2("flags\t: fpu avx pclmulqdq\n")).toBe(false);
	});

	it("(e) does not mistake 'avx512' for 'avx2'", () => {
		expect(cpuHasAvx2(AVX512_NO_AVX2_CPUINFO)).toBe(false);
	});

	it("returns false for empty cpuinfo", () => {
		expect(cpuHasAvx2("")).toBe(false);
	});
});

// ── buildNames ────────────────────────────────────────────────────────────────

describe("buildNames", () => {
	it("(a) x64 without AVX2 → baseline first, then standard", () => {
		expect(buildNames("@cline/cli-linux-x64", "x64", false)).toEqual([
			"@cline/cli-linux-x64-baseline",
			"@cline/cli-linux-x64",
		]);
	});

	it("(b) x64 with AVX2 → standard only", () => {
		expect(buildNames("@cline/cli-linux-x64", "x64", true)).toEqual([
			"@cline/cli-linux-x64",
		]);
	});

	it("arm64 without AVX2 → standard only (baseline not applicable)", () => {
		expect(buildNames("@cline/cli-linux-arm64", "arm64", false)).toEqual([
			"@cline/cli-linux-arm64",
		]);
	});

	it("darwin x64 with AVX2 → standard only", () => {
		expect(buildNames("@cline/cli-darwin-x64", "x64", true)).toEqual([
			"@cline/cli-darwin-x64",
		]);
	});

	it("windows x64 without AVX2 → baseline first, then standard", () => {
		expect(buildNames("@cline/cli-windows-x64", "x64", false)).toEqual([
			"@cline/cli-windows-x64-baseline",
			"@cline/cli-windows-x64",
		]);
	});
});
