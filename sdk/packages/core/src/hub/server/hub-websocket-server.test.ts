import { describe, expect, it } from "vitest";
import {
	isLocalHubHostName,
	isLocalHubOrigin,
	readBearerToken,
} from "./hub-websocket-server";

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

describe("loopback websocket origin auth", () => {
	it("recognizes loopback Hub hosts and browser origins", () => {
		expect(isLocalHubHostName("127.0.0.1")).toBe(true);
		expect(isLocalHubHostName("localhost")).toBe(true);
		expect(isLocalHubHostName("::1")).toBe(true);
		expect(isLocalHubOrigin("http://localhost:3000")).toBe(true);
		expect(isLocalHubOrigin("http://127.0.0.1:3017")).toBe(true);
	});

	it("rejects non-loopback browser origins", () => {
		expect(isLocalHubOrigin("https://example.com")).toBe(false);
		expect(isLocalHubOrigin("http://192.168.1.10:3000")).toBe(false);
		expect(isLocalHubOrigin(undefined)).toBe(false);
	});
});
