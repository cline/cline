import { describe, expect, it } from "vitest";
import { omitUndefinedValues } from "./object";

describe("omitUndefinedValues", () => {
	it("removes undefined properties and preserves other falsy values", () => {
		expect(
			omitUndefinedValues({
				sessionId: "session-id",
				conversationId: undefined,
				count: 0,
				enabled: false,
				empty: "",
				nullable: null,
			}),
		).toEqual({
			sessionId: "session-id",
			count: 0,
			enabled: false,
			empty: "",
			nullable: null,
		});
	});
});
