import { describe, expect, it } from "vitest";
import {
	GATEWAY_PROTOCOL_VERSION,
	GatewayEventSchema,
	GatewayRequestSchema,
	GatewayResponseSchema,
} from "./envelopes";
import { createGatewayError } from "./errors";
import { createRunId, createSessionId } from "./ids";
import {
	GatewayServerRequestSchema,
	GatewayServerResponseSchema,
} from "./server-requests";

describe("request envelope", () => {
	it("accepts a versioned request with a dotted method", () => {
		const request = GatewayRequestSchema.parse({
			version: 1,
			id: "req_1",
			method: "run.start",
			params: { prompt: "hello" },
		});
		expect(request.method).toBe("run.start");
	});

	it("rejects missing/foreign versions and malformed methods", () => {
		expect(() =>
			GatewayRequestSchema.parse({ id: "req_1", method: "run.start" }),
		).toThrow();
		expect(() =>
			GatewayRequestSchema.parse({
				version: 2,
				id: "req_1",
				method: "run.start",
			}),
		).toThrow();
		for (const method of ["run", "Run.Start", "run..start", "run.start!", ""]) {
			expect(() =>
				GatewayRequestSchema.parse({ version: 1, id: "req_1", method }),
			).toThrow();
		}
	});

	it("rejects unknown envelope fields (per-version compatibility surface)", () => {
		expect(() =>
			GatewayRequestSchema.parse({
				version: 1,
				id: "req_1",
				method: "run.start",
				extra: true,
			}),
		).toThrow();
	});
});

describe("response envelope", () => {
	it("carries exactly one of result or error", () => {
		expect(
			GatewayResponseSchema.parse({ version: 1, id: "req_1", result: {} }),
		).toBeTruthy();
		expect(
			GatewayResponseSchema.parse({
				version: 1,
				id: "req_1",
				error: createGatewayError("not_found", "no such run"),
			}),
		).toBeTruthy();
		expect(() =>
			GatewayResponseSchema.parse({ version: 1, id: "req_1" }),
		).toThrow();
		expect(() =>
			GatewayResponseSchema.parse({
				version: 1,
				id: "req_1",
				result: {},
				error: createGatewayError("internal", "boom"),
			}),
		).toThrow();
	});

	it("rejects errors with unknown codes", () => {
		expect(() =>
			GatewayResponseSchema.parse({
				version: 1,
				id: "req_1",
				error: { code: "spooky", message: "??" },
			}),
		).toThrow();
	});
});

describe("event envelope", () => {
	it("orders events by non-negative integer sequence and validates scope IDs", () => {
		const event = GatewayEventSchema.parse({
			version: GATEWAY_PROTOCOL_VERSION,
			sequence: 7,
			event: "run.textDelta",
			scope: { sessionId: createSessionId(), runId: createRunId() },
			payload: { text: "hi" },
		});
		expect(event.sequence).toBe(7);
	});

	it("rejects fractional or negative sequences", () => {
		for (const sequence of [-1, 1.5, Number.NaN]) {
			expect(() =>
				GatewayEventSchema.parse({
					version: 1,
					sequence,
					event: "run.textDelta",
					scope: {},
				}),
			).toThrow();
		}
	});

	it("rejects scope IDs of the wrong kind — IDs are not interchangeable", () => {
		expect(() =>
			GatewayEventSchema.parse({
				version: 1,
				sequence: 0,
				event: "run.textDelta",
				scope: { runId: createSessionId() },
			}),
		).toThrow();
	});
});

describe("server requests", () => {
	it("are independent envelopes: correlated by id, not ordered by sequence", () => {
		const request = GatewayServerRequestSchema.parse({
			version: 1,
			id: "srq_1",
			method: "client.requestToolApproval",
			scope: { runId: createRunId() },
			params: { toolName: "write_file" },
		});
		expect("sequence" in request).toBe(false);
		expect(
			GatewayServerResponseSchema.parse({
				version: 1,
				id: "srq_1",
				result: { approved: true },
			}),
		).toBeTruthy();
		expect(() =>
			GatewayServerResponseSchema.parse({ version: 1, id: "srq_1" }),
		).toThrow();
	});
});
