"use strict";

// Pure helper functions extracted from bin/cline so they can be unit-tested
// without requiring the resolver to run its platform-detection side effects.
//
// Why: bin/cline is a self-contained CommonJS script that calls process.exit
// at the top level, making it impossible to require() in tests without the
// process terminating. Extracting stateless pure helpers into this file lets
// unit tests exercise the logic directly.
// What: Exports cpuHasAvx2(text) and buildNames(base, arch, hasAvx2).
// Test: Import this file in vitest; call the exported functions directly.

/**
 * Why: Detect AVX2 from raw /proc/cpuinfo text.
 * What: Returns true if the text contains "avx2" as a whole word.
 * Test: Pass the Sandy Bridge flag line; assert false.
 *       Pass a Haswell flag line; assert true.
 *       Pass a line with "avx" but not "avx2"; assert false.
 */
function cpuHasAvx2(cpuinfoText) {
	return /(^|\s)avx2(\s|$)/m.test(cpuinfoText);
}

/**
 * Why: Compute the ordered package name preference list for a given arch/CPU.
 * What: Returns ["<base>-baseline", "<base>"] when arch=="x64" and !hasAvx2,
 *       otherwise just ["<base>"].
 * Test: x64+no-avx2 → baseline first; x64+avx2 → standard only;
 *       arm64 → standard only regardless of hasAvx2.
 */
function buildNames(base, arch, hasAvx2) {
	const result = [];
	if (arch === "x64" && !hasAvx2) {
		result.push(`${base}-baseline`);
	}
	result.push(base);
	return result;
}

module.exports = { cpuHasAvx2, buildNames };
