import { describe, expect, it } from "vitest";
import {
	parseBuildOptions,
	shouldInstallNativeVariants,
	validateBuildOptions,
} from "../../script/build-options";

describe("CLI build options", () => {
	it("does not install native variants during single-platform builds by default", () => {
		const options = parseBuildOptions(["--single"]);

		expect(options.single).toBe(true);
		expect(options.requireDarwinCodesign).toBe(false);
		expect(
			shouldInstallNativeVariants({
				options,
				opentuiVersion: "0.1.102",
			}),
		).toBe(false);
		expect(
			validateBuildOptions({
				options,
				opentuiVersion: "0.1.102",
				targetCount: 1,
				buildsDarwin: true,
				platform: "darwin",
			}),
		).toBeUndefined();
	});

	it("requires explicit native variant install for cross-platform OpenTUI builds", () => {
		const options = parseBuildOptions([]);

		expect(
			validateBuildOptions({
				options,
				opentuiVersion: "0.1.102",
				targetCount: 6,
				buildsDarwin: true,
				platform: "darwin",
			}),
		).toContain("--install-native-variants");
	});

	it("allows cross-platform builds to opt into native variant installation", () => {
		const options = parseBuildOptions(["--install-native-variants"]);

		expect(options.requireDarwinCodesign).toBe(false);
		expect(
			shouldInstallNativeVariants({
				options,
				opentuiVersion: "0.1.102",
			}),
		).toBe(true);
		expect(
			validateBuildOptions({
				options,
				opentuiVersion: "0.1.102",
				targetCount: 6,
				buildsDarwin: true,
				platform: "darwin",
			}),
		).toBeUndefined();
	});

	it("parses the release-only Darwin codesign requirement", () => {
		const options = parseBuildOptions(["--require-darwin-codesign"]);

		expect(options.requireDarwinCodesign).toBe(true);
	});

	it("rejects the Darwin codesign requirement on non-macOS hosts", () => {
		const options = parseBuildOptions([
			"--install-native-variants",
			"--require-darwin-codesign",
		]);

		expect(
			validateBuildOptions({
				options,
				opentuiVersion: "0.1.102",
				targetCount: 6,
				buildsDarwin: true,
				platform: "linux",
			}),
		).toContain("Cannot codesign Darwin binaries on linux");
	});

	it("allows the Darwin codesign requirement when no Darwin target is built", () => {
		const options = parseBuildOptions([
			"--install-native-variants",
			"--require-darwin-codesign",
		]);

		expect(
			validateBuildOptions({
				options,
				opentuiVersion: "0.1.102",
				targetCount: 4,
				buildsDarwin: false,
				platform: "linux",
			}),
		).toBeUndefined();
	});
});
