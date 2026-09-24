import {
	CloudHandoffTranscriptMismatchError,
	preflightCloudHandoffGit,
	readCloudHandoffMetadata,
} from "@cline/core";
import { HubCommandError } from "@cline/core/hub";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleChatSessionCommand } from "./chat-session";
import {
	assertPendingCloudHandoffCompatible,
	cloudHandoffGitStateMatchesFingerprint,
	formatPendingHandoffVerificationError,
	shouldCleanupFailedHandoffVerification,
	updateHandoffMetadataOrThrow,
} from "./cloud-handoff";
import {
	CloudHandoffSeedUnsupportedError,
	CloudQueueUnconfirmedError,
	type CloudSessionApi,
	CloudSessionError,
	CloudSessionManager,
} from "./cloud-sessions";
import {
	cleanupCloudHandoffGates,
	enableCloudHandoffGates,
	localRuntimeContext,
	localSessionManager,
} from "./session-test-helpers";
import type { SidecarContext } from "./types";

// Git preflight shells out to `git` and requires a pushed github.com branch;
// the full-transaction test below swaps in a deterministic repository state.
vi.mock("@cline/core", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@cline/core")>();
	return {
		...actual,
		preflightCloudHandoffGit: vi.fn(actual.preflightCloudHandoffGit),
	};
});

afterEach(cleanupCloudHandoffGates);

