import { describe, expect, it } from "vitest";
import {
	AUTO_APPROVE_CONFIG_ID,
	buildAutoApproveConfigOption,
	parseAutoApproveValue,
} from "./auto-approve";

describe("buildAutoApproveConfigOption", () => {
	it("builds a boolean config option reflecting the current value", () => {
		const option = buildAutoApproveConfigOption(true);

		expect(option).toMatchObject({
			type: "boolean",
			id: AUTO_APPROVE_CONFIG_ID,
			currentValue: true,
		});
		expect(option.name).toBeTruthy();
	});

	it("defaults to disabled when the session has it off", () => {
		const option = buildAutoApproveConfigOption(false);

		expect(option).toMatchObject({ type: "boolean", currentValue: false });
	});
});

describe("parseAutoApproveValue", () => {
	it("accepts booleans", () => {
		expect(parseAutoApproveValue(true)).toBe(true);
		expect(parseAutoApproveValue(false)).toBe(false);
	});

	it("accepts the string forms sent by older clients", () => {
		expect(parseAutoApproveValue("true")).toBe(true);
		expect(parseAutoApproveValue("false")).toBe(false);
	});

	it("fails closed for unrecognized values", () => {
		expect(parseAutoApproveValue("yes")).toBeUndefined();
		expect(parseAutoApproveValue(1)).toBeUndefined();
		expect(parseAutoApproveValue(null)).toBeUndefined();
	});

	it("returns undefined when no value was provided", () => {
		expect(parseAutoApproveValue(undefined)).toBeUndefined();
	});
});
