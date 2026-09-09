import { describe, expect, expectTypeOf, it } from "vitest";
import type { HubCommandInput } from "./hub";
import {
	HUB_CAPABILITIES,
	isHubProtocolCompatible,
	readHubScheduleMode,
} from "./hub";

describe("HUB_CAPABILITIES", () => {
	it("advertises the task queue command surface", () => {
		expect(HUB_CAPABILITIES).toEqual(
			expect.arrayContaining([
				"task.create",
				"task.list",
				"task.get",
				"task.update",
				"task.approve",
				"task.cancel",
				"task.run",
				"task.automation.get",
				"task.automation.set",
			]),
		);
	});

	it("requires optimistic revisions on lifecycle commands", () => {
		expectTypeOf<HubCommandInput<"task.approve">>().toEqualTypeOf<{
			taskId: string;
			expectedRevision: number;
		}>();
		expectTypeOf<HubCommandInput<"task.cancel">>().toEqualTypeOf<{
			taskId: string;
			expectedRevision: number;
			reason?: string;
		}>();
		expectTypeOf<HubCommandInput<"task.run">>().toEqualTypeOf<{
			taskId: string;
			expectedRevision: number;
		}>();
	});
});

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
