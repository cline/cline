import { describe, expect, it } from "vitest";
import { isHubProtocolCompatible, readHubScheduleMode } from "./hub";

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

describe("readHubScheduleMode", () => {
	it("defaults only when mode is absent", () => {
		expect(readHubScheduleMode(undefined, "yolo")).toBe("yolo");
		expect(readHubScheduleMode({}, "yolo")).toBe("yolo");
		expect(readHubScheduleMode({ mode: "plan" }, "yolo")).toBe("plan");
	});

	it("preserves omission for schedule updates", () => {
		expect(readHubScheduleMode({})).toBeUndefined();
	});

	it.each([
		undefined,
		null,
		"",
		"invalid",
	])("rejects a present invalid mode: %s", (mode) => {
		expect(() => readHubScheduleMode({ mode }, "yolo")).toThrow(
			"mode must be one of: act, plan, yolo",
		);
	});
});
