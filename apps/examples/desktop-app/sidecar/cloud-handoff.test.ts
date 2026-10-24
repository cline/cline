import { summarizeConversation } from "@cline/core";
import { DEFAULT_MAX_IMAGE_DECODED_BYTES } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	beginActiveSessionSend,
	handleDiscardHandoff,
	handleHandoff,
	handlePrepareHandoff,
} from "./cloud-handoff";
import * as gitPreparation from "./cloud-handoff-git";
import { createCloudSessionTestRuntime } from "./cloud-session-test-runtime";
import {
	CloudCreationUnconfirmedError,
	type CloudSessionApi,
	CloudSessionError,
	getCloudSessionManager,
	resetCloudSessionManager,
} from "./cloud-sessions";
import { createSidecarContext, getEnvironmentContext } from "./context";
import {
	cleanupCloudHandoffGates,
	enableCloudHandoffGates,
	localRuntimeContext,
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

const image =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jT1sAAAAASUVORK5CYII=";
beforeEach(enableCloudHandoffGates);
afterEach(() => {
	vi.restoreAllMocks();
	cleanupCloudHandoffGates();
});

async function fixture() {
	const sourceSessionId = "local-source";
	const modelId = "test-model";
	const git = {
		repoUrl: "https://github.com/example/project",
		branch: "cline/handoff-test",
		headSha: "a".repeat(40),
		workspaceRelativePath: "packages/app",
	};
	const plan: gitPreparation.HandoffGitPlan = {
		id: "plan",
		root: "/workspace/project",
		...git,
		pushUrl: git.repoUrl,
		remote: "origin",
		sourceBranch: "main",
		treeSha: "b".repeat(40),
		files: [],
		commits: [],
	};
	vi.spyOn(gitPreparation, "inspectHandoffGit").mockResolvedValue(plan);
	const apply = vi
		.spyOn(gitPreparation, "applyHandoffGit")
		.mockResolvedValue(git.headSha);
	const verifyPublished = vi
		.spyOn(gitPreparation, "verifyPublishedHandoffGit")
		.mockResolvedValue();
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
	const request: ChatSessionCommandRequest = {
		action: "handoff",
		sessionId: sourceSessionId,
		config,
		handoffAttemptId: "attempt-1",
		gitPreparationId: plan.id,
	};
	const prepare = async (completedHandoffAttemptId?: string) => {
		const preview = await handlePrepareHandoff(ctx, {
			...request,
			action: "prepare_handoff",
			completedHandoffAttemptId,
		});
		expect(preview).toMatchObject({ gitPreparation: { id: plan.id } });
	};
	return {
		cloud,
		models,
		viewer: getCloudSessionManager(ctx),
		ctx,
		sourceSessionId,
		git,
		plan,
		apply,
		verifyPublished,
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
		handoff: (input = request) => handleHandoff(ctx, input, summarize),
	};
}

describe("summary cloud handoff", () => {
	it("returns a missed completion before preparing another cloud task", async () => {
		const f = await fixture();
		await f.prepare();
		const result = await f.handoff();
		const retry = await handlePrepareHandoff(f.ctx, f.request);
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
			handlePrepareHandoff(f.ctx, acknowledged),
		).resolves.toMatchObject({ gitPreparation: { id: "plan" } });
		await handleDiscardHandoff(f.ctx, acknowledged);
		await expect(handlePrepareHandoff(f.ctx, f.request)).resolves.toEqual(
			retry,
		);
		await f.prepare("attempt-1");
		f.summarize.mockRejectedValueOnce(new Error("Summary unavailable"));
		await expect(
			f.handoff({ ...f.request, handoffAttemptId: "attempt-2" }),
		).rejects.toThrow("Summary unavailable");
		await f.prepare();
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
		await f.prepare();
		await handleDiscardHandoff(f.ctx, {
			...f.request,
			gitPreparationId: "older-plan",
		});
		await expect(f.handoff()).resolves.toMatchObject({
			sessionId: "ses-target",
		});
		await expect(
			handlePrepareHandoff(f.ctx, {
				...f.request,
				completedHandoffAttemptId: "attempt-1",
			}),
		).resolves.toMatchObject({ gitPreparation: { id: "plan" } });
		await handleDiscardHandoff(f.ctx, f.request);
		await expect(f.handoff()).rejects.toThrow("review the preparation plan");
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
			await expect(handlePrepareHandoff(ctx, f.request)).rejects.toThrow(
				"conversation changed",
			);
			await expect(handleHandoff(ctx, f.request, f.summarize)).rejects.toThrow(
				"review the preparation plan",
			);
		} else {
			await handlePrepareHandoff(ctx, f.request);
			await expect(
				handleHandoff(ctx, f.request, f.summarize),
			).resolves.toMatchObject({
				sessionId: "ses-target",
			});
			expect(f.summarize.mock.calls[0]?.[0]).toHaveLength(2);
		}
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
		"publication",
		"verification",
		"model",
	] as const)("rejects an account reset during %s before further publication or creation", async (stage) => {
		const f = await fixture();
		await handlePrepareHandoff(f.ctx, f.request);
		if (stage === "preview") await resetCloudSessionManager(f.ctx);
		if (stage === "summary")
			f.summarize.mockImplementation(async () => {
				await resetCloudSessionManager(f.ctx);
				return "Captured summary";
			});
		if (stage === "publication")
			f.apply.mockImplementation(async () => {
				await resetCloudSessionManager(f.ctx);
				return f.git.headSha;
			});
		if (stage === "verification")
			f.verifyPublished.mockImplementation(async () => {
				await resetCloudSessionManager(f.ctx);
			});
		if (stage === "model")
			f.models.mockImplementation(async () => {
				await resetCloudSessionManager(f.ctx);
				return [{ id: "test-model", catalogId: "cline-cloud", name: "Test" }];
			});
		await expect(f.handoff(f.request)).rejects.toThrow(
			/account changed|viewer is disposed/,
		);
		if (stage === "preview" || stage === "summary")
			expect(f.apply).not.toHaveBeenCalled();
		expect(f.ctx.cloudSessionManager).toBeNull();
		expect(f.create).not.toHaveBeenCalled();
		expect(f.send).not.toHaveBeenCalled();
	});
	it("invalidates a prepared handoff when the same viewer changes account and back", async () => {
		const f = await fixture();
		await f.prepare();
		const scope = f.viewer.scope;
		if (!scope) throw new Error("Missing connected test scope");
		f.summarize.mockImplementation(async () => {
			vi.spyOn(f.viewer, "scope", "get").mockReturnValue({
				...scope,
				scopeGeneration: scope.scopeGeneration + 2,
			});
			return "Captured summary";
		});
		await expect(f.handoff()).rejects.toThrow("account changed");
		expect(f.apply).not.toHaveBeenCalled();
		expect(f.create).not.toHaveBeenCalled();
		expect(f.send).not.toHaveBeenCalled();
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
		await expect(handlePrepareHandoff(f.ctx, f.request)).rejects.toThrow(
			"account changed",
		);
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
		expect(f.verifyPublished).toHaveBeenCalledWith(f.plan, f.git.headSha);
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
		const first = handlePrepareHandoff(f.ctx, f.request);
		await expect(handlePrepareHandoff(f.ctx, f.request)).rejects.toThrow(
			"already in progress",
		);
		await first;
		expect(f.readLiveMessages).toHaveBeenCalledTimes(1);
		expect(gitPreparation.inspectHandoffGit).toHaveBeenCalledTimes(1);
		const summary = Promise.withResolvers<string>();
		f.summarize.mockReturnValue(summary.promise);
		const execution = f.handoff();
		await expect(f.handoff()).rejects.toThrow("already in progress");
		await expect(
			f.handoff({ ...f.request, nextCommand: "other" }),
		).rejects.toThrow("already in progress");
		await expect(handlePrepareHandoff(f.ctx, f.request)).rejects.toThrow(
			"already in progress",
		);
		summary.resolve("Prepared summary");
		expect(await execution).toMatchObject({ sessionId: "ses-target" });
		expect(f.summarize).toHaveBeenCalledOnce();
		expect(f.apply).toHaveBeenCalledOnce();
		expect(f.create).toHaveBeenCalledOnce();
		expect(f.send).toHaveBeenCalledOnce();
	});

	it("publishes a dedicated branch, sends one combined prompt with invocation images, and leaves source history alone", async () => {
		const f = await fixture();
		const preparationProgress: unknown[] = [];
		f.ctx.wsClients.add({
			data: { canApproveTools: true },
			send: (raw: string) => {
				const event = JSON.parse(raw).event;
				if (
					event?.name === "cloud_handoff_progress" &&
					["summarizing", "checking", "provisioning"].includes(
						event.payload.phase,
					)
				)
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
		expect(f.apply).toHaveBeenCalledWith(f.plan);
		expect(f.summarize).toHaveBeenCalledExactlyOnceWith(
			f.messages,
			f.request.config,
		);
		expect(f.readLiveMessages).toHaveBeenCalledTimes(1);
		expect(f.summarize).toHaveBeenCalledBefore(f.apply);
		expect(preparationProgress).toEqual([
			expect.objectContaining({
				handoffAttemptId: "attempt-1",
				phase: "summarizing",
			}),
			expect.objectContaining({
				handoffAttemptId: "attempt-1",
				phase: "checking",
			}),
			expect.objectContaining({
				handoffAttemptId: "attempt-1",
				phase: "provisioning",
				sessionId: "ses-target",
			}),
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
		const scoped = getEnvironmentContext(f.ctx, "local");
		await handlePrepareHandoff(scoped, {
			...f.request,
			config: {
				...f.request.config,
				provider: "anthropic",
				apiKey: "synthetic-key",
			},
		});
		vi.mocked(summarizeConversation).mockResolvedValue("Prepared summary");
		const { handleCommand } = await import("./commands");
		await expect(
			handleCommand(f.ctx, "chat_session_command", { request: f.request }),
		).rejects.toThrow("trusted desktop connection");
		expect(summarizeConversation).not.toHaveBeenCalled();
		expect(f.apply).not.toHaveBeenCalled();
		await handleCommand(
			f.ctx,
			"chat_session_command",
			{ request: f.request },
			{
				connection: { data: { canApproveTools: true }, send: vi.fn() },
			},
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
		await expect(handlePrepareHandoff(f.ctx, f.request)).rejects.toThrow(
			state === "queued" ? "queued prompts" : "current run",
		);
		expect(f.apply).not.toHaveBeenCalled();
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
		expect(f.apply).not.toHaveBeenCalled();
		expect(f.create).not.toHaveBeenCalled();
		expect(f.update).not.toHaveBeenCalled();
	});

	it.each([
		"git",
		"model",
	] as const)("rejects %s becoming unavailable after preview", async (changed) => {
		const f = await fixture();
		await f.prepare();
		if (changed === "git")
			f.verifyPublished.mockRejectedValue(
				new Error("Published branch changed"),
			);
		else
			f.models.mockResolvedValue([
				{ id: "other-model", catalogId: "cline-cloud", name: "Other" },
			]);
		await expect(f.handoff()).rejects.toThrow(
			changed === "git" ? "changed" : "not available",
		);
		expect(f.summarize).toHaveBeenCalledTimes(changed === "git" ? 1 : 0);
		if (changed === "model") expect(f.apply).not.toHaveBeenCalled();
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
			const createAndSend = f.viewer.createAndSend.bind(f.viewer);
			vi.spyOn(f.viewer, "createAndSend").mockImplementation(
				async (...args) => {
					await createAndSend(...args);
					throw new Error("Reply lost after send");
				},
			);
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
					: "closing it loses the unsent draft",
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
	] as const)("validates image %s limits before summarizing or publishing", async (limit) => {
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
		expect(f.summarize).not.toHaveBeenCalled();
		expect(f.apply).not.toHaveBeenCalled();
		expect(f.create).not.toHaveBeenCalled();
	});

	it("rejects an unapproved Git preparation", async () => {
		const f = await fixture();
		await handlePrepareHandoff(f.ctx, f.request);
		await expect(
			f.handoff({ ...f.request, gitPreparationId: "stale" }),
		).rejects.toThrow("review");
		expect(f.apply).not.toHaveBeenCalled();
	});
});
