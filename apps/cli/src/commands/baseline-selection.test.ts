import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

const baseline = require("../../bin/baseline.cjs") as {
	supportsAvx2: (platform: string, arch: string) => boolean;
	platformPackageNames: (
		platform: string,
		arch: string,
		avx2: boolean,
	) => string[];
	resolvePlatformPackageNames: (platform: string, arch: string) => string[];
};

describe("baseline binary selection", () => {
	it("prefers the default package on x64 with AVX2", () => {
		expect(baseline.platformPackageNames("linux", "x64", true)).toEqual([
			"@cline/cli-linux-x64",
			"@cline/cli-linux-x64-baseline",
		]);
	});

	it("prefers the baseline package on x64 without AVX2", () => {
		for (const platform of ["linux", "darwin", "windows"]) {
			expect(baseline.platformPackageNames(platform, "x64", false)).toEqual([
				`@cline/cli-${platform}-x64-baseline`,
				`@cline/cli-${platform}-x64`,
			]);
		}
	});

	it("only offers the default package on non-x64 architectures", () => {
		expect(baseline.platformPackageNames("darwin", "arm64", false)).toEqual([
			"@cline/cli-darwin-arm64",
		]);
		expect(baseline.platformPackageNames("linux", "arm64", true)).toEqual([
			"@cline/cli-linux-arm64",
		]);
	});

	it("reports no AVX2 on non-x64 architectures", () => {
		expect(baseline.supportsAvx2("darwin", "arm64")).toBe(false);
		expect(baseline.supportsAvx2("linux", "arm64")).toBe(false);
	});

	it("reports no AVX2 on unknown platforms", () => {
		expect(baseline.supportsAvx2("freebsd", "x64")).toBe(false);
	});

	it("resolves a coherent preference order for the current machine", () => {
		const names = baseline.resolvePlatformPackageNames("linux", "x64");
		const avx2 = baseline.supportsAvx2("linux", "x64");
		expect(names).toEqual(baseline.platformPackageNames("linux", "x64", avx2));
	});
});
