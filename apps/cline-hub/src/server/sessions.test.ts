import type {
	ClineCore,
	ClineCoreStartInput,
	SessionRecord,
} from "@cline/core";
import { Agent as AgentRuntime } from "@cline/core";
import type { MessageWithMetadata } from "@cline/llms";
import type { AgentMessage, AgentModel, AgentModelEvent } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { createSession, forkPeerSession, sendMessage } from "./sessions";
import type { HubContext } from "./state";
import type { BrowserPeer } from "./types";

vi.mock("./deps", () => ({
	providerSettingsManager: {
		getLastUsedProviderSettings: () => ({ provider: "test", model: "model" }),
	},
	workspaceRoot: "/workspace",
}));
vi.mock("./providers", () => ({}));
vi.mock("./state-payloads", () => ({ broadcastHubState: vi.fn() }));

function createHarness() {
	let runtime: AgentRuntime;
	let record: SessionRecord;
	let toolExecutions = 0;
	const modelRequests: unknown[] = [];
	const requestToolApproval = vi.fn(async () => ({ approved: false }));
	const compactionState = { conversation_id: "session" };
	const model: AgentModel = {
		async *stream(request): AsyncIterable<AgentModelEvent> {
			modelRequests.push(request);
			if (modelRequests.length % 2 === 1) {
				yield {
					type: "tool-call-delta",
					toolCallId: `edit-${modelRequests.length}`,
					toolName: "edit_file",
					input: {},
				};
				yield { type: "finish", reason: "tool-calls" };
			} else {
				yield { type: "text-delta", text: "Done" };
				yield { type: "finish", reason: "stop" };
			}
		},
	};
	const start = vi.fn(async (input: ClineCoreStartInput) => {
		runtime = new AgentRuntime({
			sessionId: "session",
			model,
			initialMessages: input.initialMessages as unknown as AgentMessage[],
			toolPolicies: input.toolPolicies,
			requestToolApproval,
			tools: [
				{
					name: "edit_file",
					description: "Edit a file",
					inputSchema: { type: "object" },
					execute: async () => {
						toolExecutions++;
						return "edited";
					},
				},
			],
		});
		record = {
			...record,
			sessionId: "session",
			source: "web",
			status: "idle",
			provider: input.config.providerId,
			model: input.config.modelId,
			workspaceRoot: input.config.workspaceRoot,
			cwd: input.config.cwd,
			enableTools: input.config.enableTools,
			enableSpawn: input.config.enableSpawnAgent,
			enableTeams: input.config.enableAgentTeams,
			teamName: input.config.teamName,
			metadata: input.sessionMetadata,
		} as SessionRecord;
		return { sessionId: "session" };
	});
	const stop = vi.fn(async () => {});
	const send = vi.fn(async (input: { prompt: string }) =>
		runtime.run(input.prompt),
	);
	const update = vi.fn(async (_sessionId, { metadata }) => {
		record.metadata = metadata;
		return { updated: true };
	});
	const updateSessionConnection = vi.fn(async () => {});
	const readLiveMessages = vi.fn(
		async () => runtime.snapshot().messages as unknown as MessageWithMetadata[],
	);
	const cline = {
		start,
		stop,
		send,
		get: vi.fn(async () => record),
		update,
		updateSessionConnection,
		readLiveMessages,
		readMessages: readLiveMessages,
		readSessionCompactionState: vi.fn(async () => compactionState),
	} as unknown as ClineCore;
	const ctx = {
		cline,
		sessions: new Map(),
		send: vi.fn(),
	} as unknown as HubContext;
	const peer = {} as BrowserPeer;
	return {
		ctx,
		peer,
		start,
		stop,
		send,
		readLiveMessages,
		update,
		updateSessionConnection,
		requestToolApproval,
		compactionState,
		get record() {
			return record;
		},
		get messages() {
			return runtime.snapshot().messages;
		},
		get toolExecutions() {
			return toolExecutions;
		},
	};
}

