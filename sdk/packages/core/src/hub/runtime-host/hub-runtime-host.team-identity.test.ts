import type { HubEventEnvelope } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionSource } from "../../types/common";
import {
	buildHubEvent,
	type HubTransportContext,
} from "../server/handlers/context";
import { projectSessionEvent } from "../server/handlers/session-event-projector";

const commandMock = vi.hoisted(() => vi.fn());
const subscribeMock = vi.hoisted(() => vi.fn());

vi.mock("../client", () => ({
	NodeHubClient: class {
		command = commandMock;
		subscribe = subscribeMock;
		close = vi.fn();
		dispose = vi.fn();
		getClientId = () => "client-1";
		getUrl = () => "ws://127.0.0.1:25463/hub";
	},
	isHubCommandTimeoutError: (error: unknown) =>
		!!error &&
		typeof error === "object" &&
		(error as { code?: unknown }).code === "hub_command_timeout",
	restartLocalHubIfIdleAfterStartupTimeout: vi.fn(),
}));

function createConfig() {
	return {
		providerId: "cline",
		modelId: "anthropic/claude-haiku-4.5",
		cwd: "/tmp/project",
		workspaceRoot: "/tmp/project",
		systemPrompt: "system",
		mode: "act" as const,
		checkpoint: { enabled: true },
		enableTools: true,
		enableSpawnAgent: true,
		enableAgentTeams: true,
	};
}

/** Project a teammate text content_start through the real server projector. */
async function projectTeammateDelta(): Promise<HubEventEnvelope> {
	const published: HubEventEnvelope[] = [];
	const ctx = {
		publish: (event: HubEventEnvelope) => published.push(event),
		buildEvent: buildHubEvent,
	} as unknown as HubTransportContext;
	await projectSessionEvent(ctx, {
		type: "agent_event",
		payload: {
			sessionId: "sess-root",
			teamRole: "teammate",
			teamAgentId: "worker-a",
			event: {
				type: "content_start",
				contentType: "text",
				text: "teammate output",
			},
		},
	});
	return published[0];
}

