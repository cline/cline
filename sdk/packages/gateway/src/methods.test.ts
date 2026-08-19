import {
	createBotId,
	createIdempotencyKey,
	createRunId,
	createSessionId,
} from "@cline/shared/gateway";
import { describe, expect, it } from "vitest";
import {
	GATEWAY_METHODS,
	getMethodDefinition,
	validateGatewayRequest,
} from "./methods";

function request(method: string, params?: Record<string, unknown>) {
	return { version: 1, id: "req_1", method, params };
}

describe("method registry", () => {
	it("registers every method exactly once with a dotted name", () => {
		const names = GATEWAY_METHODS.map((definition) => definition.method);
		expect(new Set(names).size).toBe(names.length);
		for (const name of names) {
			expect(name).toMatch(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/);
		}
	});

	it("every run/bot mutation is marked mutating; reads and hello are not", () => {
		const mutating = GATEWAY_METHODS.filter((d) => d.mutating).map(
			(d) => d.method,
		);
		expect(mutating.sort()).toEqual(
			[
				"bot.delegate",
				"connector.register",
				"gateway.drain",
				"gateway.stop",
				"run.abort",
				"run.interrupt",
				"run.start",
				"run.steer",
				"schedule.create",
			].sort(),
		);
		expect(getMethodDefinition("gateway.hello")?.mutating).toBe(false);
		expect(getMethodDefinition("run.subscribe")?.mutating).toBe(false);
		expect(getMethodDefinition("run.list")?.mutating).toBe(false);
		expect(getMethodDefinition("connector.list")?.mutating).toBe(false);
		expect(getMethodDefinition("schedule.list")?.mutating).toBe(false);
		expect(getMethodDefinition("schedule.report")?.mutating).toBe(false);
	});
});

describe("request validation", () => {
	it("accepts a valid mutating request carrying an idempotency key", () => {
		const outcome = validateGatewayRequest(
			request("run.start", {
				idempotencyKey: createIdempotencyKey(),
				botId: createBotId(),
				prompt: "do it",
			}),
		);
		expect(outcome.ok).toBe(true);
		if (outcome.ok) {
			expect(outcome.definition.method).toBe("run.start");
		}
	});

	it("rejects mutating requests without an idempotency key", () => {
		const outcome = validateGatewayRequest(
			request("run.start", { botId: createBotId(), prompt: "do it" }),
		);
		expect(outcome.ok).toBe(false);
		if (!outcome.ok) {
			expect(outcome.error.code).toBe("idempotency_key_required");
		}
	});

	it("rejects malformed envelopes and unknown methods", () => {
		const malformed = validateGatewayRequest({
			id: "req_1",
			method: "run.start",
		});
		expect(!malformed.ok && malformed.error.code).toBe("invalid_request");

		const unknown = validateGatewayRequest(request("run.hijack", {}));
		expect(!unknown.ok && unknown.error.code).toBe("not_found");
	});

	it("rejects params carrying the wrong ID kind — IDs are not interchangeable", () => {
		const outcome = validateGatewayRequest(
			request("run.steer", {
				idempotencyKey: createIdempotencyKey(),
				runId: createSessionId(),
				text: "steer",
			}),
		);
		expect(outcome.ok).toBe(false);
		if (!outcome.ok) {
			expect(outcome.error.code).toBe("invalid_request");
		}
	});

	it("validates read methods without an idempotency key", () => {
		const outcome = validateGatewayRequest(
			request("run.subscribe", { runId: createRunId() }),
		);
		expect(outcome.ok).toBe(true);
	});
});
