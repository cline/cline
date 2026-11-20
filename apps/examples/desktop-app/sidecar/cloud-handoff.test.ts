import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { summarizeConversation } from "@cline/core";
import * as gitPreparation from "@cline/core/cloud";
import { DEFAULT_MAX_IMAGE_DECODED_BYTES } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleChatSessionCommand } from "./chat-session";
import {
	beginActiveSessionSend,
	handleDiscardHandoff,
	handleHandoff,
	handlePrepareHandoff,
} from "./cloud-handoff";
import { createCloudSessionTestRuntime } from "./cloud-session-test-runtime";
import {
	CloudCreationUnconfirmedError,
	type CloudSessionApi,
	CloudSessionError,
	getCloudSessionManager,
	resetCloudSessionManager,
} from "./cloud-sessions";
import { createSidecarContext, getEnvironmentContext } from "./context";
import * as sessionConfig from "./session-config";
import {
	cleanupCloudHandoffGates,
	enableCloudHandoffGates,
	localRuntimeContext,
	localSessionManager,
} from "./session-test-helpers";
import type {
	ChatSessionCommandRequest,
	SidecarWebSocketClient,
} from "./types";

vi.mock("@cline/core", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@cline/core")>();
	return {
		...actual,
		summarizeConversation: vi.fn(),
	};
});
vi.mock("@cline/core/cloud", async (importOriginal) => ({
	...(await importOriginal<typeof import("@cline/core/cloud")>()),
	inspectHandoffGit: vi.fn(),
}));

const image =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jT1sAAAAASUVORK5CYII=";
beforeEach(() => {
	vi.clearAllMocks();
	enableCloudHandoffGates();
});
afterEach(() => {
	vi.restoreAllMocks();
	cleanupCloudHandoffGates();
});

async function fixture() {
	const sourceSessionId = "local-source";
	const modelId = "test-model";
	const git = {
		repoUrl: "https://github.com/example/project",
		branch: "cline/handoff-12345678-abc",
		headSha: "a".repeat(40),
		workspaceRelativePath: "packages/app",
	};
	const plan: gitPreparation.HandoffGitPlan = {
		id: "plan",
		root: "/workspace/project",
		...git,
		remote: "origin",
		sourceBranch: "main",
		treeSha: "b".repeat(40),
		files: [],
		commits: [],
	};
	vi.spyOn(gitPreparation, "inspectHandoffGit").mockResolvedValue(plan);
	const messages = [
		{ role: "user" as const, content: "Build a search form." },
		{ role: "assistant" as const, content: "The form is done; tests remain." },
	];
	const config = {
		cwd: "/workspace/project/packages/app",
		provider: "cline",
		model: modelId,
		mode: "plan",
		autoApproveTools: false,
	};
	const update = vi.fn();
	const readLiveMessages = vi.fn().mockResolvedValue(messages);
	const pending = vi.fn().mockResolvedValue([]);
	const get = vi.fn().mockResolvedValue({
		sessionId: sourceSessionId,
		status: "idle",
		cwd: config.cwd,
		provider: "cline",
		model: modelId,
	});
	const ctx = Object.assign(
		createSidecarContext(config.cwd),
		localRuntimeContext(
			{
				get,
				readLiveMessages,
				update,
				pendingPrompts: { list: pending },
			},
			{ sessionIds: [sourceSessionId] },
		),
	);
	ctx.liveSessions.set(sourceSessionId, {
		config,
		messages,
		promptsInQueue: [],
		busy: false,
		status: "idle",
		startedAt: 1,
	});
	const create = vi.fn(
		async (_input: Parameters<CloudSessionApi["create"]>[0]) => ({
			sessionId: "ses-target",
			status: "ready" as const,
			sandboxUrl: "",
		}),
	);
	const cloud = await createCloudSessionTestRuntime(ctx, {
		api: {
			create,
		} as unknown as CloudSessionApi,
		apiBaseUrl: "https://api.example",
		getAuthToken: async () => "synthetic",
	});
	const models = vi
		.spyOn(cloud, "listModels")
		.mockResolvedValue([
			{ id: modelId, catalogId: "cline-cloud", name: "Test" },
		]);
	vi.spyOn(cloud, "prepareHandoffRepository").mockResolvedValue({});
	const send = vi.spyOn(cloud, "send").mockImplementation(async (...args) => {
		args[5]?.beforeDispatch?.();
		return { sessionId: "ses-target", ok: true };
	});
	const summarize = vi
		.fn()
		.mockResolvedValue("Search form: implemented. Next: add tests.");
	const viewer = getCloudSessionManager(ctx);
	const createTarget = viewer.create.bind(viewer);
	const launch = vi
		.spyOn(viewer, "create")
		.mockImplementation(({ localGit: _localGit, ...input }, scope) =>
			createTarget(input, scope),
		);
	const request: ChatSessionCommandRequest = {
		action: "handoff",
		operation: "launch",
		sessionId: sourceSessionId,
		config,
		handoffAttemptId: "attempt-1",
		gitPreparationId: plan.id,
	};
	const prepare = async (completedHandoffAttemptId?: string) => {
		const preview = await handlePrepareHandoff(
			ctx,
			{
				...request,
				operation: "prepare",
				completedHandoffAttemptId,
			},
			summarize,
		);
		expect(preview).toMatchObject({ gitPreparation: { id: plan.id } });
	};
	return {
		cloud,
		models,
		viewer,
		ctx,
		sourceSessionId,
		git,
		plan,
		launch,
		request,
		create,
		send,
		summarize,
		messages,
		update,
		pending,
		get,
		readLiveMessages,
		prepare,
		handoff: (input = request) => handleHandoff(ctx, input),
	};
}

