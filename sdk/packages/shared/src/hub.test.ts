import { describe, expect, it } from "vitest";
import { isHubProtocolCompatible } from "./hub";

describe("isHubProtocolCompatible", () => {
	it("accepts a hub whose supported client range includes the client protocol", () => {
		expect(
			isHubProtocolCompatible({
				protocolVersion: "v2",
				minClientProtocolVersion: "v1",
				maxClientProtocolVersion: "v2",
			}),
		).toEqual({ compatible: true });
	});

	it("rejects a hub whose supported client range excludes the client protocol", () => {
		expect(
			isHubProtocolCompatible({
				protocolVersion: "v2",
				minClientProtocolVersion: "v2",
				maxClientProtocolVersion: "v3",
			}),
		).toEqual({ compatible: false, reason: "unsupported_protocol" });
	});

	it("rejects missing or malformed protocol versions", () => {
		expect(isHubProtocolCompatible({ protocolVersion: "" })).toEqual({
			compatible: false,
			reason: "missing_protocol",
		});
	});
});