describe("browser session configuration", () => {
	it("requires approval on the next turn when auto-approval is disabled", async () => {
		const h = createHarness();
		await createSession(h.ctx, h.peer, "first edit", {
			autoApproveTools: true,
		});
		const history = h.messages;
		expect(h.toolExecutions).toBe(1);
		await sendMessage(h.ctx, h.peer, "second edit", {
			autoApproveTools: false,
		});
		expect(h.requestToolApproval).toHaveBeenCalledOnce();
		expect(h.toolExecutions).toBe(1);
		expect(h.peer.selectedSessionId).toBe("session");
		expect(h.start).toHaveBeenLastCalledWith(
			expect.objectContaining({
				config: expect.objectContaining({ sessionId: "session" }),
				initialMessages: history,
				initialCompactionState: h.compactionState,
			}),
		);
		expect(h.messages.slice(0, history.length)).toEqual(history);
		expect(h.update).toHaveBeenCalledWith(
			"session",
			expect.objectContaining({
				metadata: expect.objectContaining({ autoApproveTools: false }),
			}),
		);
	});

	it("applies provider/model and other runtime options before sending", async () => {
		const h = createHarness();
		await createSession(h.ctx, h.peer, "start");
		const config = {
			provider: "other-provider",
			model: "other-model",
			reasonLevel: "high" as const,
			systemPrompt: "New instructions",
			maxIterations: 9,
			enableTools: false,
			enableSpawn: false,
			enableTeams: true,
		};
		await sendMessage(h.ctx, h.peer, "continue", config, {
			userImages: ["image"],
		});
		expect(h.start).toHaveBeenLastCalledWith(
			expect.objectContaining({
				config: expect.objectContaining({
					providerId: config.provider,
					modelId: config.model,
					thinking: true,
					reasoningEffort: "high",
					systemPrompt: config.systemPrompt,
					maxIterations: 9,
					enableTools: false,
					enableSpawnAgent: false,
					enableAgentTeams: true,
				}),
			}),
		);
		expect(h.updateSessionConnection).toHaveBeenCalledWith("session", {
			providerId: config.provider,
			modelId: config.model,
		});
		expect(h.record.metadata).toMatchObject(config);
		expect(h.send).toHaveBeenLastCalledWith(
			expect.objectContaining({
				sessionId: "session",
				prompt: "continue",
				userImages: ["image"],
			}),
		);
		expect(h.start.mock.invocationCallOrder[1]).toBeLessThan(
			h.send.mock.invocationCallOrder[1],
		);
	});

	it("does not restart for equivalent defaults, omitted settings, or unchanged config", async () => {
		const h = createHarness();
		await createSession(h.ctx, h.peer, "first", { autoApproveTools: false });
		await sendMessage(h.ctx, h.peer, "second", {
			autoApproveTools: false,
			enableTools: true,
			enableSpawn: true,
			enableTeams: false,
			systemPrompt: "",
		});
		await sendMessage(h.ctx, h.peer, "third");
		expect(h.start).toHaveBeenCalledOnce();
		expect(h.stop).not.toHaveBeenCalled();
		expect(h.readLiveMessages).not.toHaveBeenCalled();
	});

	it.each([
		"running",
		"pending",
	] as const)("preserves an active %s turn when configuration changes", async (status) => {
		const h = createHarness();
		await createSession(h.ctx, h.peer, "first");
		h.record.status = status;
		await expect(
			sendMessage(h.ctx, h.peer, "second", { autoApproveTools: false }),
		).rejects.toThrow("Stop the current turn");
		expect(h.stop).not.toHaveBeenCalled();
		expect(h.send).toHaveBeenCalledOnce();
	});

	it("restores the previous runtime and preserves history when replacement fails", async () => {
		const h = createHarness();
		await createSession(h.ctx, h.peer, "first");
		const history = h.messages;
		h.start.mockRejectedValueOnce(new Error("Invalid provider configuration"));
		await expect(
			sendMessage(h.ctx, h.peer, "second", { provider: "invalid" }),
		).rejects.toThrow("Invalid provider configuration");
		expect(h.start).toHaveBeenLastCalledWith(
			expect.objectContaining({
				config: expect.objectContaining({
					providerId: "test",
					sessionId: "session",
				}),
				initialMessages: history,
			}),
		);
		expect(h.messages).toEqual(history);
		expect(h.send).toHaveBeenCalledOnce();
	});

	it("resets optional settings explicitly and reuses persisted flags when forking", async () => {
		const h = createHarness();
		await createSession(h.ctx, h.peer, "first", {
			systemPrompt: "Old prompt",
			maxIterations: 2,
		});
		await sendMessage(h.ctx, h.peer, "second", {
			systemPrompt: "",
			maxIterations: null,
			enableTools: false,
			enableSpawn: false,
			enableTeams: true,
		});
		expect(h.start).toHaveBeenLastCalledWith(
			expect.objectContaining({
				config: expect.objectContaining({
					systemPrompt: "",
					maxIterations: undefined,
				}),
			}),
		);
		// Read-only resume keeps original flags in the stored manifest. Browser
		// metadata must retain the effective choices after the resident runtime exits.
		h.record.enableTools = true;
		h.record.enableSpawn = true;
		h.record.enableTeams = false;
		await sendMessage(h.ctx, h.peer, "third", {
			enableTools: false,
			enableSpawn: false,
			enableTeams: true,
		});
		expect(h.start).toHaveBeenCalledTimes(2);
		await forkPeerSession(h.ctx, h.peer, async () => {});
		expect(h.start).toHaveBeenLastCalledWith(
			expect.objectContaining({
				config: expect.objectContaining({
					systemPrompt: "",
					maxIterations: undefined,
					enableTools: false,
					enableSpawnAgent: false,
					enableAgentTeams: true,
				}),
			}),
		);
	});
});
