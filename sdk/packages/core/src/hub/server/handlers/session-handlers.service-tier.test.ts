import type { HubCommandEnvelope } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionVersioningService } from "../../../session/session-versioning-service";
import type { HubTransportContext } from "./context";
import { handleSessionCreate, handleSessionRestore } from "./session-handlers";

// Stop at the host boundary: exercise the actual transport projections without
// starting an agent, contacting a provider, or writing session history.
const stop = new Error("captured start input");

afterEach(() => vi.restoreAllMocks());

describe("hub service tier start inputs", () => {
	it.each([
		{ tier: "priority", sessionConfig: {}, expected: "priority" },
		{ tier: undefined, sessionConfig: {}, expected: undefined },
		{ tier: "invalid", sessionConfig: {}, expected: undefined },
		{ tier: null, sessionConfig: {}, expected: undefined },
		{
			tier: "invalid",
			sessionConfig: { serviceTier: "priority" },
			expected: "priority",
		},
	])("projects create/resume and restore options: %j", async ({
		tier,
		sessionConfig,
		expected,
	}) => {
		const startSession = vi.fn().mockRejectedValue(stop);
		const ctx = {
			sessionHost: { startSession },
		} as unknown as HubTransportContext;
		const envelope = {
			command: "session.create",
			requestId: "test",
			clientId: "test",
			payload: {
				sessionId: "source",
				checkpointRunCount: 1,
				sessionConfig,
				runtimeOptions: { serviceTier: tier },
			},
		} as unknown as HubCommandEnvelope;
		await expect(
			handleSessionCreate(ctx, envelope, async () => ({ approved: true })),
		).rejects.toBe(stop);
		expect(startSession).toHaveBeenCalledOnce();
		expect(startSession.mock.calls[0][0].config.serviceTier).toBe(expected);

		// Exercise the restore handler's real buildStartInput callback; storage and
		// checkpoint work belongs to SessionVersioningService's own tests.
		const capture = vi.fn();
		vi.spyOn(
			SessionVersioningService.prototype,
			"restoreCheckpoint",
		).mockImplementation(async (options) => {
			const input = await options.buildStartInput!(
				{
					sourceSession: { provider: "openai-codex", model: "gpt-6-astra" },
					plan: { cwd: process.cwd() },
					initialMessages: [],
				} as unknown as Parameters<
					NonNullable<typeof options.buildStartInput>
				>[0],
				options.start,
			);
			capture(input);
			throw stop;
		});
		await handleSessionRestore(
			ctx,
			{ ...envelope, command: "session.restore" },
			async () => ({ approved: true }),
		);
		expect(capture).toHaveBeenCalledOnce();
		expect(capture.mock.calls[0][0].config.serviceTier).toBe(expected);
	});
});