describe("cloud handoff gates", () => {
	beforeEach(() => {
		enableCloudHandoffGates();
	});

	it("blocks handoff actions when Cloud sessions are unavailable", async () => {
		const { ctx, sessionId } = createHandoffGateContext({ busy: false });

		process.env.CLINE_CODE_CLOUD_AGENTS = "0";
		await expect(
			handleChatSessionCommand(ctx, {
				action: "prepare_handoff",
				sessionId,
			}),
		).rejects.toThrow("Enable Cloud sessions in Settings before using /cloud.");
		await expect(
			handleChatSessionCommand(ctx, {
				action: "handoff",
				sessionId,
				fingerprint: {
					repoUrl: "https://github.com/cline/cline.git",
					branch: "main",
					headSha: "abc123",
					modelId: "anthropic/claude-sonnet-4.6",
				},
			}),
		).rejects.toThrow("Enable Cloud sessions in Settings before using /cloud.");
		expect(ctx.cloudSessionManager).toBeFalsy();
	});

	it("exempts a persisted pending handoff from the Cloud sessions gate", async () => {
		process.env.CLINE_CODE_CLOUD_AGENTS = "0";
		// An empty transcript makes the recovery attempt fail deterministically
		// at a later gate, proving the flag gate itself let it through.
		const { ctx, sessionId } = createHandoffGateContext({
			messages: [],
			metadata: {
				handoff: {
					status: "pending",
					toCloudSessionId: "ses-pending-target",
					handedOffAt: "2026-08-18T00:00:00.000Z",
				},
			},
		});

		const recovery = handleChatSessionCommand(ctx, {
			action: "handoff",
			sessionId,
			fingerprint: {
				repoUrl: "https://github.com/cline/cline.git",
				branch: "main",
				headSha: "abc123",
				modelId: "anthropic/claude-sonnet-4.6",
			},
		});

		await expect(recovery).rejects.toThrow(
			"Start a conversation before handing it off to cloud.",
		);
	});

	it("keeps the Cloud sessions gate for sessions without a pending handoff", async () => {
		process.env.CLINE_CODE_CLOUD_AGENTS = "0";
		const { ctx, sessionId } = createHandoffGateContext({
			messages: [],
			metadata: { workspace: "preserved" },
		});

		await expect(
			handleChatSessionCommand(ctx, {
				action: "handoff",
				sessionId,
				fingerprint: {
					repoUrl: "https://github.com/cline/cline.git",
					branch: "main",
					headSha: "abc123",
					modelId: "anthropic/claude-sonnet-4.6",
				},
			}),
		).rejects.toThrow("Enable Cloud sessions in Settings before using /cloud.");
	});

	it("lets new handoffs proceed when Cloud sessions are enabled", async () => {
		// An empty transcript makes the attempt fail deterministically at a
		// later gate, proving the flag+opt-in gate itself let it through.
		const { ctx, sessionId } = createHandoffGateContext({ messages: [] });

		const attempt = handleChatSessionCommand(ctx, {
			action: "handoff",
			sessionId,
			fingerprint: {
				repoUrl: "https://github.com/cline/cline.git",
				branch: "main",
				headSha: "abc123",
				modelId: "anthropic/claude-sonnet-4.6",
			},
		});

		await expect(attempt).rejects.toThrow(
			"Start a conversation before handing it off to cloud.",
		);
	});

	it("explains how to recover a mismatched resumed handoff", () => {
		const dashboardUrl = "https://app.cline.bot/agents?sessionId=ses-pending";
		const message = formatPendingHandoffVerificationError(
			new CloudHandoffTranscriptMismatchError(2, 3),
			dashboardUrl,
		);

		expect(message).toContain("delete it before retrying /cloud");
		expect(message).toContain(dashboardUrl);
	});

	it("detects repository drift after cloud provisioning", () => {
		const fingerprint = {
			repoUrl: "https://github.com/cline/cline",
			branch: "main",
			headSha: "A".repeat(40),
			modelId: "anthropic/claude-sonnet-4.6",
			workspaceRelativePath: "apps/examples/desktop-app",
		};

		expect(
			cloudHandoffGitStateMatchesFingerprint(
				{
					repoUrl: fingerprint.repoUrl,
					branch: fingerprint.branch,
					headSha: fingerprint.headSha.toLowerCase(),
					workspaceRelativePath: fingerprint.workspaceRelativePath,
				},
				fingerprint,
			),
		).toBe(true);
		expect(
			cloudHandoffGitStateMatchesFingerprint(
				{
					repoUrl: fingerprint.repoUrl,
					branch: fingerprint.branch,
					headSha: "B".repeat(40),
					workspaceRelativePath: fingerprint.workspaceRelativePath,
				},
				fingerprint,
			),
		).toBe(false);
	});

	it("cleans up an old runtime that ignored the seeded transcript", () => {
		expect(
			shouldCleanupFailedHandoffVerification(
				new CloudHandoffSeedUnsupportedError(),
			),
		).toBe(true);
		expect(
			shouldCleanupFailedHandoffVerification(
				new CloudHandoffSeedUnsupportedError(),
				false,
			),
		).toBe(true);
		expect(
			shouldCleanupFailedHandoffVerification(
				new CloudHandoffTranscriptMismatchError(1, 2),
				false,
			),
		).toBe(false);
		expect(
			shouldCleanupFailedHandoffVerification(
				new CloudSessionError("request_failed", "temporary read failure"),
			),
		).toBe(false);
	});

	const pendingFingerprint = {
		repoUrl: "https://github.com/cline/cline.git",
		branch: "main",
		headSha: "old-head",
		modelId: "anthropic/claude-sonnet-4.6",
	};
	const pendingMetadata = {
		workspace: "preserved",
		handoff: {
			status: "pending" as const,
			toCloudSessionId: "ses-old-target",
			handedOffAt: "2026-08-18T00:00:00.000Z",
			dashboardUrl: "https://app.cline.bot/agents?sessionId=ses-old-target",
			fingerprint: pendingFingerprint,
		},
	};
	const changedFingerprint = { ...pendingFingerprint, headSha: "new-head" };

	it("does not build a recovery URL for a fresh handoff", async () => {
		const handoffTargetExists = vi.fn();
		await expect(
			assertPendingCloudHandoffCompatible(
				{ handoffTargetExists },
				{
					fingerprint: changedFingerprint,
					appBaseUrl: "not a valid URL",
				},
			),
		).resolves.toBeUndefined();
		expect(handoffTargetExists).not.toHaveBeenCalled();
	});

	it("preserves a mismatched pending handoff while its target exists", async () => {
		await expect(
			assertPendingCloudHandoffCompatible(
				{ handoffTargetExists: vi.fn(async () => true) },
				{
					pending: pendingMetadata.handoff,
					fingerprint: changedFingerprint,
					appBaseUrl: "https://app.cline.bot",
				},
			),
		).rejects.toThrow("still pending for a different");
	});

	it("preserves a mismatched pending handoff when it is invisible to the current account", async () => {
		await expect(
			assertPendingCloudHandoffCompatible(
				{ handoffTargetExists: vi.fn(async () => false) },
				{
					pending: pendingMetadata.handoff,
					fingerprint: changedFingerprint,
					appBaseUrl: "https://app.cline.bot",
				},
			),
		).rejects.toThrow("not visible from the current account");
	});

	it("preserves pending lineage when target lookup is uncertain", async () => {
		await expect(
			assertPendingCloudHandoffCompatible(
				{
					handoffTargetExists: vi.fn(async () => {
						throw new Error("network unavailable");
					}),
				},
				{
					pending: pendingMetadata.handoff,
					fingerprint: changedFingerprint,
					appBaseUrl: "https://app.cline.bot",
				},
			),
		).rejects.toThrow("network unavailable");
	});

	it("fails when a required handoff metadata update is not persisted", async () => {
		const update = vi.fn(async () => ({ updated: false }));
		await expect(
			updateHandoffMetadataOrThrow(
				{ update } as never,
				"local-1",
				{ handoff: { status: "pending" } },
				"recovery record was not saved",
			),
		).rejects.toThrow("recovery record was not saved");
	});

	function createHandoffGateContext(options: {
		busy?: boolean;
		persistedStatus?: string;
		messages?: Array<{ role: "user" | "assistant"; content: string }>;
		metadata?: Record<string, unknown>;
	}) {
		const sessionId = "local-handoff-source";
		const send = vi.fn();
		const messages = options.messages ?? [
			{ role: "user" as const, content: "continue this work" },
		];
		const persistedSession = {
			sessionId,
			status:
				options.persistedStatus ?? (options.busy ? "running" : "completed"),
			cwd: "/workspace/project",
			model: "anthropic/claude-sonnet-4.6",
			metadata: options.metadata,
		};
		const get = vi.fn(async () => persistedSession);
		const readLiveMessages = vi.fn(async () => messages);
		const ctx = {
			workspaceRoot: "/workspace/project",
			liveSessions: new Map([
				[
					sessionId,
					{
						config: {
							cwd: "/workspace/project",
							provider: "cline",
							model: "anthropic/claude-sonnet-4.6",
						},
						messages,
						promptsInQueue: [],
						busy: options.busy ?? false,
						startedAt: Date.now(),
						status: options.busy ? "running" : "idle",
					},
				],
			]),
			restoringWorkspacePaths: new Set(),
			streamIndices: new Map(),
			wsClients: new Set(),
			...localRuntimeContext(
				{
					get,
					readLiveMessages,
					send,
					pendingPrompts: { list: vi.fn(async () => []) },
				},
				{ sessionIds: [sessionId] },
			),
		} as unknown as SidecarContext;
		return {
			ctx,
			get,
			persistedSession,
			readLiveMessages,
			send,
			sessionId,
		};
	}

	it("rejects a busy source before provisioning", async () => {
		const { ctx, sessionId } = createHandoffGateContext({ busy: true });
		await expect(
			handleChatSessionCommand(ctx, {
				action: "prepare_handoff",
				sessionId,
			}),
		).rejects.toThrow("Stop the current run");
		expect(ctx.cloudSessionManager).toBeFalsy();
	});

	it("rejects handoff while a send is still entering the queue", async () => {
		const { ctx, get, persistedSession, readLiveMessages, sessionId } =
			createHandoffGateContext({ busy: false });
		let releaseGet: ((value: typeof persistedSession) => void) | undefined;
		get.mockImplementationOnce(
			async () =>
				await new Promise<typeof persistedSession>((resolve) => {
					releaseGet = resolve;
				}),
		);

		const sending = handleChatSessionCommand(ctx, {
			action: "send",
			sessionId,
			prompt: "queue this before handoff",
			delivery: "queue",
			config: { environmentId: "local" },
		});
		await vi.waitFor(() => expect(get).toHaveBeenCalledOnce());

		await expect(
			handleChatSessionCommand(ctx, {
				action: "prepare_handoff",
				sessionId,
				config: { environmentId: "local" },
			}),
		).rejects.toThrow("Wait for the current send to finish before handing off");
		expect(readLiveMessages).not.toHaveBeenCalled();

		releaseGet?.(persistedSession);
		await sending;
	});

	it.each([
		true,
		false,
	])("rejects handoff while the source workspace is being restored (live=%s)", async (hasLiveSession) => {
		const { ctx, readLiveMessages, sessionId } = createHandoffGateContext({
			busy: false,
		});
		if (!hasLiveSession) ctx.liveSessions.clear();
		ctx.restoringWorkspacePaths.add("/workspace/project");

		await expect(
			handleChatSessionCommand(ctx, {
				action: "prepare_handoff",
				sessionId,
			}),
		).rejects.toThrow("Wait for the workspace restore to finish");
		expect(readLiveMessages).not.toHaveBeenCalled();
	});

	it("does not begin a restore after handoff starts during its initial read", async () => {
		const { ctx, get, persistedSession, sessionId } = createHandoffGateContext({
			busy: false,
		});
		let releaseRestoreRead:
			| ((value: typeof persistedSession) => void)
			| undefined;
		let releaseHandoffGate:
			| ((value: typeof persistedSession) => void)
			| undefined;
		get
			.mockImplementationOnce(
				async () =>
					await new Promise<typeof persistedSession>((resolve) => {
						releaseRestoreRead = resolve;
					}),
			)
			.mockImplementationOnce(
				async () =>
					await new Promise<typeof persistedSession>((resolve) => {
						releaseHandoffGate = resolve;
					}),
			);
		const restore = vi.fn();
		(localSessionManager(ctx) as { restore?: typeof restore }).restore =
			restore;

		const restoring = handleChatSessionCommand(ctx, {
			action: "restore_checkpoint",
			sessionId,
			checkpointRunCount: 1,
			config: { cwd: "/workspace/project", environmentId: "local" },
		});
		await vi.waitFor(() => expect(get).toHaveBeenCalledOnce());
		const handingOff = handleChatSessionCommand(ctx, {
			action: "handoff",
			sessionId,
			config: { environmentId: "local" },
			fingerprint: {
				repoUrl: "https://github.com/cline/test",
				branch: "main",
				headSha: "abc123",
				modelId: "anthropic/claude-sonnet-4.6",
			},
		});
		await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));

		releaseRestoreRead?.(persistedSession);
		await expect(restoring).rejects.toThrow(
			"Wait for the cloud handoff to finish before restoring a checkpoint",
		);
		expect(restore).not.toHaveBeenCalled();

		releaseHandoffGate?.(persistedSession);
		await expect(handingOff).rejects.toThrow();
	});

	it("trusts an authoritative idle live session over a legacy running record", async () => {
		const { ctx, sessionId } = createHandoffGateContext({
			busy: false,
			persistedStatus: "running",
		});

		await expect(
			handleChatSessionCommand(ctx, {
				action: "prepare_handoff",
				sessionId,
			}),
		).rejects.not.toThrow("Stop the current run");
	});

	it("rejects an empty source before provisioning", async () => {
		const { ctx, sessionId } = createHandoffGateContext({ messages: [] });
		await expect(
			handleChatSessionCommand(ctx, {
				action: "prepare_handoff",
				sessionId,
			}),
		).rejects.toThrow("Start a conversation");
		expect(ctx.cloudSessionManager).toBeFalsy();
	});

	it("rejects normal sends after ownership moved to cloud", async () => {
		const { ctx, send, sessionId } = createHandoffGateContext({
			metadata: {
				handoff: {
					toCloudSessionId: "ses-cloud-target",
					handedOffAt: "2026-08-18T00:00:00.000Z",
					status: "complete",
					dashboardUrl:
						"https://app.cline.bot/agents?sessionId=ses-cloud-target",
				},
			},
		});
		await expect(
			handleChatSessionCommand(ctx, {
				action: "send",
				sessionId,
				prompt: "keep editing locally",
			}),
		).rejects.toThrow("Fork locally");
		expect(send).not.toHaveBeenCalled();
	});
});