describe("HubRuntimeHost team identity round-trip", () => {
	afterEach(() => {
		commandMock.mockReset();
		subscribeMock.mockReset();
	});

	it("reconstructs teammate content with the teamRole/teamAgentId the projector attached", async () => {
		let onEvent: ((event: HubEventEnvelope) => void) | undefined;
		subscribeMock.mockImplementation((listener) => {
			onEvent = listener;
			return () => {};
		});
		commandMock.mockResolvedValue({
			payload: {
				session: {
					sessionId: "sess-root",
					status: "running",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				},
			},
		});

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });
		const events: unknown[] = [];
		host.subscribe((event) => events.push(event));
		await host.startSession({
			config: createConfig(),
			source: SessionSource.CLI,
		});

		// The exact envelope the hub daemon would emit on the wire.
		const wireEnvelope = await projectTeammateDelta();
		expect(wireEnvelope.payload?.agent).toEqual(
			expect.objectContaining({
				teamRole: "teammate",
				teamAgentId: "worker-a",
			}),
		);
		onEvent?.(wireEnvelope);

		const delta = events.find(
			(event) =>
				(event as { type?: string }).type === "agent_event" &&
				(event as { payload?: { event?: { type?: string } } }).payload?.event
					?.type === "content_start",
		);
		expect(delta).toBeDefined();
		// The identity must survive the hub boundary so downstream (e.g. the
		// sidecar) can re-address the event to the teammate's child session.
		expect(
			(delta as { payload: { teamRole?: string; teamAgentId?: string } })
				.payload,
		).toEqual(
			expect.objectContaining({
				sessionId: "sess-root",
				teamRole: "teammate",
				teamAgentId: "worker-a",
			}),
		);
	});

	it("leaves content untagged when the wire event carries no agent block", async () => {
		let onEvent: ((event: HubEventEnvelope) => void) | undefined;
		subscribeMock.mockImplementation((listener) => {
			onEvent = listener;
			return () => {};
		});
		commandMock.mockResolvedValue({
			payload: {
				session: {
					sessionId: "sess-root",
					status: "running",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				},
			},
		});

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });
		const events: unknown[] = [];
		host.subscribe((event) => events.push(event));
		await host.startSession({
			config: createConfig(),
			source: SessionSource.CLI,
		});

		onEvent?.({
			version: "v1",
			event: "assistant.delta",
			sessionId: "sess-root",
			payload: { text: "lead output" },
		});

		const delta = events.find(
			(event) =>
				(event as { type?: string }).type === "agent_event" &&
				(event as { payload?: { event?: { type?: string } } }).payload?.event
					?.type === "content_start",
		);
		const payload = (
			delta as {
				payload: { teamRole?: string; teamAgentId?: string };
			}
		).payload;
		expect(payload.teamRole).toBeUndefined();
		expect(payload.teamAgentId).toBeUndefined();
	});

	it("reconstructs the teammate completion (agent.done) tagged, and dedupes per agent", async () => {
		let onEvent: ((event: HubEventEnvelope) => void) | undefined;
		subscribeMock.mockImplementation((listener) => {
			onEvent = listener;
			return () => {};
		});
		commandMock.mockResolvedValue({
			payload: {
				session: {
					sessionId: "sess-root",
					status: "running",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				},
			},
		});

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });
		const events: unknown[] = [];
		host.subscribe((event) => events.push(event));
		await host.startSession({
			config: createConfig(),
			source: SessionSource.CLI,
		});

		const donePayload = {
			reason: "completed",
			text: "Teammate finished: wrote the tests.",
			iterations: 4,
		};

		// 1. The teammate's completion, tagged exactly as the fixed projector emits it.
		onEvent?.({
			version: "v1",
			event: "agent.done",
			sessionId: "sess-root",
			payload: {
				...donePayload,
				agent: {
					kind: "teammate",
					teamRole: "teammate",
					teamAgentId: "worker-a",
				},
			},
		});

		const teammateDone = events.find(
			(event) =>
				(event as { type?: string }).type === "agent_event" &&
				(event as { payload?: { event?: { type?: string } } }).payload?.event
					?.type === "done",
		) as { payload: { teamRole?: string; teamAgentId?: string } } | undefined;
		expect(teammateDone).toBeDefined();
		// Identity must survive the boundary so the sidecar routes the completion
		// to the teammate's child session instead of the lead's transcript.
		expect(teammateDone?.payload).toEqual(
			expect.objectContaining({
				teamRole: "teammate",
				teamAgentId: "worker-a",
			}),
		);

		// 2. The lead completing must NOT be swallowed by the teammate's dedup slot
		//    — this is the per-agent-keying regression (a plain sessionId key would
		//    have dropped the lead's done because the teammate already emitted one).
		onEvent?.({
			version: "v1",
			event: "agent.done",
			sessionId: "sess-root",
			payload: {
				reason: "completed",
				text: "All done.",
				iterations: 2,
				agent: { kind: "lead", teamRole: "lead" },
			},
		});
		const allDones = events.filter(
			(event) =>
				(event as { type?: string }).type === "agent_event" &&
				(event as { payload?: { event?: { type?: string } } }).payload?.event
					?.type === "done",
		);
		expect(allDones).toHaveLength(2);
		const leadDone = allDones[1] as { payload: { teamRole?: string } };
		expect(leadDone.payload.teamRole).toBe("lead");

		// 3. The lead's terminal run.completed (untagged by the projector) maps to the
		//    same "primary" dedup key as the lead's agent.done, so it is dropped — the
		//    run-completed double-emit guard still works per agent.
		onEvent?.({
			version: "v1",
			event: "run.completed",
			sessionId: "sess-root",
			payload: { reason: "completed" },
		});
		expect(
			events.filter(
				(event) =>
					(event as { type?: string }).type === "agent_event" &&
					(event as { payload?: { event?: { type?: string } } }).payload?.event
						?.type === "done",
			),
		).toHaveLength(2);
	});
});
