import { describe, expect, test } from "bun:test";
import { runtimeBuildDefineArgs } from "./runtime-build-define-args";

function defineMap(args: string[]): Record<string, string> {
	const map: Record<string, string> = {};
	for (let index = 0; index < args.length; index += 2) {
		expect(args[index]).toBe("--define");
		const pair = args[index + 1];
		const separator = pair.indexOf("=");
		map[pair.slice(0, separator)] = pair.slice(separator + 1);
	}
	return map;
}

describe("runtimeBuildDefineArgs", () => {
	test("inlines the Core build identity for the compiled sidecar", () => {
		const defines = defineMap(
			runtimeBuildDefineArgs({
				buildId: "source-v3-test-build",
				buildEpochMs: 1_788_399_410_000,
			}),
		);

		expect(defines.__CLINE_CORE_RUNTIME_BUILD_ID__).toBe(
			'"source-v3-test-build"',
		);
		expect(defines.__CLINE_CORE_RUNTIME_BUILD_EPOCH_MS__).toBe("1788399410000");
	});

	test("trims and JSON-escapes the build ID", () => {
		const defines = defineMap(
			runtimeBuildDefineArgs({
				buildId: '  source-v3-"quoted"  ',
				buildEpochMs: 1,
			}),
		);

		expect(JSON.parse(defines.__CLINE_CORE_RUNTIME_BUILD_ID__)).toBe(
			'source-v3-"quoted"',
		);
	});

	test("rejects identities that cannot safely identify a release build", () => {
		expect(() =>
			runtimeBuildDefineArgs({ buildId: " ", buildEpochMs: 1 }),
		).toThrow("runtime build ID must not be empty");
		expect(() =>
			runtimeBuildDefineArgs({ buildId: "build", buildEpochMs: 0 }),
		).toThrow("runtime build epoch must be a positive finite number");
	});
});
