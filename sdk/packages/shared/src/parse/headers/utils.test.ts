import { describe, expect, it } from "vitest";
import { parseKeyPairsIntoRecord } from "./utils";

describe("parseKeyPairsIntoRecord", () => {
	it("parses comma-separated key=value pairs", () => {
		expect(parseKeyPairsIntoRecord("a=1,b=2,c=3")).toEqual({
			a: "1",
			b: "2",
			c: "3",
		});
	});

	it("returns an empty record for empty or undefined input", () => {
		expect(parseKeyPairsIntoRecord("")).toEqual({});
		expect(parseKeyPairsIntoRecord(undefined)).toEqual({});
	});

	it("trims whitespace and decodes percent-encoded keys and values", () => {
		expect(parseKeyPairsIntoRecord(" Authorization = Bearer%20abc ")).toEqual({
			Authorization: "Bearer abc",
		});
	});

	it("skips entries without a separator or with an empty key", () => {
		expect(parseKeyPairsIntoRecord("novalue,=nokey,good=1")).toEqual({
			good: "1",
		});
	});

	it("keeps well-formed entries when a later entry is malformed", () => {
		// `b=%` is an invalid percent-encoding: decodeURIComponent throws on it.
		// The malformed entry must be skipped without discarding `a` or `c`.
		expect(parseKeyPairsIntoRecord("a=1,b=%,c=3")).toEqual({
			a: "1",
			c: "3",
		});
	});

	it("skips only the malformed pair in a realistic OTEL header string", () => {
		expect(
			parseKeyPairsIntoRecord(
				"Authorization=Bearer abc,X-Tenant=acme%,X-Trace=on",
			),
		).toEqual({
			Authorization: "Bearer abc",
			"X-Trace": "on",
		});
	});
});