describe("cloud handoff transaction", () => {
	beforeEach(() => {
		enableCloudHandoffGates();
	});

	afterEach(() => {
		vi.mocked(preflightCloudHandoffGit).mockRestore();
		vi.unstubAllGlobals();
	});

	function createHandoffFixture(
		created = true,
		metadata: Record<string, unknown> = {},
	) {
		const sourceSessionId = "local-handoff-source";
		const modelId = "anthropic/claude-sonnet-4.6";
		const headSha = "a".repeat(40);
		vi.mocked(preflightCloudHandoffGit).mockResolvedValue({
			repoUrl: "https://github.com/cline/test",
			branch: "main",
			headSha,
		});
		// The model catalog is the only network dependency left on this path.
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: unknown) =>
				String(input).endsWith("/api/v1/ai/cline/models")
					? new Response(
							JSON.stringify({ data: [{ id: modelId, name: "Sonnet" }] }),
							{ status: 200, headers: { "content-type": "application/json" } },
						)
					: new Response(JSON.stringify({}), { status: 200 }),
			),
		);

		const messages = [
			{ role: "user" as const, content: "continue this work" },
			{ role: "assistant" as const, content: "done locally" },
		];
		const order: string[] = [];
		const events: Array<{ name: string; payload: Record<string, unknown> }> =
			[];
		const metadataUpdates: Array<Record<string, unknown>> = [];
		let persistedMetadata = metadata;
		const ctx = {
			liveSessions: new Map([
				[
					sourceSessionId,
					{
						config: {
							cwd: "/workspace/project",
							provider: "cline",
							model: modelId,
							autoApproveTools: false,
							thinking: false,
						},
						messages,
						promptsInQueue: [],
						busy: false,
						startedAt: Date.now(),
						status: "idle",
					},
				],
			]),
			restoringWorkspacePaths: new Set(),
			streamIndices: new Map(),
			pendingApprovals: new Map(),
			pendingQuestions: new Map(),
			wsClients: new Set([
				{
					data: { canApproveTools: true },
					send(message: string) {
						const parsed = JSON.parse(message) as {
							event: { name: string; payload: Record<string, unknown> };
						};
						events.push(parsed.event);
						if (parsed.event.name === "cloud_handoff_progress") {
							order.push(`event:${parsed.event.payload.phase}`);
						}
					},
				},
			]),
			...localRuntimeContext(
				{
					get: vi.fn(async () => ({
						sessionId: sourceSessionId,
						status: "completed",
						cwd: "/workspace/project",
						model: modelId,
						metadata: persistedMetadata,
					})),
					readLiveMessages: vi.fn(async () => messages),
					update: vi.fn(
						async (
							_id: string,
							input: { metadata: Record<string, unknown> },
						) => {
							persistedMetadata = input.metadata;
							metadataUpdates.push(input.metadata);
							order.push(
								`metadata:${readCloudHandoffMetadata(input.metadata)?.status}`,
							);
							return { updated: true };
						},
					),
					pendingPrompts: { list: vi.fn(async () => []) },
				},
				{ sessionIds: [sourceSessionId] },
			),
		} as unknown as SidecarContext;

		const verifyHandoffTranscript = vi.fn(async () => undefined);
		const cloudSend = vi.fn(async () => ({
			sessionId: "ses-cloud",
			ok: true as const,
			queued: true,
		}));
		const create = vi.fn(
			async (input: {
				handoff?: {
					onOuterSessionCreated?: (
						id: string,
						info: { created: boolean },
					) => Promise<void>;
					resolveMessages: () => Promise<unknown>;
					onSeeding?: () => void | Promise<void>;
				};
			}) => {
				await input.handoff?.onOuterSessionCreated?.("ses-cloud", { created });
				await input.handoff?.resolveMessages();
				await input.handoff?.onSeeding?.();
				return { sessionId: "ses-cloud", innerSessionId: "inner-cloud" };
			},
		);
		const cloud = new CloudSessionManager(ctx, {
			api: {} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
		});
		Object.assign(cloud, {
			prepareHandoffRepository: vi.fn(async () => ({})),
			create,
			verifyHandoffTranscript,
			send: cloudSend,
		});
		ctx.cloudSessionManager = cloud;

		return {
			ctx,
			sourceSessionId,
			modelId,
			cloud,
			headSha,
			messages,
			order,
			events,
			metadataUpdates,
			getPersistedMetadata: () => persistedMetadata,
			verifyHandoffTranscript,
			cloudSend,
			create,
		};
	}

	it("rejects an unavailable source model before recording or provisioning a handoff", async () => {
		const fixture = createHandoffFixture();
		fixture.ctx.liveSessions.get(fixture.sourceSessionId)!.config.model =
			"unavailable-model";
		await expect(
			handleChatSessionCommand(fixture.ctx, {
				action: "prepare_handoff",
				sessionId: fixture.sourceSessionId,
			}),
		).rejects.toThrow("selected model unavailable-model is not available");
		expect(fixture.create).not.toHaveBeenCalled();
		expect(fixture.metadataUpdates).toEqual([]);
	});

	it("rejects a source model changed after preflight instead of reusing the pinned model", async () => {
		const fixture = createHandoffFixture();
		fixture.ctx.liveSessions.get(fixture.sourceSessionId)!.config.model =
			"changed-model";
		await expect(
			handleChatSessionCommand(fixture.ctx, {
				action: "handoff",
				sessionId: fixture.sourceSessionId,
				fingerprint: {
					repoUrl: "https://github.com/cline/test",
					branch: "main",
					headSha: fixture.headSha,
					modelId: fixture.modelId,
				},
			}),
		).rejects.toThrow("source model changed");
		expect(fixture.create).not.toHaveBeenCalled();
		expect(fixture.metadataUpdates).toEqual([]);
	});

	it.each([
		"client_authority_mismatch",
		"hub_draining",
	])("allows retries after pre-dispatch %s on both create and resume", async (code) => {
		const fixture = createHandoffFixture();
		const rejected = new HubCommandError(
			"session.create",
			code,
			"Create rejected before dispatch.",
		);
		const request = {
			action: "handoff" as const,
			sessionId: fixture.sourceSessionId,
			fingerprint: {
				repoUrl: "https://github.com/cline/test",
				branch: "main",
				headSha: fixture.headSha,
				modelId: fixture.modelId,
			},
		};
		fixture.create.mockImplementationOnce(async (input) => {
			await input.handoff?.onOuterSessionCreated?.("ses-cloud", {
				created: true,
			});
			await input.handoff?.onSeeding?.();
			throw rejected;
		});
		await expect(handleChatSessionCommand(fixture.ctx, request)).rejects.toBe(
			rejected,
		);
		expect(fixture.getPersistedMetadata()).not.toHaveProperty(
			"cloudHandoffSeedDispatched",
		);
		vi.spyOn(fixture.cloud, "waitUntilReady").mockResolvedValue(undefined);
		const seed = vi
			.spyOn(fixture.cloud, "seedHandoff")
			.mockImplementation(async (_id, input) => {
				expect(input.recoverOnly).toBe(false);
				await input.onSeeding?.();
				if (seed.mock.calls.length === 1) throw rejected;
				return { innerSessionId: "inner-cloud" };
			});
		await expect(handleChatSessionCommand(fixture.ctx, request)).rejects.toBe(
			rejected,
		);
		expect(fixture.getPersistedMetadata()).not.toHaveProperty(
			"cloudHandoffSeedDispatched",
		);
		await expect(
			handleChatSessionCommand(fixture.ctx, request),
		).resolves.toMatchObject({ innerSessionId: "inner-cloud" });
		expect(fixture.getPersistedMetadata().cloudHandoffSeedDispatched).toBe(
			true,
		);
	});

	it("does not seed when saving the dispatch marker fails", async () => {
		const fixture = createHandoffFixture();
		vi.mocked(
			localSessionManager(fixture.ctx).update as ReturnType<typeof vi.fn>,
		)
			.mockImplementationOnce(async (_id, input) => {
				fixture.metadataUpdates.push(input.metadata);
				return { updated: true };
			})
			.mockResolvedValueOnce({ updated: false });
		await expect(
			handleChatSessionCommand(fixture.ctx, {
				action: "handoff",
				sessionId: fixture.sourceSessionId,
				fingerprint: {
					repoUrl: "https://github.com/cline/test",
					branch: "main",
					headSha: fixture.headSha,
					modelId: fixture.modelId,
				},
			}),
		).rejects.toThrow("recovery state could not be saved");
		expect(
			fixture.events.some((event) => event.payload.phase === "seeding"),
		).toBe(false);
		expect(fixture.verifyHandoffTranscript).not.toHaveBeenCalled();
	});

	it.each([
		"lost reply",
		"hub_command_timeout",
		"command_failed",
		"unknown_code",
		undefined,
	])("recovers an uncertain seed after restart without another create (%s)", async (outcome) => {
		const first = createHandoffFixture();
		const request = {
			action: "handoff" as const,
			sessionId: first.sourceSessionId,
			fingerprint: {
				repoUrl: "https://github.com/cline/test",
				branch: "main",
				headSha: first.headSha,
				modelId: first.modelId,
			},
		};
		first.create.mockImplementationOnce(async (input) => {
			await input.handoff?.onOuterSessionCreated?.("ses-cloud", {
				created: true,
			});
			await input.handoff?.resolveMessages();
			await input.handoff?.onSeeding?.();
			throw outcome === "lost reply"
				? new Error("lost create reply")
				: new HubCommandError("session.create", outcome, "lost create reply");
		});
		await expect(handleChatSessionCommand(first.ctx, request)).rejects.toThrow(
			"lost create reply",
		);
		await first.cloud.dispose();

		// Only persisted metadata survives; the new controller has no in-memory fence.
		const restarted = createHandoffFixture(
			true,
			structuredClone(first.getPersistedMetadata()),
		);
		let rows: Record<string, unknown>[] = [];
		const command = vi.fn(async (name: string) => {
			if (name === "session.create")
				throw new Error("duplicate create dispatched");
			return {
				version: "v1" as const,
				ok: true as const,
				payload:
					name === "session.list"
						? { sessions: rows }
						: name === "session.messages"
							? { messages: restarted.messages }
							: name === "session.pending_prompts"
								? { prompts: [] }
								: { session: rows[0] },
			};
		});
		const cloud = new CloudSessionManager(restarted.ctx, {
			api: {
				list: async () => [
					{
						id: "ses-cloud",
						status: "ready",
						sandboxUrl: "",
						metadata: { modelId: restarted.modelId },
						repoContext: { repoUrl: "https://github.com/cline/test" },
						createdAt: "2026-01-01",
						updatedAt: "2026-01-01",
					},
				],
				waitUntilReady: async () => {},
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "token",
			createHubClient: () => ({
				command: command as never,
				connect: async () => {},
				dispose: async () => {},
				getClientId: () => "viewer",
				subscribe: () => () => {},
			}),
		});
		vi.spyOn(cloud, "prepareHandoffRepository").mockResolvedValue({});
		restarted.ctx.cloudSessionManager = cloud;
		try {
			await expect(
				handleChatSessionCommand(restarted.ctx, request),
			).rejects.toThrow("unconfirmed");
			rows = [
				{
					sessionId: "inner-cloud",
					status: "idle",
					cwd: "/workspace",
					mode: "act",
					metadata: {
						model: restarted.modelId,
						handoff: { sourceSessionId: first.sourceSessionId },
					},
				},
			];
			await expect(
				handleChatSessionCommand(restarted.ctx, request),
			).resolves.toMatchObject({ innerSessionId: "inner-cloud" });
			expect(
				command.mock.calls.some(([name]) => name === "session.create"),
			).toBe(false);
			expect(
				readCloudHandoffMetadata(restarted.getPersistedMetadata())?.status,
			).toBe("complete");
		} finally {
			await cloud.dispose();
		}
	});

	it.each([
		true,
		false,
	])("completes a handoff (new target: %s)", async (created) => {
		const {
			ctx,
			sourceSessionId,
			modelId,
			headSha,
			messages,
			order,
			events,
			metadataUpdates,
			getPersistedMetadata,
			verifyHandoffTranscript,
			cloudSend,
			create,
		} = createHandoffFixture(created);

		const running = handleChatSessionCommand(ctx, {
			action: "handoff",
			sessionId: sourceSessionId,
			handoffAttemptId: "attempt-1",
			nextCommand: "continue in cloud",
			fingerprint: {
				repoUrl: "https://github.com/cline/test",
				branch: "main",
				headSha,
				modelId,
			},
		});
		running.then(() => order.push("resolved"));
		const result = (await running) as {
			sessionId: string;
			outerSessionId: string;
			innerSessionId: string;
			dashboardUrl: string;
			destination: string;
		};

		// The pending record lands before provisioning, the completion record
		// replaces it, and the authoritative completion event fires before the
		// RPC resolves.
		expect(order).toEqual([
			"event:creating",
			"metadata:pending",
			"event:provisioning",
			"event:connecting",
			"metadata:pending",
			"event:seeding",
			"event:verifying",
			"metadata:complete",
			"event:complete",
			"resolved",
		]);
		expect(readCloudHandoffMetadata(metadataUpdates[0])).toMatchObject({
			status: "pending",
			toCloudSessionId: "ses-cloud",
			dashboardUrl: expect.stringContaining("ses-cloud"),
		});
		expect(metadataUpdates).toHaveLength(3);
		expect(metadataUpdates[1].cloudHandoffSeedDispatched).toBe(true);
		expect(readCloudHandoffMetadata(getPersistedMetadata())).toMatchObject({
			status: "complete",
			toCloudSessionId: "ses-cloud",
			innerSessionId: "inner-cloud",
			dashboardUrl: result.dashboardUrl,
		});
		expect(verifyHandoffTranscript).toHaveBeenCalledWith(
			"ses-cloud",
			messages,
			{ allowAppendedMessages: !created },
		);
		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({
				requestId: `handoff:${sourceSessionId}:${headSha}`,
				autoApproveTools: false,
				thinking: false,
			}),
		);
		expect(cloudSend).toHaveBeenCalledWith(
			"ses-cloud",
			"continue in cloud",
			"queue",
			modelId,
			undefined,
		);
		const complete = events.find(
			(event) =>
				event.name === "cloud_handoff_progress" &&
				event.payload.phase === "complete",
		);
		expect(complete?.payload).toMatchObject({
			sourceSessionId,
			handoffAttemptId: "attempt-1",
			sessionId: "ses-cloud",
			dashboardUrl: result.dashboardUrl,
			destination: "in_app",
		});
		expect(complete?.payload).not.toHaveProperty("warning");
		expect(complete?.payload).not.toHaveProperty("warningKind");
		expect(complete?.payload).not.toHaveProperty("undeliveredCommand");
		expect(result).toMatchObject({
			sessionId: "ses-cloud",
			outerSessionId: "ses-cloud",
			innerSessionId: "inner-cloud",
			destination: "in_app",
		});
		expect(result.dashboardUrl).toContain("ses-cloud");
		expect(result).not.toHaveProperty("warning");
	});

	it("uses the requested mode without writing it to source metadata", async () => {
		const fixture = createHandoffFixture();
		await handleChatSessionCommand(fixture.ctx, {
			action: "handoff",
			sessionId: fixture.sourceSessionId,
			config: { mode: "plan" },
			fingerprint: {
				repoUrl: "https://github.com/cline/test",
				branch: "main",
				headSha: fixture.headSha,
				modelId: fixture.modelId,
				mode: "plan",
			},
		});
		expect(fixture.create).toHaveBeenCalledWith(
			expect.objectContaining({ mode: "plan" }),
		);
		expect(fixture.getPersistedMetadata()).not.toHaveProperty("mode");
	});

	it.each([
		true,
		false,
	])("only deletes a newly created target on transcript mismatch (new target: %s)", async (created) => {
		const fixture = createHandoffFixture(created);
		const deleteTarget = vi
			.spyOn(fixture.cloud, "delete")
			.mockResolvedValue(undefined);
		fixture.verifyHandoffTranscript.mockRejectedValue(
			new CloudHandoffTranscriptMismatchError(2, 3),
		);

		await expect(
			handleChatSessionCommand(fixture.ctx, {
				action: "handoff",
				sessionId: fixture.sourceSessionId,
				handoffAttemptId: "attempt-1",
				nextCommand: "continue in cloud",
				fingerprint: {
					repoUrl: "https://github.com/cline/test",
					branch: "main",
					headSha: fixture.headSha,
					modelId: fixture.modelId,
				},
			}),
		).rejects.toThrow();

		if (created) {
			expect(deleteTarget).toHaveBeenCalledExactlyOnceWith("ses-cloud");
			expect(
				readCloudHandoffMetadata(fixture.getPersistedMetadata()),
			).toBeUndefined();
		} else {
			expect(deleteTarget).not.toHaveBeenCalled();
			expect(
				readCloudHandoffMetadata(fixture.getPersistedMetadata()),
			).toMatchObject({ status: "pending", toCloudSessionId: "ses-cloud" });
		}
		expect(fixture.cloudSend).not.toHaveBeenCalled();
	});

	async function runHandoffWithFailingFollowUp(sendError: Error): Promise<{
		cloudSend: ReturnType<typeof vi.fn>;
		result: { sessionId: string; warning?: string; warningKind?: string };
		completeEvent: Record<string, unknown> | undefined;
	}> {
		const { ctx, sourceSessionId, modelId, headSha, events, cloudSend } =
			createHandoffFixture();
		cloudSend.mockRejectedValueOnce(sendError);

		const result = (await handleChatSessionCommand(ctx, {
			action: "handoff",
			sessionId: sourceSessionId,
			nextCommand: "continue in cloud",
			fingerprint: {
				repoUrl: "https://github.com/cline/test",
				branch: "main",
				headSha,
				modelId,
			},
		})) as { sessionId: string; warning?: string; warningKind?: string };
		const completeEvent = events.find(
			(event) =>
				event.name === "cloud_handoff_progress" &&
				event.payload.phase === "complete",
		)?.payload;
		return { cloudSend, result, completeEvent };
	}

	it("flags an unconfirmed follow-up queue outcome without claiming it was unqueued", async () => {
		const { cloudSend, result, completeEvent } =
			await runHandoffWithFailingFollowUp(new CloudQueueUnconfirmedError());

		expect(cloudSend).toHaveBeenCalledOnce();
		expect(result.sessionId).toBe("ses-cloud");
		expect(result.warningKind).toBe("unconfirmed");
		expect(result.warning).toContain(
			"could not confirm whether the follow-up command was queued",
		);
		// An unconfirmed outcome must never invite a resend of a prompt that
		// may already be durably queued.
		expect(result.warning).not.toContain("was not queued");
		// The completion event is the authoritative signal when the RPC response
		// is lost, so it must carry the same warning...
		expect(completeEvent).toMatchObject({
			warningKind: "unconfirmed",
			warning: expect.stringContaining(
				"could not confirm whether the follow-up command was queued",
			),
		});
		// ...but never prefill an unconfirmed command for resending.
		expect(completeEvent).not.toHaveProperty("undeliveredCommand");
	});

	it("flags a definitively unqueued follow-up with its failure reason", async () => {
		const { result, completeEvent } = await runHandoffWithFailingFollowUp(
			new Error("boom"),
		);

		expect(result.warningKind).toBe("unqueued");
		expect(result.warning).toContain(
			"the follow-up command was not queued: boom",
		);
		// A definite queue failure survives a lost RPC response: the event
		// carries the warning and the exact command that never made it.
		expect(completeEvent).toMatchObject({
			warningKind: "unqueued",
			warning: expect.stringContaining(
				"the follow-up command was not queued: boom",
			),
			undeliveredCommand: "continue in cloud",
		});
	});
});
