import { describe, expect, it } from "vitest";
import { readBearerToken } from "./hub-websocket-server";

describe("readBearerToken", () => {
	it("reads a bearer token with case-insensitive scheme", () => {
		expect(readBearerToken("Bearer token")).toBe("token");
		expect(readBearerToken("bearer token")).toBe("token");
	});

	it("reads a bearer token separated by tabs without regex backtracking", () => {
		expect(readBearerToken(`bearer\t\t${"token"}`)).toBe("token");
		expect(readBearerToken(`bearer${"\t".repeat(10_000)}token`)).toBe("token");
	});

	it("rejects missing and malformed bearer tokens", () => {
		expect(readBearerToken(undefined)).toBeNull();
		expect(readBearerToken("Bearer")).toBeNull();
		expect(readBearerToken("BearerToken")).toBeNull();
		expect(readBearerToken("Basic token")).toBeNull();
	});
});
