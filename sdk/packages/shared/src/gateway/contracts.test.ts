import { describe, expect, it } from "vitest";
import {
	DISCONNECT_IMPLIES_ABORT,
	GATEWAY_CONNECT_FALLBACK,
	GATEWAY_SINGLETON_OWNERSHIP,
	GATEWAY_WRITE_AUTHORITY,
	GatewayConnectPolicySchema,
} from "./authority";
import {
	createEventCursor,
	decodeEventCursor,
	EventCursorDecodeError,
	encodeEventCursor,
	INITIAL_EVENT_CURSOR,
} from "./cursors";
import {
	GATEWAY_HELLO_METHOD,
	GatewayHelloParamsSchema,
	GatewayHelloResultSchema,
	KNOWN_GATEWAY_CAPABILITIES,
} from "./handshake";
import { createIdempotencyKey, IdempotencyKeySchema } from "./idempotency";
import {
	createBotId,
	createClientId,
	createGatewayId,
	createGatewayInstanceId,
} from "./ids";
import { checkRevision, INITIAL_REVISION, nextRevision } from "./revisions";

describe("authority invariants (ADR-encoded)", () => {
	it("the Gateway is the only new-path writer", () => {
		expect(GATEWAY_WRITE_AUTHORITY).toBe("gateway");
	});

	it("there is no implicit in-process fallback", () => {
		expect(GATEWAY_CONNECT_FALLBACK).toBe("none");
		expect(
			GatewayConnectPolicySchema.parse({
				endpoint: "ws://127.0.0.1:7777",
				fallback: "none",
			}).fallback,
		).toBe("none");
		// Any policy that would permit a fallback is rejected at the schema.
		for (const fallback of ["in-process", "local", "auto", true, undefined]) {
			expect(() =>
				GatewayConnectPolicySchema.parse({
					endpoint: "ws://127.0.0.1:7777",
					fallback,
				}),
			).toThrow();
		}
	});

	it("singleton ownership is lease-based and disconnect never implies abort", () => {
		expect(GATEWAY_SINGLETON_OWNERSHIP).toBe("lease");
		expect(DISCONNECT_IMPLIES_ABORT).toBe(false);
	});
});

describe("handshake", () => {
	it("gateway.hello is the fixed first method of every connection", () => {
		expect(GATEWAY_HELLO_METHOD).toBe("gateway.hello");
	});

	it("validates hello params and result", () => {
		const params = GatewayHelloParamsSchema.parse({
			protocolVersions: [1],
			client: { name: "cline-cli", version: "1.2.3" },
			capabilities: ["events.replay"],
		});
		expect(params.protocolVersions).toEqual([1]);

		const result = GatewayHelloResultSchema.parse({
			protocolVersion: 1,
			gatewayId: createGatewayId(),
			instanceId: createGatewayInstanceId(),
			clientId: createClientId(),
			capabilities: [...KNOWN_GATEWAY_CAPABILITIES],
			catalogGeneration: 3,
		});
		expect(result.protocolVersion).toBe(1);
	});

	it("rejects a hello with no offered versions or swapped ID kinds", () => {
		expect(() =>
			GatewayHelloParamsSchema.parse({
				protocolVersions: [],
				client: { name: "cli", version: "1" },
			}),
		).toThrow();
		expect(() =>
			GatewayHelloResultSchema.parse({
				protocolVersion: 1,
				gatewayId: createBotId(),
				instanceId: createGatewayInstanceId(),
				clientId: createClientId(),
				capabilities: [],
				catalogGeneration: 0,
			}),
		).toThrow();
	});

	it("capability names are dotted lowerCamel and the known set matches", () => {
		for (const capability of KNOWN_GATEWAY_CAPABILITIES) {
			expect(() =>
				GatewayHelloParamsSchema.parse({
					protocolVersions: [1],
					client: { name: "cli", version: "1" },
					capabilities: [capability],
				}),
			).not.toThrow();
		}
	});
});

describe("cursors", () => {
	it("round-trips through the opaque encoding", () => {
		const cursor = createEventCursor(41);
		expect(decodeEventCursor(encodeEventCursor(cursor))).toEqual(cursor);
		expect(decodeEventCursor(encodeEventCursor(INITIAL_EVENT_CURSOR))).toEqual(
			INITIAL_EVENT_CURSOR,
		);
	});

	it("rejects tampered or foreign cursors", () => {
		expect(() => decodeEventCursor("not-a-cursor")).toThrow(
			EventCursorDecodeError,
		);
		const foreign = Buffer.from(
			JSON.stringify({ v: 2, lastSequence: 0 }),
			"utf8",
		).toString("base64url");
		expect(() => decodeEventCursor(foreign)).toThrow(EventCursorDecodeError);
		expect(() => createEventCursor(-2)).toThrow();
	});
});

describe("idempotency", () => {
	it("accepts URL-safe keys and rejects short or unsafe ones", () => {
		expect(IdempotencyKeySchema.parse("abcd1234")).toBe("abcd1234");
		expect(() => IdempotencyKeySchema.parse("short")).toThrow();
		expect(() => IdempotencyKeySchema.parse("has spaces here")).toThrow();
		expect(() => IdempotencyKeySchema.parse("x".repeat(129))).toThrow();
	});

	it("generates valid keys", () => {
		const key = createIdempotencyKey();
		expect(IdempotencyKeySchema.parse(key)).toBe(key);
	});
});

describe("revisions", () => {
	it("increment monotonically from the initial revision", () => {
		expect(INITIAL_REVISION).toBe(0);
		expect(nextRevision(INITIAL_REVISION)).toBe(1);
		expect(nextRevision(41)).toBe(42);
	});

	it("mismatches produce a revision_conflict wire error", () => {
		expect(checkRevision(3, 3)).toBeUndefined();
		const error = checkRevision(3, 4);
		expect(error?.code).toBe("revision_conflict");
		expect(error?.retryable).toBe(false);
	});
});
