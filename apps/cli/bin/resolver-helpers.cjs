"use strict";

// Pure helper functions extracted from bin/cline so they can be unit-tested
// without requiring the resolver to run its platform-detection side effects.
// bin/cline calls process.exit() at the top level, so it cannot be require()d
// in tests; these stateless helpers can be exercised directly.
// Exports: cpuHasAvx2(text), buildNames(base, arch, hasAvx2), choosePackageName(platform, arch, hasAvx2).

/** Returns true if the /proc/cpuinfo text contains "avx2" as a whole word. */
function cpuHasAvx2(cpuinfoText) {
	return /(^|\s)avx2(\s|$)/m.test(cpuinfoText);
}

/** Returns an ordered list of package names to try. On x64 Linux without AVX2, baseline comes first. */
function buildNames(base, arch, hasAvx2) {
	const result = [];
	if (arch === "x64" && !hasAvx2) {
		result.push(`${base}-baseline`);
	}
	result.push(base);
	return result;
}

/** Returns the single best package name for postinstall to cache. */
function choosePackageName(platform, arch, hasAvx2) {
	const platformMap = {
		darwin: "darwin",
		linux: "linux",
	};
	const mappedPlatform = platformMap[platform];
	if (!mappedPlatform) {
		return null;
	}
	const base = `@cline/cli-${mappedPlatform}-${arch}`;
	if (arch === "x64" && !hasAvx2) {
		return `${base}-baseline`;
	}
	return base;
}

module.exports = { cpuHasAvx2, buildNames, choosePackageName };
