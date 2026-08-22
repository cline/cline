import { describe, expect, it } from "vitest";
import { gatewayCliSelfInvocation } from "./cli";

describe("Gateway CLI self invocation", () => {
	it("re-enters a Bun or Node source entrypoint through the runtime", () => {
		expect(
			gatewayCliSelfInvocation("/opt/bun", [
				"bun",
				"/repo/sdk/packages/gateway/bin/clinegate.mjs",
				"start",
			]),
		).toEqual({
			executable: "/opt/bun",
			argsPrefix: ["/repo/sdk/packages/gateway/bin/clinegate.mjs"],
		});
	});

	it("re-enters a compiled Bun executable without its virtual entry path", () => {
		expect(
			gatewayCliSelfInvocation("/Applications/Cline/clinegate", [
				"bun",
				"/$bunfs/root/clinegate",
				"start",
			]),
		).toEqual({
			executable: "/Applications/Cline/clinegate",
			argsPrefix: [],
		});
		expect(
			gatewayCliSelfInvocation("/Applications/Cline/clinegate", [
				"bun",
				"/$bunfs/root/clinegate-aarch64-apple-darwin",
				"start",
			]),
		).toEqual({
			executable: "/Applications/Cline/clinegate",
			argsPrefix: [],
		});
		expect(
			gatewayCliSelfInvocation("C:\\Cline\\clinegate.exe", [
				"bun",
				"B:\\~BUN\\root\\clinegate.exe",
				"start",
			]),
		).toEqual({
			executable: "C:\\Cline\\clinegate.exe",
			argsPrefix: [],
		});
	});
});
