import { describe, expect, it } from "vitest";
import { isDesktopTransportPath } from "./server";

describe("desktop sidecar transport path", () => {
	it("uses the root path exclusively", () => {
		expect(isDesktopTransportPath("/")).toBe(true);
		expect(isDesktopTransportPath("/transport")).toBe(false);
		expect(isDesktopTransportPath("/health")).toBe(false);
	});
});
