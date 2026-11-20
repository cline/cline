import { describe, expect, it } from "vitest";
import { normalizeMcpToolAnnotations } from "./annotations";

describe("normalizeMcpToolAnnotations", () => {
	it("keeps the typed hints and drops everything else", () => {
		expect(
			normalizeMcpToolAnnotations({
				title: "Read file",
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: "yes",
				openWorldHint: null,
				custom: 1,
			}),
		).toEqual({
			title: "Read file",
			readOnlyHint: true,
			destructiveHint: false,
		});
	});

	it("returns undefined for a missing, malformed, or empty annotations value", () => {
		expect(normalizeMcpToolAnnotations(undefined)).toBeUndefined();
		expect(normalizeMcpToolAnnotations("read-only")).toBeUndefined();
		expect(normalizeMcpToolAnnotations([true])).toBeUndefined();
		expect(
			normalizeMcpToolAnnotations({ readOnlyHint: "true" }),
		).toBeUndefined();
		expect(normalizeMcpToolAnnotations({})).toBeUndefined();
	});
});