describe("summary cloud handoff", () => {
	it("passes the actual publication payload through the Hub schema to Git", async () => {
		const f = await fixture();
		const root = await mkdtemp(join(tmpdir(), "handoff-contract-"));
		try {
			f.plan.root = root;
			f.launch.mockRestore();
			await f.prepare();
			await expect(f.handoff()).rejects.toThrow("Git remote failed");
			expect(f.create).not.toHaveBeenCalled();
			expect(f.send).not.toHaveBeenCalled();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
	it("returns a missed completion before preparing another cloud task", async () => {
		const f = await fixture();
		await f.prepare();
		const result = await f.handoff();
		const retry = await handlePrepareHandoff(f.ctx, f.request, f.summarize);
		expect(retry).toEqual({
			previousHandoff: { handoffAttemptId: "attempt-1", result },
		});
		expect(f.create).toHaveBeenCalledTimes(1);
		expect(f.send).toHaveBeenCalledTimes(1);
		const acknowledged = {
			...f.request,
			completedHandoffAttemptId: "attempt-1",
		};
		await expect(
			handlePrepareHandoff(f.ctx, acknowledged, f.summarize),
		).resolves.toMatchObject({ gitPreparation: { id: "plan" } });
		await handleDiscardHandoff(f.ctx, acknowledged);
		await expect(
			handlePrepareHandoff(f.ctx, f.request, f.summarize),
		).resolves.toEqual(retry);
		f.summarize.mockRejectedValueOnce(new Error("Summary unavailable"));
		await expect(f.prepare("attempt-1")).rejects.toThrow("Summary unavailable");
		await expect(
			handlePrepareHandoff(f.ctx, f.request, f.summarize),
		).resolves.toEqual(retry);
	});
	it("does not return another account's completed handoff", async () => {
		const f = await fixture();
		await f.prepare();
		await f.handoff();
		f.ctx.cloudSessionManager = (await fixture()).ctx.cloudSessionManager;
		await f.prepare();
	});
	it("discards only the canceled preview, not a newer preview", async () => {
		const f = await fixture();
		vi.mocked(summarizeConversation).mockResolvedValue("Prepared summary");
		await handleChatSessionCommand(f.ctx, {
			...f.request,
			operation: "prepare",
		});
		await handleChatSessionCommand(f.ctx, {
			...f.request,
			operation: "discard",
			gitPreparationId: "older-plan",
		});
		await expect(
			handleChatSessionCommand(f.ctx, f.request),
		).resolves.toMatchObject({
			sessionId: "ses-target",
		});
		await expect(
			handleChatSessionCommand(f.ctx, {
				...f.request,
				operation: "prepare",
				completedHandoffAttemptId: "attempt-1",
			}),
		).resolves.toMatchObject({ gitPreparation: { id: "plan" } });
		await handleChatSessionCommand(f.ctx, {
			...f.request,
			operation: "discard",
		});
		await expect(handleChatSessionCommand(f.ctx, f.request)).rejects.toThrow(
			"review the preparation plan",
		);
	});
	it.each([
		false,
		true,
	])("invalidates only turns overlapping capture (captured=%s)", async (captured) => {
		const f = await fixture();
		const ctx = getEnvironmentContext(f.ctx, "local");
		vi.mocked(gitPreparation.inspectHandoffGit).mockImplementation(
			async (_cwd, onCaptured?: () => void) => {
				if (captured) onCaptured?.();
				const release = beginActiveSessionSend(ctx, f.sourceSessionId);
				f.messages.push({ role: "user", content: "Keep this turn local." });
				release();
				if (!captured) onCaptured?.();
				return f.plan;
			},
		);
		if (!captured) {
			await expect(
				handlePrepareHandoff(ctx, f.request, f.summarize),
			).rejects.toThrow("changed during capture");
			await expect(handleHandoff(ctx, f.request)).rejects.toThrow(
				"review the preparation plan",
			);
		} else {
			await handlePrepareHandoff(ctx, f.request, f.summarize);
			await expect(handleHandoff(ctx, f.request)).resolves.toMatchObject({
				sessionId: "ses-target",
			});
			expect(f.summarize.mock.calls[0]?.[0]).toHaveLength(2);
		}
	});
	it.each([
		"before workspace resolution",
		"during capture",
		"after capture",
	])("invalidates checkpoint restores only during capture (%s)", async (timing) => {
		const f = await fixture();
		const ctx = getEnvironmentContext(f.ctx, "local");
		const captured = timing === "after capture";
		const restore = vi.fn().mockResolvedValue({
			sessionId: "restored-source",
			messages: f.messages.slice(0, 1),
		});
		Object.assign(localSessionManager(f.ctx), { restore });
		const restoreCheckpoint = async () => {
			await expect(
				handleChatSessionCommand(ctx, {
					action: "restore_checkpoint",
					sessionId: f.sourceSessionId,
					checkpointRunCount: 1,
					config: { ...f.request.config, cwd: f.plan.root },
				}),
			).resolves.toMatchObject({ sessionId: "restored-source" });
			expect(ctx.restoringWorkspacePaths.size).toBe(0);
		};
		if (timing === "before workspace resolution") {
			f.pending.mockImplementationOnce(async () => {
				await restoreCheckpoint();
				return [];
			});
		}
		vi.mocked(gitPreparation.inspectHandoffGit).mockImplementation(
			async (_cwd, onCaptured) => {
				if (captured) onCaptured?.();
				if (timing !== "before workspace resolution") await restoreCheckpoint();
				if (!captured) onCaptured?.();
				return f.plan;
			},
		);
		const preparation = handlePrepareHandoff(ctx, f.request, f.summarize);
		if (captured) {
			await expect(preparation).resolves.toMatchObject({
				gitPreparation: { id: f.plan.id },
			});
		} else {
			await expect(preparation).rejects.toThrow("changed during capture");
			await expect(handleHandoff(ctx, f.request)).rejects.toThrow(
				"review the preparation plan",
			);
			expect(f.summarize).not.toHaveBeenCalled();
		}
		expect(restore).toHaveBeenCalledOnce();
		expect(f.launch).not.toHaveBeenCalled();
	});
	it("releases the restore lock when capture invalidation throws", async () => {
		const f = await fixture();
		const ctx = getEnvironmentContext(f.ctx, "local");
		const restore = vi
			.fn()
			.mockRejectedValue(new Error("Restore reached runtime"));
		Object.assign(localSessionManager(f.ctx), { restore });
		vi.mocked(gitPreparation.inspectHandoffGit).mockImplementation(
			async (_cwd, onCaptured) => {
				const error = new Error("Workspace path resolution failed");
				vi.spyOn(sessionConfig, "workspacePathsOverlap").mockImplementationOnce(
					() => {
						throw error;
					},
				);
				const request = {
					action: "restore_checkpoint" as const,
					sessionId: f.sourceSessionId,
					checkpointRunCount: 1,
					config: f.request.config,
				};
				await expect(handleChatSessionCommand(ctx, request)).rejects.toBe(
					error,
				);
				expect(restore).not.toHaveBeenCalled();
				expect(ctx.restoringWorkspacePaths.size).toBe(0);
				await expect(handleChatSessionCommand(ctx, request)).rejects.toThrow(
					"Restore reached runtime",
				);
				expect(restore).toHaveBeenCalledOnce();
				onCaptured?.();
				return f.plan;
			},
		);
		await expect(
			handlePrepareHandoff(ctx, f.request, f.summarize),
		).rejects.toThrow("changed during capture");
	});
	it("shows a provisioning failure reason without losing the unsent draft", async () => {
		const f = await fixture();
		await f.prepare();
		f.send.mockRejectedValue(
			new CloudSessionError("session_failed", "Repository clone failed."),
		);
		await expect(f.handoff()).resolves.toMatchObject({
			warning: expect.stringContaining("Repository clone failed."),
			warningKind: "unqueued",
			unsentPrompt: expect.stringContaining("Search form: implemented."),
		});
	});
	it.each([
		"preview",
		"summary",
		"model",
	] as const)("silently stops an account reset during %s before further publication or creation", async (stage) => {
		const f = await fixture();
		if (stage === "preview") {
			await f.prepare();
			await resetCloudSessionManager(f.ctx);
		}
		if (stage === "summary")
			f.summarize.mockImplementation(async () => {
				await resetCloudSessionManager(f.ctx);
				return "Captured summary";
			});
		if (stage === "model")
			f.models.mockImplementation(async () => {
				await resetCloudSessionManager(f.ctx);
				return [{ id: "test-model", catalogId: "cline-cloud", name: "Test" }];
			});
		await expect(
			stage === "preview"
				? f.handoff()
				: handlePrepareHandoff(f.ctx, f.request, f.summarize),
		).resolves.toEqual({ cancelled: true });
		expect(f.launch).not.toHaveBeenCalled();
		expect(f.ctx.cloudSessionManager).toBeNull();
		expect(f.create).not.toHaveBeenCalled();
		expect(f.send).not.toHaveBeenCalled();
	});
	it("invalidates a prepared handoff when the same viewer changes account and back", async () => {
		const f = await fixture();
		await f.prepare();
		const scope = f.viewer.scope;
		if (!scope) throw new Error("Missing connected test scope");
		vi.spyOn(f.viewer, "scope", "get").mockReturnValue({
			...scope,
			scopeGeneration: scope.scopeGeneration + 2,
		});
		await expect(f.handoff()).resolves.toEqual({ cancelled: true });
		expect(f.launch).not.toHaveBeenCalled();
		expect(f.create).not.toHaveBeenCalled();
		expect(f.send).not.toHaveBeenCalled();
	});
	it("reports a lost launch reply after a Hub restart instead of cancelling draft recovery", async () => {
		const f = await fixture();
		await f.prepare();
		const scope = f.viewer.scope;
		if (!scope) throw new Error("Missing connected test scope");
		f.launch.mockImplementation(async () => {
			vi.spyOn(f.viewer, "scope", "get").mockReturnValue({
				...scope,
				serviceId: "restarted-hub",
			});
			throw new Error("Connection closed");
		});
		await expect(f.handoff()).rejects.toThrow("Connection closed");
		expect(f.launch).toHaveBeenCalledOnce();
		expect(f.send).not.toHaveBeenCalled();
	});
	it("does not return a preview after the account changes during capture", async () => {
		const f = await fixture();
		f.readLiveMessages.mockImplementation(async () => {
			await resetCloudSessionManager(f.ctx);
			return f.messages;
		});
		await expect(
			handlePrepareHandoff(f.ctx, f.request, f.summarize),
		).resolves.toEqual({
			cancelled: true,
		});
		expect(f.launch).not.toHaveBeenCalled();
		expect(f.create).not.toHaveBeenCalled();
	});
	it("hides a submitted handoff after account reset without cancelling the Hub task", async () => {
		const f = await fixture();
		const events: Array<{ name: string; payload: { phase?: string } }> = [];
		f.ctx.wsClients.add({
			data: { canApproveTools: true },
			send: (message) => events.push(JSON.parse(message).event),
		});
		await f.prepare();
		f.create.mockImplementation(async () => {
			await resetCloudSessionManager(f.ctx);
			return { sessionId: "ses-target", status: "ready", sandboxUrl: "" };
		});
		await expect(f.handoff()).resolves.toEqual({ cancelled: true });
		await vi.waitFor(() => expect(f.send).toHaveBeenCalledOnce());
		expect(f.create).toHaveBeenCalledOnce();
		expect(events.some((event) => event.payload.phase === "complete")).toBe(
			false,
		);
	});
	it("does not expose a completed handoff after the same viewer changes account", async () => {
		const f = await fixture();
		await f.prepare();
		await f.handoff();
		const scope = f.viewer.scope;
		if (!scope) throw new Error("Missing connected test scope");
		vi.spyOn(f.viewer, "scope", "get").mockReturnValue({
			...scope,
			scopeGeneration: scope.scopeGeneration + 1,
		});
		// The server still has the old scope, so a new preview must also be rejected.
		await expect(
			handlePrepareHandoff(f.ctx, f.request, f.summarize),
		).rejects.toThrow("account changed");
	});
	it("uses the captured conversation and configuration while the source continues locally", async () => {
		const f = await fixture();
		const originalMessages = structuredClone(f.messages);
		const originalConfig = structuredClone(f.request.config);
		vi.mocked(gitPreparation.inspectHandoffGit).mockImplementation(async () => {
			f.messages[0].content = "A later local edit";
			f.messages.push({ role: "user", content: "Keep this new work local." });
			const local = f.ctx.liveSessions.get(f.sourceSessionId);
			if (!local) throw new Error("Source fixture is missing");
			local.busy = true;
			local.status = "running";
			local.config.model = "later-local-model";
			local.config.mode = "act";
			local.config.cwd = "/workspace/other";
			return f.plan;
		});
		f.summarize.mockImplementation(async () => {
			expect(f.ctx.restoringWorkspacePaths.size).toBe(0);
			return "Captured conversation summary";
		});
		await f.prepare();
		await f.handoff(f.request);
		expect(f.summarize).toHaveBeenCalledExactlyOnceWith(
			originalMessages,
			originalConfig,
		);
		expect(f.readLiveMessages).toHaveBeenCalledTimes(1);
		expect(f.launch).toHaveBeenCalledWith(
			expect.objectContaining({ localGit: expect.objectContaining(f.git) }),
			expect.any(Object),
		);
		expect(f.create).toHaveBeenCalledWith(
			expect.objectContaining({
				modelId: "test-model",
				mode: "plan",
				workspaceRelativePath: "packages/app",
				initialPrompt: expect.stringContaining("Captured conversation summary"),
			}),
		);
		expect(f.send.mock.calls[0]?.[1]).not.toContain("Keep this new work local");
		expect(f.ctx.liveSessions.get(f.sourceSessionId)?.status).toBe("running");
		expect(f.ctx.restoringWorkspacePaths.size).toBe(0);
	});

	it("rejects competing previews and duplicate confirmed requests", async () => {
		const f = await fixture();
		const first = handlePrepareHandoff(f.ctx, f.request, f.summarize);
		await expect(
			handlePrepareHandoff(f.ctx, f.request, f.summarize),
		).rejects.toThrow("already in progress");
		await first;
		expect(f.readLiveMessages).toHaveBeenCalledTimes(1);
		expect(gitPreparation.inspectHandoffGit).toHaveBeenCalledTimes(1);
		const sending = Promise.withResolvers<{ sessionId: string; ok: true }>();
		f.send.mockReturnValue(sending.promise);
		const execution = f.handoff();
		await expect(f.handoff()).rejects.toThrow("already in progress");
		await expect(
			f.handoff({ ...f.request, nextCommand: "other" }),
		).rejects.toThrow("already in progress");
		await expect(
			handlePrepareHandoff(f.ctx, f.request, f.summarize),
		).rejects.toThrow("already in progress");
		sending.resolve({ sessionId: "ses-target", ok: true });
		expect(await execution).toMatchObject({ sessionId: "ses-target" });
		expect(f.summarize).toHaveBeenCalledOnce();
		expect(f.launch).toHaveBeenCalledOnce();
		expect(f.create).toHaveBeenCalledOnce();
		expect(f.send).toHaveBeenCalledOnce();
	});

	it("submits the approved Git snapshot to Hub, sends one combined prompt with invocation images, and leaves source history alone", async () => {
		const f = await fixture();
		const preparationProgress: unknown[] = [];
		f.ctx.wsClients.add({
			data: { canApproveTools: true },
			send: (raw: string) => {
				const event = JSON.parse(raw).event;
				if (event?.name === "cloud_handoff_progress")
					preparationProgress.push(event.payload);
			},
		} as unknown as SidecarWebSocketClient);
		f.send.mockImplementation(async (...args) => {
			expect(preparationProgress).toContainEqual(
				expect.objectContaining({
					phase: "provisioning",
					sessionId: "ses-target",
				}),
			);
			args[5]?.beforeDispatch?.();
			return { sessionId: "ses-target", ok: true };
		});
		await f.prepare();
		const result = await f.handoff({
			...f.request,
			nextCommand: "Test keyboard navigation.",
			attachments: { userImages: [image] },
		});
		expect(f.launch).toHaveBeenCalledWith(
			expect.objectContaining({ localGit: expect.objectContaining(f.git) }),
			expect.any(Object),
		);
		expect(f.summarize).toHaveBeenCalledExactlyOnceWith(
			f.messages,
			f.request.config,
		);
		expect(f.readLiveMessages).toHaveBeenCalledTimes(1);
		expect(f.summarize).toHaveBeenCalledBefore(f.launch);
		expect(preparationProgress).toEqual([
			expect.objectContaining({
				handoffAttemptId: "attempt-1",
				phase: "checking",
			}),
			expect.objectContaining({
				handoffAttemptId: "attempt-1",
				phase: "provisioning",
				sessionId: "ses-target",
			}),
			expect.objectContaining({ phase: "complete", sessionId: "ses-target" }),
		]);
		expect(f.create).toHaveBeenCalledWith(
			expect.objectContaining({
				repoUrl: f.git.repoUrl,
				branch: f.git.branch,
				mode: "plan",
				workspaceRelativePath: "packages/app",
			}),
		);
		const prompt =
			"Search form: implemented. Next: add tests.\n\nNext instruction from the user:\nTest keyboard navigation.";
		expect(f.send).toHaveBeenCalledWith(
			"ses-target",
			prompt,
			"queue",
			"test-model",
			[image],
			expect.any(Object),
		);
		expect(result).not.toHaveProperty("unsentPrompt");
		expect(result).toMatchObject({
			sessionId: "ses-target",
			sourceSessionId: f.sourceSessionId,
		});
		expect(f.update).not.toHaveBeenCalled();
		expect(f.messages).toEqual([
			{ role: "user", content: "Build a search form." },
			{ role: "assistant", content: "The form is done; tests remain." },
		]);
	});

	it("allows bare /cloud with an image and a deliberate second handoff", async () => {
		const f = await fixture();
		await f.prepare();
		await f.handoff({
			...f.request,
			attachments: { userImages: [image] },
		});
		expect(f.send.mock.calls[0]?.[1]).toContain(
			"If no next action is clear, ask",
		);
		expect(f.send.mock.calls[0]?.[4]).toEqual([image]);
		await f.prepare("attempt-1");
		await f.handoff({ ...f.request, handoffAttemptId: "attempt-2" });
		expect(f.create.mock.calls.map(([input]) => input.requestId)).toEqual([
			"attempt-1",
			"attempt-2",
		]);
	});

	it("uses the selected local connection to summarize through the command handler", async () => {
		const f = await fixture();
		vi.mocked(summarizeConversation).mockResolvedValue("Prepared summary");
		const { handleCommand } = await import("./commands");
		const trusted = {
			connection: { data: { canApproveTools: true }, send: vi.fn() },
		};
		for (const operation of ["prepare", "discard", "launch"]) {
			await expect(
				handleCommand(f.ctx, "chat_session_command", {
					request: { ...f.request, operation },
				}),
			).rejects.toThrow("trusted desktop connection");
		}
		expect(gitPreparation.inspectHandoffGit).not.toHaveBeenCalled();
		expect(summarizeConversation).not.toHaveBeenCalled();
		expect(f.launch).not.toHaveBeenCalled();
		for (const operation of [undefined, "unknown"]) {
			await expect(
				handleCommand(
					f.ctx,
					"chat_session_command",
					{ request: { ...f.request, operation } },
					trusted,
				),
			).rejects.toThrow("unsupported handoff operation");
		}
		await handleCommand(
			f.ctx,
			"chat_session_command",
			{
				request: {
					...f.request,
					operation: "prepare",
					config: {
						...f.request.config,
						provider: "anthropic",
						apiKey: "synthetic-key",
					},
				},
			},
			trusted,
		);
		expect(summarizeConversation).toHaveBeenCalledOnce();
		expect(f.launch).not.toHaveBeenCalled();
		await handleCommand(
			f.ctx,
			"chat_session_command",
			{ request: f.request },
			trusted,
		);
		expect(summarizeConversation).toHaveBeenCalledTimes(1);
		expect(summarizeConversation).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: f.messages,
				config: expect.objectContaining({
					providerId: "anthropic",
					modelId: "test-model",
					apiKey: "synthetic-key",
				}),
			}),
		);
		expect(f.send.mock.calls[0]?.[1]).toContain("Prepared summary");
	});

	it.each([
		"busy",
		"running in Hub",
		"queued",
	] as const)("rejects a %s source before Git preparation", async (state) => {
		const f = await fixture();
		if (state === "busy") {
			const source = f.ctx.liveSessions.get(f.sourceSessionId);
			if (!source) throw new Error("Source fixture is missing");
			source.busy = true;
		} else if (state === "running in Hub") {
			f.get.mockResolvedValue({
				sessionId: f.sourceSessionId,
				status: "running",
			});
		} else f.pending.mockResolvedValue([{ id: "queued" }]);
		await expect(
			handlePrepareHandoff(f.ctx, f.request, f.summarize),
		).rejects.toThrow(state === "queued" ? "queued prompts" : "current run");
		expect(f.launch).not.toHaveBeenCalled();
		expect(f.create).not.toHaveBeenCalled();
	});

	it.each([
		"failure",
		"empty",
		"empty context",
	] as const)("does not publish Git or create a cloud task after summary %s", async (failure) => {
		const f = await fixture();
		if (failure === "failure")
			f.summarize.mockRejectedValue(new Error("Summary failed"));
		if (failure === "empty") f.summarize.mockResolvedValue(" ");
		if (failure === "empty context") f.readLiveMessages.mockResolvedValue([]);
		await expect(
			(async () => {
				await f.prepare();
				await f.handoff();
			})(),
		).rejects.toThrow();
		expect(f.launch).not.toHaveBeenCalled();
		expect(f.create).not.toHaveBeenCalled();
		expect(f.update).not.toHaveBeenCalled();
	});

	it.each([
		false,
		true,
		undefined,
	])("returns the prepared prompt only for a definitely unsent failure (dispatched: %s)", async (dispatched) => {
		const f = await fixture();
		const completed: unknown[] = [];
		f.ctx.wsClients.add({
			data: { canApproveTools: true },
			send: (raw: string) => {
				const event = JSON.parse(raw).event;
				if (
					event?.name === "cloud_handoff_progress" &&
					event.payload.phase === "complete"
				)
					completed.push(event.payload);
			},
		} as unknown as SidecarWebSocketClient);
		await f.prepare();
		if (dispatched === undefined) {
			const create = f.launch.getMockImplementation();
			if (!create) throw new Error("Missing launch fixture");
			f.launch.mockImplementation(async (...args) => {
				await create(...args);
				throw new Error("Reply lost after send");
			});
		} else {
			f.send.mockImplementation(async (...args) => {
				if (dispatched) args[5]?.beforeDispatch?.();
				throw new Error("Connection failed");
			});
		}
		const result = await f.handoff({
			...f.request,
			nextCommand: "Add tests",
			attachments: { userImages: [image] },
		});
		if (dispatched !== false) expect(result).not.toHaveProperty("unsentPrompt");
		else
			expect(result).toHaveProperty(
				"unsentPrompt",
				"Search form: implemented. Next: add tests.\n\nNext instruction from the user:\nAdd tests",
			);
		expect(result).toMatchObject({
			sessionId: "ses-target",
			warningKind: dispatched !== false ? "unconfirmed" : "unqueued",
			warning: expect.stringContaining(
				dispatched !== false
					? "delivery is unconfirmed"
					: "Closing Cline or approving another /cloud discards this draft",
			),
		});
		expect(completed).toEqual([expect.objectContaining(result)]);
	});

	it("does not automatically retry unconfirmed creation", async () => {
		const f = await fixture();
		await f.prepare();
		f.create.mockRejectedValue(
			new CloudCreationUnconfirmedError(new Error("Connection lost")),
		);
		await expect(f.handoff(f.request)).rejects.toThrow("ambiguous");
		expect(f.create).toHaveBeenCalledTimes(1);
		expect(f.send).not.toHaveBeenCalled();
		expect(f.update).not.toHaveBeenCalled();
	});

	it.each([
		"count",
		"bytes",
	] as const)("validates image %s limits before publishing", async (limit) => {
		const f = await fixture();
		await f.prepare();
		const images =
			limit === "count"
				? Array(6).fill(image)
				: [
						`data:image/png;base64,${Buffer.alloc(DEFAULT_MAX_IMAGE_DECODED_BYTES + 1).toString("base64")}`,
					];
		await expect(
			f.handoff({
				...f.request,
				attachments: { userImages: images },
			}),
		).rejects.toThrow();
		expect(f.summarize).toHaveBeenCalledOnce();
		expect(f.launch).not.toHaveBeenCalled();
		expect(f.create).not.toHaveBeenCalled();
	});

	it("rejects an unapproved Git preparation", async () => {
		const f = await fixture();
		await handlePrepareHandoff(f.ctx, f.request, f.summarize);
		await expect(
			f.handoff({ ...f.request, gitPreparationId: "stale" }),
		).rejects.toThrow("review");
		expect(f.launch).not.toHaveBeenCalled();
	});
});
