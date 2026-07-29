import { describe, expect, it } from "vitest";
import {
	isLocalHubHostName,
	isLocalHubOrigin,
	readBearerToken,
	resolveHubMaxInboundPayloadBytes,
	resolveHubResourceOptions,
} from "./hub-websocket-server";

describe("websocket payload limit", () => {
	it("defaults to one MiB and accepts a configured maximum", () => {
		expect(resolveHubMaxInboundPayloadBytes({})).toBe(1024 * 1024);
		expect(
			resolveHubMaxInboundPayloadBytes({ maxInboundPayloadBytes: 42 }),
		).toBe(42);
	});

	it("resolves central policy defaults with explicit transport precedence", () => {
		const options = resolveHubResourceOptions({
			runtimeHandlers: {} as never,
			resourcePolicy: {
				transport: {
					websocket: {
						softWatermarkBytes: 2000,
						hardWatermarkBytes: 4000,
						maxInboundPayloadBytes: 8000,
					},
				},
			},
			websocketDelivery: { softWatermarkBytes: 3000 },
		});

		expect(options.maxInboundPayloadBytes).toBe(8000);
		expect(options.websocketDelivery).toMatchObject({
			softWatermarkBytes: 3000,
			hardWatermarkBytes: 4000,
		});
		expect(options.resourcePolicy).toMatchObject({ version: 1 });
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
