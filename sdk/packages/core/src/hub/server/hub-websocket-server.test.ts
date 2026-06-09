import { describe, expect, it } from "vitest";
import {
	readBearerToken,
	shouldClearStaleHubDiscovery,
} from "./hub-websocket-server";

const discovery = {
	hubId: "hub-test",
	protocolVersion: "v1",
	authToken: "token",
	host: "127.0.0.1",
	port: 25463,
	url: "ws://127.0.0.1:25463/hub",
	startedAt: new Date(0).toISOString(),
	updatedAt: new Date(0).toISOString(),
};

describe("shouldClearStaleHubDiscovery", () => {
	it("clears stale discovery when the expected hub is unreachable", () => {
		expect(shouldClearStaleHubDiscovery(discovery, undefined, false)).toBe(
			true,
		);
	});

	it("clears stale discovery when an incompatible hub occupies the expected port", () => {
		expect(
			shouldClearStaleHubDiscovery(
				discovery,
				{
					protocolVersion: "v2",
					minClientProtocolVersion: "v2",
					maxClientProtocolVersion: "v2",
					host: "127.0.0.1",
					port: 25463,
					url: "ws://127.0.0.1:25463/hub",
				},
				false,
			),
		).toBe(true);
	});

	it("clears stale discovery when the expected hub is compatible but discovery did not verify", () => {
		expect(
			shouldClearStaleHubDiscovery(
				discovery,
				{
					protocolVersion: "v1",
					host: "127.0.0.1",
					port: 25463,
					url: "ws://127.0.0.1:25463/hub",
				},
				false,
			),
		).toBe(true);
	});

	it("keeps discovery when the expected hub is compatible and discovery verified", () => {
		expect(
			shouldClearStaleHubDiscovery(
				discovery,
				{
					protocolVersion: "v1",
					host: "127.0.0.1",
					port: 25463,
					url: "ws://127.0.0.1:25463/hub",
				},
				true,
			),
		).toBe(false);
	});
});

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
