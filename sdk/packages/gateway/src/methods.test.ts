import {
	createBotId,
	createIdempotencyKey,
	createRunId,
	createScheduleId,
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
				"account.cline.switch",
				"bot.delegate",
				"bot.systemPrompt.put",
				"connector.configure",
				"connector.register",
				"connector.remove",
				"connector.sendTest",
				"connector.setCredential",
				"connector.setEnabled",
				"connector.updateConfig",
				"extensions.managed.uninstall",
				"gateway.drain",
				"gateway.stop",
				"marketplace.install",
				"marketplace.uninstall",
				"mcp.servers.delete",
				"mcp.servers.put",
				"mcp.servers.setDisabled",
				"plugins.managed.setDisabled",
				"provider.add",
				"provider.models.put",
				"provider.oauth.cancel",
				"provider.oauth.login",
				"provider.settings.patch",
				"run.abort",
				"run.interrupt",
				"run.promoteQueued",
				"run.retry",
				"run.start",
				"run.steer",
				"run.updateQueued",
				"schedule.create",
				"schedule.delete",
				"schedule.disable",
				"schedule.enable",
				"schedule.trigger",
				"schedule.update",
				"session.close",
				"session.create",
				"session.delete",
				"session.fork",
				"session.update",
				"settings.global.patch",
				"tools.configuration.put",
				"tools.profiles.put",
				"voice.settings.put",
				"workspace.file.upload",
			].sort(),
		);
		expect(getMethodDefinition("gateway.hello")?.mutating).toBe(false);
		expect(getMethodDefinition("run.subscribe")?.mutating).toBe(false);
		expect(getMethodDefinition("run.list")?.mutating).toBe(false);
		expect(getMethodDefinition("connector.list")?.mutating).toBe(false);
		expect(getMethodDefinition("schedule.list")?.mutating).toBe(false);
		expect(getMethodDefinition("schedule.report")?.mutating).toBe(false);
		expect(getMethodDefinition("session.get")?.mutating).toBe(false);
		expect(
			getMethodDefinition("voice.transcription.createSession")?.mutating,
		).toBe(false);
		expect(
			getMethodDefinition("voice.transcription.transcribe")?.mutating,
		).toBe(false);
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

	it("validates provider and global settings methods", () => {
		for (const candidate of [
			request("provider.catalog.list", {}),
			request("provider.models.list", { providerId: "anthropic" }),
			request("provider.settings.patch", {
				idempotencyKey: createIdempotencyKey(),
				providerId: "anthropic",
				enabled: true,
				settings: { apiKey: "secret" },
			}),
			request("settings.global.patch", {
				idempotencyKey: createIdempotencyKey(),
				webSearchEnabled: true,
			}),
		]) {
			expect(validateGatewayRequest(candidate).ok).toBe(true);
		}

		expect(
			validateGatewayRequest(
				request("provider.models.put", {
					idempotencyKey: createIdempotencyKey(),
					providerId: "anthropic",
					models: [],
				}),
			).ok,
		).toBe(false);
		expect(
			validateGatewayRequest(
				request("settings.global.patch", {
					idempotencyKey: createIdempotencyKey(),
					telemetryOptOut: "yes",
				}),
			).ok,
		).toBe(false);
	});

	it("validates voice selection and bounded transcription requests", () => {
		for (const candidate of [
			request("voice.settings.put", {
				idempotencyKey: createIdempotencyKey(),
				selection: { providerId: "elevenlabs", modelId: "scribe_v2" },
			}),
			request("voice.settings.put", {
				idempotencyKey: createIdempotencyKey(),
				selection: null,
			}),
			request("voice.transcription.createSession", {}),
			request("voice.transcription.transcribe", {
				audioBase64: "YXVkaW8=",
				mediaType: "audio/webm;codecs=opus",
			}),
		]) {
			expect(validateGatewayRequest(candidate).ok).toBe(true);
		}

		for (const candidate of [
			request("voice.settings.put", {
				idempotencyKey: createIdempotencyKey(),
				selection: { providerId: "", modelId: "scribe_v2" },
			}),
			request("voice.transcription.transcribe", {
				audioBase64: "not base64",
			}),
			request("voice.transcription.transcribe", {
				audioBase64: "YXVkaW8=",
				mediaType: "text/plain",
			}),
		]) {
			expect(validateGatewayRequest(candidate).ok).toBe(false);
		}
	});

	it("validates the Cline OAuth and account surface", () => {
		for (const candidate of [
			request("provider.oauth.login", {
				idempotencyKey: createIdempotencyKey(),
				providerId: "cline",
			}),
			request("provider.oauth.cancel", {
				idempotencyKey: createIdempotencyKey(),
				providerId: "cline",
			}),
			request("account.cline.query", { operation: "fetchMe" }),
			request("account.cline.query", {
				operation: "fetchOrganizationUsageTransactions",
				organizationId: "org-1",
				memberId: "member-1",
			}),
			request("account.cline.switch", {
				idempotencyKey: createIdempotencyKey(),
				operation: "switchAccount",
				organizationId: null,
			}),
		]) {
			expect(validateGatewayRequest(candidate).ok).toBe(true);
		}
		expect(
			validateGatewayRequest(
				request("provider.oauth.login", {
					idempotencyKey: createIdempotencyKey(),
					providerId: "anthropic",
				}),
			).ok,
		).toBe(false);
		expect(
			validateGatewayRequest(
				request("account.cline.query", {
					operation: "fetchFeaturebaseToken",
				}),
			).ok,
		).toBe(false);
	});

	it("validates the optional session fork cutoff", () => {
		const sessionId = createSessionId();
		const valid = validateGatewayRequest(
			request("session.fork", {
				idempotencyKey: createIdempotencyKey(),
				sessionId,
				beforeRunCount: 2,
			}),
		);
		expect(valid.ok).toBe(true);

		const invalid = validateGatewayRequest(
			request("session.fork", {
				idempotencyKey: createIdempotencyKey(),
				sessionId,
				beforeRunCount: 0,
			}),
		);
		expect(invalid.ok).toBe(false);
	});

	it("validates queued-run mutations and rejects blank replacement input", () => {
		const runId = createRunId();
		for (const candidate of [
			request("run.updateQueued", {
				idempotencyKey: createIdempotencyKey(),
				runId,
				input: "updated prompt",
			}),
			request("run.promoteQueued", {
				idempotencyKey: createIdempotencyKey(),
				runId,
			}),
		]) {
			expect(validateGatewayRequest(candidate).ok).toBe(true);
		}

		expect(
			validateGatewayRequest(
				request("run.updateQueued", {
					idempotencyKey: createIdempotencyKey(),
					runId,
					input: "   ",
				}),
			).ok,
		).toBe(false);
	});

	it("validates session metadata and lifecycle mutations", () => {
		const sessionId = createSessionId();
		for (const candidate of [
			request("session.update", {
				idempotencyKey: createIdempotencyKey(),
				sessionId,
				title: "Renamed",
				metadata: { pinned: true },
			}),
			request("session.close", {
				idempotencyKey: createIdempotencyKey(),
				sessionId,
			}),
			request("session.delete", {
				idempotencyKey: createIdempotencyKey(),
				sessionId,
			}),
		]) {
			expect(validateGatewayRequest(candidate).ok).toBe(true);
		}

		expect(
			validateGatewayRequest(
				request("session.update", {
					idempotencyKey: createIdempotencyKey(),
					sessionId,
				}),
			).ok,
		).toBe(false);
	});

	it("validates managed schedule mutations", () => {
		const scheduleId = createScheduleId();
		for (const method of [
			"schedule.enable",
			"schedule.disable",
			"schedule.trigger",
			"schedule.delete",
		]) {
			expect(
				validateGatewayRequest(
					request(method, {
						idempotencyKey: createIdempotencyKey(),
						scheduleId,
					}),
				).ok,
			).toBe(true);
		}
		expect(
			validateGatewayRequest(
				request("schedule.update", {
					idempotencyKey: createIdempotencyKey(),
					scheduleId,
					expectedRevision: 2,
					cronPattern: "0 9 * * MON-FRI",
					metadata: { owner: "desktop" },
				}),
			).ok,
		).toBe(true);
	});
});
