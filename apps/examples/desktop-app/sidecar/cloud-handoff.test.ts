import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { summarizeConversation } from "@cline/core";
import { loadCloudModels } from "@cline/core/cloud";
import { DEFAULT_MAX_IMAGE_DECODED_BYTES } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleChatSessionCommand } from "./chat-session";
import {
	handleHandoff,
	handlePrepareHandoff,
	handlePrepareHandoffGit,
} from "./cloud-handoff";
import * as followUpStorage from "./cloud-handoff-follow-up";
import { readCloudHandoffFollowUp } from "./cloud-handoff-follow-up";
import * as gitPreparation from "./cloud-handoff-git";
import {
	CloudCreationUnconfirmedError,
	type CloudSessionApi,
	CloudSessionManager,
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
vi.mock("@cline/core/cloud", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@cline/core/cloud")>();
	return { ...actual, loadCloudModels: vi.fn() };
});

const image =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jT1sAAAAASUVORK5CYII=";
let dataDir: string;
beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "cloud-summary-test-"));
	vi.stubEnv("CLINE_DATA_DIR", dataDir);
	enableCloudHandoffGates();
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	cleanupCloudHandoffGates();
	rmSync(dataDir, { recursive: true, force: true });
});

function fixture() {
	const sourceSessionId = "local-source";
	const modelId = "test-model";
	const git = {
		repoUrl: "https://github.com/example/project",
		branch: "cline/handoff-test",
		headSha: "a".repeat(40),
		workspaceRelativePath: "packages/app",
	};
	vi.mocked(loadCloudModels).mockResolvedValue([
		{ id: modelId, catalogId: "cline-cloud", name: "Test" },
	]);
	const plan: gitPreparation.HandoffGitPlan = {
		id: "plan",
		root: "/workspace/project",
		cwd: "/workspace/project/packages/app",
		...git,
		pushUrl: git.repoUrl,
		remote: "origin",
		sourceBranch: "main",
		treeSha: "b".repeat(40),
		indexTree: "b".repeat(40),
		status: "",
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
		cwd: plan.cwd,
		provider: "cline",
		model: modelId,
		mode: "plan",
		autoApproveTools: false,
	};
	const update = vi.fn();
	const readLiveMessages = vi.fn().mockResolvedValue(messages);
	const pending = vi.fn().mockResolvedValue([]);
	const ctx = Object.assign(
		createSidecarContext(plan.cwd),
		localRuntimeContext(
			{
				get: vi.fn().mockResolvedValue({
					sessionId: sourceSessionId,
					status: "idle",
					cwd: plan.cwd,
					provider: "cline",
					model: modelId,
					metadata: {
						handoff: { status: "complete", toCloudSessionId: "old-task" },
					},
				}),
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
	const cloud = new CloudSessionManager(ctx, {
		api: {} as CloudSessionApi,
		apiBaseUrl: "https://api.example",
		getAuthToken: async () => "synthetic",
	});
	vi.spyOn(cloud, "prepareHandoffRepository").mockResolvedValue({});
	const create = vi.spyOn(cloud, "create").mockResolvedValue({
		sessionId: "ses-target",
		status: "idle",
		origin: "cloud",
		executionTarget: "cloud",
		provider: "cline",
		model: modelId,
		repoUrl: git.repoUrl,
		branch: git.branch,
		cwd: "/workspace/packages/app",
		workspaceRoot: "/workspace",
	});
	const send = vi.spyOn(cloud, "send").mockImplementation(async (...args) => {
		args[5]?.beforeDispatch?.();
		return { sessionId: "ses-target", ok: true };
	});
	ctx.cloudSessionManager = cloud;
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
	const prepare = async () => {
		const preview = await handlePrepareHandoff(ctx, {
			...request,
			action: "prepare_handoff",
		});
		expect(preview.gitPreparation.id).toBe(plan.id);
		return await handlePrepareHandoffGit(
			ctx,
			{ ...request, action: "prepare_handoff_git" },
			summarize,
		);
	};
	return {
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
		readLiveMessages,
		prepare,
	};
}

describe("summary cloud handoff", () => {
	it.each([
		"preview",
		"summary",
		"publication",
		"verification",
		"model",
	] as const)("rejects an account reset during %s before further publication or creation", async (stage) => {
		const f = fixture();
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
		const publish = () =>
			handlePrepareHandoffGit(f.ctx, f.request, f.summarize);
		if (["preview", "summary", "publication"].includes(stage)) {
			await expect(publish()).rejects.toThrow("account changed");
			if (stage !== "publication") expect(f.apply).not.toHaveBeenCalled();
		} else {
			await publish();
			if (stage === "verification")
				f.verifyPublished.mockImplementation(async () => {
					await resetCloudSessionManager(f.ctx);
				});
			else
				vi.mocked(loadCloudModels).mockImplementation(async () => {
					await resetCloudSessionManager(f.ctx);
					return [{ id: "test-model", catalogId: "cline-cloud", name: "Test" }];
				});
			await expect(handleHandoff(f.ctx, f.request)).rejects.toThrow(
				"account changed",
			);
		}
		expect(f.ctx.cloudSessionManager).toBeNull();
		expect(f.create).not.toHaveBeenCalled();
		expect(f.send).not.toHaveBeenCalled();
	});
	it("uses the captured conversation and configuration while the source continues locally", async () => {
		const f = fixture();
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
		await handleHandoff(f.ctx, f.request);
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

	it("rejects a second preview while the first snapshot is being prepared", async () => {
		const f = fixture();
		const first = handlePrepareHandoff(f.ctx, f.request);
		await expect(handlePrepareHandoff(f.ctx, f.request)).rejects.toThrow(
			"already in progress",
		);
		await first;
		expect(f.readLiveMessages).toHaveBeenCalledTimes(1);
		expect(gitPreparation.inspectHandoffGit).toHaveBeenCalledTimes(1);
	});

	it("publishes a dedicated branch, sends one combined prompt with invocation images, and leaves source history alone", async () => {
		const f = fixture();
		const seen: unknown[] = [];
		const preparationProgress: unknown[] = [];
		f.ctx.wsClients.add({
			data: { canApproveTools: true },
			send: (raw: string) => {
				const event = JSON.parse(raw).event;
				if (
					event?.name === "cloud_handoff_progress" &&
					["summarizing", "checking"].includes(event.payload.phase)
				)
					preparationProgress.push(event.payload);
				if (
					event?.name === "cloud_handoff_progress" &&
					event.payload.phase === "sending"
				)
					seen.push(readCloudHandoffFollowUp("ses-target"));
			},
		} as unknown as SidecarWebSocketClient);
		const prepared = await f.prepare();
		expect(prepared).toMatchObject({
			gitPreparationId: "plan",
			branch: f.git.branch,
		});
		expect(preparationProgress).toEqual([
			expect.objectContaining({
				handoffAttemptId: "attempt-1",
				phase: "summarizing",
			}),
			expect.objectContaining({
				handoffAttemptId: "attempt-1",
				phase: "checking",
			}),
		]);
		const result = await handleHandoff(f.ctx, {
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
		expect(preparationProgress).toHaveLength(2);
		expect(f.create).toHaveBeenCalledWith(
			expect.objectContaining({
				repoUrl: f.git.repoUrl,
				branch: f.git.branch,
				mode: "plan",
				workspaceRelativePath: "packages/app",
			}),
		);
		expect(f.create.mock.calls[0]?.[0]).not.toHaveProperty("handoff");
		const prompt =
			"Search form: implemented. Next: add tests.\n\nNext instruction from the user:\nTest keyboard navigation.";
		expect(f.send).toHaveBeenCalledWith(
			"ses-target",
			prompt,
			undefined,
			"test-model",
			[image],
			expect.any(Object),
		);
		expect(seen).toEqual([
			expect.objectContaining({
				command: prompt,
				userImages: [image],
				unconfirmed: true,
			}),
		]);
		expect(readCloudHandoffFollowUp("ses-target")).toBeNull();
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
		const f = fixture();
		await f.prepare();
		await handleHandoff(f.ctx, {
			...f.request,
			attachments: { userImages: [image] },
		});
		expect(f.send.mock.calls[0]?.[1]).toContain(
			"If no next action is clear, ask",
		);
		expect(f.send.mock.calls[0]?.[4]).toEqual([image]);
		await f.prepare();
		await handleHandoff(f.ctx, { ...f.request, handoffAttemptId: "attempt-2" });
		expect(f.create.mock.calls.map(([input]) => input.requestId)).toEqual([
			"attempt-1",
			"attempt-2",
		]);
	});

	it("uses the selected local connection to summarize through the command handler", async () => {
		const f = fixture();
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
		await handleChatSessionCommand(f.ctx, {
			...f.request,
			action: "prepare_handoff_git",
		});
		await handleChatSessionCommand(f.ctx, f.request);
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
		"queued",
	] as const)("rejects a %s source before Git preparation", async (state) => {
		const f = fixture();
		if (state === "busy") {
			const source = f.ctx.liveSessions.get(f.sourceSessionId);
			if (!source) throw new Error("Source fixture is missing");
			source.busy = true;
		} else f.pending.mockResolvedValue([{ id: "queued" }]);
		await expect(handlePrepareHandoff(f.ctx, f.request)).rejects.toThrow(
			state === "busy" ? "current run" : "queued prompts",
		);
		expect(f.apply).not.toHaveBeenCalled();
		expect(f.create).not.toHaveBeenCalled();
	});

	it.each([
		"failure",
		"empty",
		"empty context",
	] as const)("does not publish Git or create a cloud task after summary %s", async (failure) => {
		const f = fixture();
		if (failure === "failure")
			f.summarize.mockRejectedValue(new Error("Summary failed"));
		if (failure === "empty") f.summarize.mockResolvedValue(" ");
		if (failure === "empty context") f.readLiveMessages.mockResolvedValue([]);
		await expect(f.prepare()).rejects.toThrow();
		expect(f.apply).not.toHaveBeenCalled();
		expect(f.create).not.toHaveBeenCalled();
		expect(f.update).not.toHaveBeenCalled();
	});

	it.each([
		"git",
		"model",
	] as const)("rejects published %s becoming unavailable before handoff", async (changed) => {
		const f = fixture();
		await f.prepare();
		if (changed === "git")
			f.verifyPublished.mockRejectedValue(
				new Error("Published branch changed"),
			);
		else
			vi.mocked(loadCloudModels).mockResolvedValue([
				{ id: "other-model", catalogId: "cline-cloud", name: "Other" },
			]);
		await expect(
			handleHandoff(f.ctx, {
				...f.request,
				...(changed === "model"
					? { config: { ...f.request.config, model: "other-model" } }
					: {}),
			}),
		).rejects.toThrow(changed === "git" ? "changed" : "not available");
		expect(f.summarize).toHaveBeenCalledTimes(1);
		expect(f.create).not.toHaveBeenCalled();
		expect(f.update).not.toHaveBeenCalled();
	});

	it.each([
		false,
		true,
	])("retains full draft after send failure (dispatched: %s)", async (dispatched) => {
		const f = fixture();
		await f.prepare();
		f.send.mockImplementation(async (...args) => {
			if (dispatched) args[5]?.beforeDispatch?.();
			throw new Error("Connection failed");
		});
		const result = await handleHandoff(f.ctx, {
			...f.request,
			nextCommand: "Add tests",
			attachments: { userImages: [image] },
		});
		const saved = readCloudHandoffFollowUp("ses-target");
		expect(saved).toMatchObject({
			command: expect.stringContaining(
				"Next instruction from the user:\nAdd tests",
			),
			userImages: [image],
		});
		expect(Boolean(saved?.unconfirmed)).toBe(dispatched);
		expect(result).toMatchObject({
			sessionId: "ses-target",
			warningKind: dispatched ? "unconfirmed" : "unqueued",
		});
		if (dispatched) expect(result).not.toHaveProperty("undeliveredCommand");
		else expect(result).toHaveProperty("undeliveredCommand", saved?.command);
	});

	it("does not automatically retry unconfirmed creation", async () => {
		const f = fixture();
		await f.prepare();
		f.create.mockRejectedValue(
			new CloudCreationUnconfirmedError(new Error("Connection lost")),
		);
		await expect(handleHandoff(f.ctx, f.request)).rejects.toThrow("ambiguous");
		expect(f.create).toHaveBeenCalledTimes(1);
		expect(f.send).not.toHaveBeenCalled();
		expect(f.update).not.toHaveBeenCalled();
	});

	it("does not dispatch if saving the prepared prompt fails", async () => {
		const f = fixture();
		await f.prepare();
		vi.spyOn(followUpStorage, "saveCloudHandoffFollowUp").mockImplementation(
			() => {
				throw new Error("Disk full");
			},
		);
		await expect(handleHandoff(f.ctx, f.request)).rejects.toThrow(
			"Nothing was sent",
		);
		expect(f.create).toHaveBeenCalledTimes(1);
		expect(f.send).not.toHaveBeenCalled();
		expect(f.update).not.toHaveBeenCalled();
	});

	it.each([
		"count",
		"bytes",
	] as const)("validates image %s limits before creating or sending", async (limit) => {
		const f = fixture();
		await f.prepare();
		const images =
			limit === "count"
				? Array(6).fill(image)
				: [
						`data:image/png;base64,${Buffer.alloc(DEFAULT_MAX_IMAGE_DECODED_BYTES + 1).toString("base64")}`,
					];
		await expect(
			handleHandoff(f.ctx, {
				...f.request,
				attachments: { userImages: images },
			}),
		).rejects.toThrow();
		expect(f.summarize).toHaveBeenCalledTimes(1);
		expect(f.create).not.toHaveBeenCalled();
	});

	it("rejects an unapproved Git preparation", async () => {
		const f = fixture();
		await handlePrepareHandoff(f.ctx, f.request);
		await expect(
			handlePrepareHandoffGit(
				f.ctx,
				{ ...f.request, gitPreparationId: "stale" },
				f.summarize,
			),
		).rejects.toThrow("review");
		expect(f.apply).not.toHaveBeenCalled();
	});
});
