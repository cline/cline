import { describe, expect, it } from "bun:test";
import { resolveBunCompileTarget } from "./build-sidecar-target";

describe("resolveBunCompileTarget", () => {
	it("uses Bun's baseline build for Windows x64", () => {
		expect(resolveBunCompileTarget("x86_64-pc-windows-msvc")).toBe(
			"bun-windows-x64-baseline",
		);
	});

	it.each([
		["aarch64-apple-darwin", "bun-darwin-arm64"],
		["x86_64-apple-darwin", "bun-darwin-x64"],
		["x86_64-unknown-linux-gnu", "bun-linux-x64"],
		["aarch64-unknown-linux-gnu", "bun-linux-arm64"],
	])("keeps %s mapped to %s", (targetTriple, expectedTarget) => {
		expect(resolveBunCompileTarget(targetTriple)).toBe(expectedTarget);
	});

	it("lets Bun use its host target for unknown Rust triples", () => {
		expect(
			resolveBunCompileTarget("riscv64gc-unknown-linux-gnu"),
		).toBeUndefined();
	});
});
