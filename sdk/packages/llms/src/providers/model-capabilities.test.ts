import { describe, expect, it } from "vitest";
import { toGatewayModelCapabilities } from "./model-capabilities";

describe("toGatewayModelCapabilities", () => {
	it.each([
		["unknown", undefined, undefined],
		["known empty", [], ["text"]],
		["known text-only", ["tools", "reasoning"], ["text", "tools", "reasoning"]],
		["image-capable", ["images"], ["text", "images"]],
	] as const)("preserves %s capability knowledge", (_case, input, expected) => {
		expect(toGatewayModelCapabilities(input)).toEqual(expected);
	});
});
