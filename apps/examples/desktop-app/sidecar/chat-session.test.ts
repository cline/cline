import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CloudHandoffTranscriptMismatchError,
	preflightCloudHandoffGit,
	readCloudHandoffMetadata,
	selectCloudHandoffModel,
} from "@cline/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { materializeUserFiles } from "./attachments";
import {
	assertSessionDeleteAllowedDuringHandoff,
	buildSessionConnectionUpdate,
	cloudHandoffGitStateMatchesFingerprint,
	combineCloudHandoffModels,
	consumeWorkspaceMetadata,
	formatPendingHandoffVerificationError,
	handleChatSessionCommand,
	hasProviderChanged,
	mergeSessionConfig,
	prewarmWorkspaceMetadata,
	reconcilePendingCloudHandoff,
	resolveDesktopSessionMode,
	rewriteDesktopTeamPrompt,
	shouldCleanupFailedHandoffVerification,
	shouldUpdateSessionConnection,
	updateHandoffMetadataOrThrow,
	WORKSPACE_METADATA_PREWARM_TTL_MS,
} from "./chat-session";
import {
	CloudHandoffSeedUnsupportedError,
	CloudQueueUnconfirmedError,
	type CloudSessionApi,
	CloudSessionError,
	CloudSessionManager,
} from "./cloud-sessions";
import { handleCoreSessionEvent } from "./context";
import { writeDesktopSettings } from "./desktop-settings";
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

// New handoffs are gated on the rollout flags AND the user's Cloud sessions
// opt-in (a handoff uploads the local transcript). Tests that drive
// prepare_handoff/handoff arrange all three through this helper.
const handoffOptInDataDirs: string[] = [];

function enableCloudHandoffGates(): void {
	const dataDir = mkdtempSync(join(tmpdir(), "cline-handoff-optin-"));
	handoffOptInDataDirs.push(dataDir);
	process.env.CLINE_DATA_DIR = dataDir;
	process.env.CLINE_CODE_CLOUD_HANDOFF = "1";
	process.env.CLINE_CODE_CLOUD_AGENTS = "1";
	writeDesktopSettings({ cloudSessionsEnabled: true });
}

afterEach(() => {
	delete process.env.CLINE_CODE_CLOUD_HANDOFF;
	delete process.env.CLINE_CODE_CLOUD_AGENTS;
	delete process.env.CLINE_DATA_DIR;
	for (const dataDir of handoffOptInDataDirs.splice(0)) {
		rmSync(dataDir, { recursive: true, force: true });
	}
});

describe("resolveDesktopSessionMode", () => {
	it("does not turn auto-approved Act sessions into Yolo sessions", () => {
		expect(
			resolveDesktopSessionMode({ mode: "act", autoApproveTools: true }),
		).toBe("act");
		expect(resolveDesktopSessionMode({ autoApproveTools: true })).toBe("act");
	});

	it("preserves explicit Plan and Yolo modes", () => {
		expect(resolveDesktopSessionMode({ mode: "plan" })).toBe("plan");
		expect(resolveDesktopSessionMode({ mode: "yolo" })).toBe("yolo");
	});
});

describe("cloud handoff model catalog", () => {
	it("retains a catalog model duplicated in Cline Pass for organization use", () => {
		const models = combineCloudHandoffModels({
			catalog: [{ id: "shared/model", name: "Shared", catalogId: "cline" }],
			clinePass: [
				{ id: "shared/model", name: "Shared Pass", catalogId: "cline-pass" },
			],
			clineCloud: [],
		});

		expect(
			selectCloudHandoffModel({
				localModelId: "shared/model",
				models,
				isOrganizationSession: true,
			}),
		).toMatchObject({
			modelId: "shared/model",
			catalogId: "cline",
			usedFallback: false,
		});
	});
});

describe("rewriteDesktopTeamPrompt", () => {
	it("rewrites /team for the core runtime", () => {
		expect(
			rewriteDesktopTeamPrompt("/team inspect the app", {
				disabledTools: new Set(),
			}),
		).toBe(
			'<user_command slash="team">spawn a team of agents for the following task: inspect the app</user_command>',
		);
	});

	it("rejects /team when the Teams tool is disabled", () => {
		expect(() =>
			rewriteDesktopTeamPrompt("/team inspect the app", {
				disabledTools: new Set(["teams"]),
			}),
		).toThrow("Agent teams are disabled");
	});

	it("rejects /team when the mode's tool preset has no team tools", () => {
		expect(() =>
			rewriteDesktopTeamPrompt("/team inspect the app", {
				mode: "yolo",
				disabledTools: new Set(),
			}),
		).toThrow("Agent teams are not available in yolo mode");
	});

	it("accepts /team in act and plan modes", () => {
		for (const mode of ["act", "plan", undefined]) {
			expect(
				rewriteDesktopTeamPrompt("/team inspect the app", {
					mode,
					disabledTools: new Set(),
				}),
			).toContain('<user_command slash="team">');
		}
	});
});

describe("buildSessionConnectionUpdate", () => {
	it("does not clear reasoning settings when config omits reasoning fields", () => {
		const update = buildSessionConnectionUpdate({
			provider: "cline",
			model: "anthropic/claude-sonnet-4.6",
		});

		expect(update).toEqual({
			providerId: "cline",
			modelId: "anthropic/claude-sonnet-4.6",
		});
		expect(Object.hasOwn(update, "thinking")).toBe(false);
		expect(Object.hasOwn(update, "reasoningEffort")).toBe(false);
		expect(Object.hasOwn(update, "thinkingBudgetTokens")).toBe(false);
	});

	it("clears reasoning settings when thinking is explicitly disabled", () => {
		expect(
			buildSessionConnectionUpdate({
				provider: "cline",
				model: "anthropic/claude-sonnet-4.6",
				thinking: false,
			}),
		).toEqual({
			providerId: "cline",
			modelId: "anthropic/claude-sonnet-4.6",
			thinking: false,
			reasoningEffort: null,
			thinkingBudgetTokens: null,
		});
	});

	it("updates explicit reasoning settings without clearing omitted settings", () => {
		const update = buildSessionConnectionUpdate({
			provider: "cline",
			model: "anthropic/claude-sonnet-4.6",
			reasoningEffort: "high",
		});

		expect(update).toEqual({
			providerId: "cline",
			modelId: "anthropic/claude-sonnet-4.6",
			thinking: true,
			reasoningEffort: "high",
		});
		expect(Object.hasOwn(update, "thinkingBudgetTokens")).toBe(false);
	});
});

describe("shouldUpdateSessionConnection", () => {
	it("skips the redundant connection update on the first send", () => {
		const config = {
			provider: "cline",
			model: "anthropic/claude-sonnet-4.6",
			thinking: true,
			reasoningEffort: "high",
		};

		expect(shouldUpdateSessionConnection(config, { ...config })).toBe(false);
	});

	it("updates the connection when the selected reasoning level changes", () => {
		const current = {
			provider: "cline",
			model: "anthropic/claude-sonnet-4.6",
			thinking: true,
			reasoningEffort: "low",
		};

		expect(
			shouldUpdateSessionConnection(current, {
				...current,
				reasoningEffort: "high",
			}),
		).toBe(true);
	});
});

describe("hasProviderChanged", () => {
	it("distinguishes provider switches from model switches", () => {
		expect(
			hasProviderChanged(
				{ provider: "cline", model: "anthropic/claude-sonnet-4.6" },
				{ provider: "openai-codex", model: "gpt-5.3-codex" },
			),
		).toBe(true);
		expect(
			hasProviderChanged(
				{ provider: "cline", model: "anthropic/claude-sonnet-4.6" },
				{ provider: "cline", model: "openai/gpt-5.3-codex" },
			),
		).toBe(false);
	});

	it("honors a providerId-only update when the stored config uses provider", () => {
		const current = {
			provider: "cline",
			model: "anthropic/claude-sonnet-4.6",
		};
		const update = {
			providerId: "openai-codex",
			modelId: "gpt-5.3-codex",
		};

		expect(hasProviderChanged(current, update)).toBe(true);
		expect(mergeSessionConfig(current, update)).toMatchObject({
			provider: "openai-codex",
			providerId: "openai-codex",
			model: "gpt-5.3-codex",
			modelId: "gpt-5.3-codex",
		});
	});
});

describe("pathless session starts", () => {
	it("omits workspace paths and returns the SDK-resolved chat workspace", async () => {
		const start = vi.fn(async (input: { config: Record<string, unknown> }) => {
			expect(input.config).not.toHaveProperty("cwd");
			expect(input.config).not.toHaveProperty("workspaceRoot");
			expect(input.config).not.toHaveProperty("enableSpawnAgent");
			expect(input.config).not.toHaveProperty("enableAgentTeams");
			return {
				sessionId: "session-pathless",
				manifest: {
					cwd: "/home/host/.cline/data/workspaces/chat",
					workspace_root: "/home/host/.cline/data/workspaces/chat",
				},
				manifestPath: "/tmp/session-pathless.json",
				messagesPath: "/tmp/session-pathless.messages.json",
			};
		});
		const ctx = {
			liveSessions: new Map(),
			restoringWorkspacePaths: new Set(),
			sessionManager: { start },
		} as unknown as SidecarContext;

		const result = (await handleChatSessionCommand(ctx, {
			action: "start",
			config: {
				provider: "cline",
				model: "anthropic/claude-sonnet-4.6",
				enableTools: true,
				// Legacy desktop capability flags must not override the SDK's
				// current tool preset or global tool customizations.
				enableSpawn: false,
				enableTeams: false,
			},
		})) as {
			sessionId: string;
			cwd: string;
			workspaceRoot: string;
		};

		expect(result).toEqual({
			sessionId: "session-pathless",
			cwd: "/home/host/.cline/data/workspaces/chat",
			workspaceRoot: "/home/host/.cline/data/workspaces/chat",
		});
		expect(ctx.liveSessions.get("session-pathless")?.config).toMatchObject({
			cwd: "/home/host/.cline/data/workspaces/chat",
			workspaceRoot: "/home/host/.cline/data/workspaces/chat",
		});
	});
});

describe("session mode persistence", () => {
	function startResult(sessionId: string) {
		return {
			sessionId,
			manifest: { cwd: "/workspace/cline", workspace_root: "/workspace/cline" },
			manifestPath: `/tmp/${sessionId}.json`,
			messagesPath: `/tmp/${sessionId}.messages.json`,
		};
	}

	it("stores the agent mode in session metadata at start", async () => {
		const start = vi.fn(async () => startResult("session-mode-start"));
		const ctx = {
			liveSessions: new Map(),
			restoringWorkspacePaths: new Set(),
			sessionManager: { start },
		} as unknown as SidecarContext;

		await handleChatSessionCommand(ctx, {
			action: "start",
			config: {
				provider: "cline",
				model: "anthropic/claude-sonnet-4.6",
				mode: "plan",
			},
		});

		expect(start).toHaveBeenCalledWith(
			expect.objectContaining({ sessionMetadata: { mode: "plan" } }),
		);
	});

	it("defaults the persisted mode to act when the config has none", async () => {
		const start = vi.fn(async () => startResult("session-mode-default"));
		const ctx = {
			liveSessions: new Map(),
			restoringWorkspacePaths: new Set(),
			sessionManager: { start },
		} as unknown as SidecarContext;

		await handleChatSessionCommand(ctx, {
			action: "start",
			config: { provider: "cline", model: "anthropic/claude-sonnet-4.6" },
		});

		expect(start).toHaveBeenCalledWith(
			expect.objectContaining({ sessionMetadata: { mode: "act" } }),
		);
	});

	it("persists a mode change on send and skips when unchanged", async () => {
		const sessionId = "session-mode-send";
		let persistedMetadata: Record<string, unknown> = {
			title: "Keep me",
			mode: "act",
		};
		const get = vi.fn(async () => ({
			sessionId,
			status: "idle",
			metadata: persistedMetadata,
		}));
		const update = vi.fn(
			async (_id: string, input: { metadata: Record<string, unknown> }) => {
				persistedMetadata = input.metadata;
				return { updated: true };
			},
		);
		const send = vi.fn(async () => ({
			text: "done",
			finishReason: "completed",
			messages: [],
		}));
		const baseConfig = {
			provider: "cline",
			model: "anthropic/claude-sonnet-4.6",
			mode: "act",
		};
		const ctx = {
			liveSessions: new Map([
				[
					sessionId,
					{
						config: baseConfig,
						messages: [],
						promptsInQueue: [],
						busy: false,
						startedAt: Date.now(),
						status: "idle",
						attachedViaHub: false,
					},
				],
			]),
			restoringWorkspacePaths: new Set(),
			streamIndices: new Map(),
			wsClients: new Set(),
			sessionManager: {
				get,
				send,
				update,
				updateSessionConnection: vi.fn(async () => undefined),
				pendingPrompts: { list: vi.fn(async () => []) },
			},
		} as unknown as SidecarContext;

		await handleChatSessionCommand(ctx, {
			action: "send",
			sessionId,
			prompt: "switch to plan",
			config: { ...baseConfig, mode: "plan" },
		});
		// The existing metadata (e.g. title) must survive the wholesale replace.
		expect(update).toHaveBeenCalledWith(sessionId, {
			metadata: { title: "Keep me", mode: "plan" },
		});

		update.mockClear();
		await handleChatSessionCommand(ctx, {
			action: "send",
			sessionId,
			prompt: "still plan",
			config: { ...baseConfig, mode: "plan" },
		});
		expect(update).not.toHaveBeenCalled();
	});
});

describe("session forks", () => {
	it("blocks the delete command while a persisted cloud handoff is pending", async () => {
		const remove = vi.fn();
		const ctx = {
			liveSessions: new Map(),
			sessionManager: {
				get: vi.fn(async () => ({
					sessionId: "pending-handoff-source",
					metadata: {
						handoff: {
							status: "pending",
							toCloudSessionId: "cloud-pending",
							handedOffAt: "2026-08-18T00:00:00.000Z",
							dashboardUrl:
								"https://app.cline.bot/agents?sessionId=cloud-pending",
						},
					},
				})),
				delete: remove,
			},
		} as unknown as SidecarContext;
		const { handleCommand } = await import("./commands");

		await expect(
			handleCommand(ctx, "delete_chat_session", {
				sessionId: "pending-handoff-source",
			}),
		).rejects.toThrow("Cloud handoff is still pending");
		expect(remove).not.toHaveBeenCalled();
	});

	it("blocks deletion while the handoff request is starting", async () => {
		enableCloudHandoffGates();
		let releaseGet: ((value: undefined) => void) | undefined;
		const ctx = {
			liveSessions: new Map(),
			sessionManager: {
				get: vi.fn(
					async () =>
						await new Promise<undefined>((resolve) => {
							releaseGet = resolve;
						}),
				),
			},
		} as unknown as SidecarContext;
		const handoff = handleChatSessionCommand(ctx, {
			action: "handoff",
			sessionId: "starting-handoff-source",
			handoffAttemptId: "attempt-a",
			fingerprint: {
				repoUrl: "https://github.com/cline/cline.git",
				branch: "main",
				headSha: "abc123",
				modelId: "anthropic/claude-sonnet-4.6",
			},
		});
		await expect(
			handleChatSessionCommand(ctx, {
				action: "handoff",
				sessionId: "starting-handoff-source",
				handoffAttemptId: "attempt-b",
				fingerprint: {
					repoUrl: "https://github.com/cline/cline.git",
					branch: "main",
					headSha: "abc123",
					modelId: "anthropic/claude-sonnet-4.6",
				},
			}),
		).rejects.toThrow("A different cloud handoff is already in progress");

		await expect(
			assertSessionDeleteAllowedDuringHandoff(ctx, "starting-handoff-source"),
		).rejects.toThrow("Wait for the cloud handoff to finish before deleting");
		releaseGet?.(undefined);
		await expect(handoff).rejects.toThrow("was not found");
	});

	it("allows deletion after a cloud handoff has completed", async () => {
		const ctx = {
			liveSessions: new Map(),
			sessionManager: {
				get: vi.fn(async () => ({
					sessionId: "completed-handoff-source",
					metadata: {
						handoff: {
							status: "complete",
							toCloudSessionId: "cloud-complete",
							handedOffAt: "2026-08-18T00:00:00.000Z",
						},
					},
				})),
			},
		} as unknown as SidecarContext;

		await expect(
			assertSessionDeleteAllowedDuringHandoff(ctx, "completed-handoff-source"),
		).resolves.toBeUndefined();
	});

	it("keeps a persisted pending handoff read-only after restart", async () => {
		const send = vi.fn();
		const restore = vi.fn();
		const sourceSessionId = "pending-handoff-source";
		const pendingSession = {
			sessionId: sourceSessionId,
			status: "idle",
			metadata: {
				handoff: {
					status: "pending",
					toCloudSessionId: "cloud-pending",
					handedOffAt: "2026-08-18T00:00:00.000Z",
					dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-pending",
				},
			},
		};
		const ctx = {
			liveSessions: new Map([
				[
					sourceSessionId,
					{
						config: { cwd: "/workspace/project" },
						messages: [{ role: "user", content: "continue" }],
						promptsInQueue: [],
						busy: false,
						startedAt: Date.now(),
						status: "idle",
					},
				],
			]),
			restoringWorkspacePaths: new Set(),
			sessionManager: {
				get: vi.fn(async () => pendingSession),
				send,
				restore,
			},
			streamIndices: new Map(),
			wsClients: new Set(),
		} as unknown as SidecarContext;
		const recovery = "Cloud handoff is still pending";

		await expect(
			handleChatSessionCommand(ctx, {
				action: "send",
				sessionId: sourceSessionId,
				prompt: "race",
			}),
		).rejects.toThrow(recovery);
		await expect(
			handleChatSessionCommand(ctx, {
				action: "fork",
				sessionId: sourceSessionId,
			}),
		).rejects.toThrow(recovery);
		await expect(
			handleChatSessionCommand(ctx, {
				action: "reset",
				sessionId: sourceSessionId,
			}),
		).rejects.toThrow(recovery);
		await expect(
			handleChatSessionCommand(ctx, {
				action: "restore_checkpoint",
				sessionId: sourceSessionId,
				checkpointRunCount: 1,
				config: { cwd: "/workspace/project" },
			}),
		).rejects.toThrow(recovery);
		expect(send).not.toHaveBeenCalled();
		expect(restore).not.toHaveBeenCalled();
	});

	it("rejects checkpoint restore after the source completed a cloud handoff", async () => {
		const restore = vi.fn();
		const ctx = {
			liveSessions: new Map(),
			restoringWorkspacePaths: new Set(),
			sessionManager: {
				get: vi.fn(async () => ({
					sessionId: "handed-off-source",
					metadata: {
						handoff: {
							status: "complete",
							toCloudSessionId: "cloud-target",
							handedOffAt: "2026-08-18T00:00:00.000Z",
						},
					},
				})),
				restore,
			},
			streamIndices: new Map(),
			wsClients: new Set(),
		} as unknown as SidecarContext;

		await expect(
			handleChatSessionCommand(ctx, {
				action: "restore_checkpoint",
				sessionId: "handed-off-source",
				checkpointRunCount: 1,
				config: { cwd: "/workspace/project" },
			}),
		).rejects.toThrow("Fork locally before restoring a checkpoint");
		expect(restore).not.toHaveBeenCalled();
	});

	it("restores the selected workspace checkpoint before forking for message editing", async () => {
		const sourceSessionId = `source-fork-${Date.now()}`;
		const sourceMessages = [
			{ role: "user" as const, content: "first prompt" },
			{ role: "assistant" as const, content: "first response" },
			{ role: "user" as const, content: "prompt to edit" },
			{ role: "assistant" as const, content: "response to replace" },
		];
		const expectedMessages = sourceMessages.slice(0, 2);
		const start = vi.fn(async () => ({ sessionId: "edited-fork" }));
		const restore = vi.fn(async () => ({
			sessionId: "edited-fork",
			messages: sourceMessages.slice(0, 3),
			checkpoint: {
				ref: "second",
				createdAt: 2,
				runCount: 2,
			},
		}));
		const readMessages = vi.fn(async () => expectedMessages);
		const ctx = {
			liveSessions: new Map([
				[
					sourceSessionId,
					{
						config: {
							provider: "cline",
							model: "anthropic/claude-sonnet-4.6",
						},
						messages: sourceMessages,
						promptsInQueue: [],
						busy: false,
						startedAt: Date.now(),
						status: "completed",
					},
				],
			]),
			restoringWorkspacePaths: new Set(),
			sessionManager: {
				get: vi.fn(async () => ({
					sessionId: sourceSessionId,
					source: "desktop",
					status: "completed",
					provider: "cline",
					model: "anthropic/claude-sonnet-4.6",
					cwd: "/workspace/project",
					workspaceRoot: "/workspace/project",
					metadata: {
						checkpoint: {
							latest: { ref: "second", createdAt: 2, runCount: 2 },
							history: [
								{ ref: "first", createdAt: 1, runCount: 1 },
								{ ref: "second", createdAt: 2, runCount: 2 },
							],
						},
					},
				})),
				readMessages,
				restore,
				start,
			},
			streamIndices: new Map(),
			wsClients: new Set(),
		} as unknown as SidecarContext;

		const result = (await handleChatSessionCommand(ctx, {
			action: "fork",
			sessionId: sourceSessionId,
			forkBeforeRunCount: 2,
			config: {
				provider: "cline",
				model: "anthropic/claude-sonnet-4.6",
			},
		})) as { sessionId: string; messages: unknown[] };

		expect(restore).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: sourceSessionId,
				checkpointRunCount: 2,
				cwd: "/workspace/project",
				restore: {
					messages: true,
					workspace: true,
					omitCheckpointMessageFromSession: true,
				},
				start: expect.objectContaining({
					sessionMetadata: expect.objectContaining({
						fork: expect.objectContaining({
							forkedFromSessionId: sourceSessionId,
							beforeRunCount: 2,
						}),
					}),
				}),
			}),
		);
		expect(start).not.toHaveBeenCalled();
		expect(readMessages).toHaveBeenCalledWith("edited-fork");
		expect(result).toEqual({
			sessionId: "edited-fork",
			forkedFromSessionId: sourceSessionId,
		});
		expect(ctx.liveSessions.get("edited-fork")?.messages).toEqual(
			expectedMessages,
		);
		expect(ctx.restoringWorkspacePaths.size).toBe(0);
	});

	it("holds the workspace lock for the full edit restore", async () => {
		const sourceSessionId = `locking-source-${Date.now()}`;
		const siblingSessionId = `locking-sibling-${Date.now()}`;
		const sourceMessages = [
			{ role: "user" as const, content: "first prompt" },
			{ role: "assistant" as const, content: "first response" },
		];
		let releaseRestore = () => {};
		const restoreGate = new Promise<void>((resolve) => {
			releaseRestore = resolve;
		});
		let markRestoreStarted = () => {};
		const restoreStarted = new Promise<void>((resolve) => {
			markRestoreStarted = resolve;
		});
		const send = vi.fn();
		const restore = vi.fn(async () => {
			markRestoreStarted();
			await restoreGate;
			return {
				sessionId: "locked-edited-fork",
				messages: sourceMessages,
				checkpoint: { ref: "first", createdAt: 1, runCount: 1 },
			};
		});
		const ctx = {
			liveSessions: new Map([
				[
					sourceSessionId,
					{
						config: {
							provider: "cline",
							model: "anthropic/claude-sonnet-4.6",
							cwd: "/workspace/project",
						},
						messages: sourceMessages,
						promptsInQueue: [],
						busy: false,
						startedAt: Date.now(),
						status: "idle",
					},
				],
				[
					siblingSessionId,
					{
						config: { workspaceRoot: "/workspace/project/." },
						messages: [],
						promptsInQueue: [],
						busy: false,
						startedAt: Date.now(),
						status: "idle",
					},
				],
			]),
			restoringWorkspacePaths: new Set(),
			sessionManager: {
				get: vi.fn(async () => ({
					sessionId: sourceSessionId,
					source: "desktop",
					status: "completed",
					provider: "cline",
					model: "anthropic/claude-sonnet-4.6",
					cwd: "/workspace/project",
					workspaceRoot: "/workspace/project",
					metadata: {
						checkpoint: {
							latest: { ref: "first", createdAt: 1, runCount: 1 },
							history: [{ ref: "first", createdAt: 1, runCount: 1 }],
						},
					},
				})),
				readMessages: vi.fn(async () => sourceMessages),
				restore,
				send,
			},
			streamIndices: new Map(),
			wsClients: new Set(),
		} as unknown as SidecarContext;

		const fork = handleChatSessionCommand(ctx, {
			action: "fork",
			sessionId: sourceSessionId,
			forkBeforeRunCount: 1,
		});
		await restoreStarted;
		try {
			expect(ctx.restoringWorkspacePaths).toEqual(
				new Set(["/workspace/project"]),
			);
			await expect(
				handleChatSessionCommand(ctx, {
					action: "send",
					sessionId: siblingSessionId,
					prompt: "race",
				}),
			).rejects.toThrow(
				"Cannot send a prompt while the session workspace is being restored",
			);
			expect(send).not.toHaveBeenCalled();
		} finally {
			releaseRestore();
		}

		await expect(fork).resolves.toMatchObject({
			sessionId: "locked-edited-fork",
		});
		expect(ctx.restoringWorkspacePaths.size).toBe(0);
	});

	it("keeps a full-history fork on the current workspace without restoring", async () => {
		const sourceSessionId = `source-full-fork-${Date.now()}`;
		const sourceMessages = [
			{ role: "user" as const, content: "first prompt" },
			{ role: "assistant" as const, content: "first response" },
		];
		const start = vi.fn(async () => ({ sessionId: "full-fork" }));
		const restore = vi.fn();
		const readMessages = vi.fn(async () => sourceMessages);
		const ctx = {
			liveSessions: new Map([
				[
					sourceSessionId,
					{
						config: {
							provider: "cline",
							model: "anthropic/claude-sonnet-4.6",
						},
						messages: sourceMessages,
						promptsInQueue: [],
						busy: false,
						startedAt: Date.now(),
						status: "completed",
					},
				],
			]),
			restoringWorkspacePaths: new Set(),
			sessionManager: {
				get: vi.fn(async () => ({
					sessionId: sourceSessionId,
					source: "desktop",
					status: "completed",
					provider: "cline",
					model: "anthropic/claude-sonnet-4.6",
					cwd: "/workspace/project",
					workspaceRoot: "/workspace/project",
					metadata: {
						handoff: {
							toCloudSessionId: "ses-cloud-copy",
							handedOffAt: "2026-08-18T00:00:00.000Z",
							status: "complete",
						},
					},
				})),
				readMessages,
				restore,
				start,
			},
			streamIndices: new Map(),
			wsClients: new Set(),
		} as unknown as SidecarContext;

		await handleChatSessionCommand(ctx, {
			action: "fork",
			sessionId: sourceSessionId,
			config: {
				provider: "cline",
				model: "anthropic/claude-sonnet-4.6",
			},
		});

		expect(restore).not.toHaveBeenCalled();
		expect(start).toHaveBeenCalledWith(
			expect.objectContaining({
				initialMessages: sourceMessages,
				sessionMetadata: expect.not.objectContaining({
					handoff: expect.anything(),
				}),
			}),
		);
	});

	it("rejects an edit fork while the source session is running", async () => {
		const restore = vi.fn();
		const sourceSessionId = "busy-source-session";
		const ctx = {
			liveSessions: new Map([
				[
					sourceSessionId,
					{
						config: {},
						messages: [{ role: "user", content: "prompt" }],
						promptsInQueue: [],
						busy: true,
						startedAt: Date.now(),
						status: "running",
					},
				],
			]),
			restoringWorkspacePaths: new Set(),
			sessionManager: { restore },
		} as unknown as SidecarContext;

		await expect(
			handleChatSessionCommand(ctx, {
				action: "fork",
				sessionId: sourceSessionId,
				forkBeforeRunCount: 1,
			}),
		).rejects.toThrow("Wait for all turns in this workspace to finish");
		expect(restore).not.toHaveBeenCalled();
	});

	it("rejects an edit fork when the persisted session is still active", async () => {
		const restore = vi.fn();
		const sourceSessionId = "persisted-running-session";
		const ctx = {
			liveSessions: new Map([
				[
					sourceSessionId,
					{
						config: {},
						messages: [{ role: "user", content: "prompt" }],
						promptsInQueue: [],
						busy: false,
						startedAt: Date.now(),
						status: "idle",
					},
				],
			]),
			restoringWorkspacePaths: new Set(),
			sessionManager: {
				get: vi.fn(async () => ({
					sessionId: sourceSessionId,
					status: "running",
				})),
				restore,
			},
		} as unknown as SidecarContext;

		await expect(
			handleChatSessionCommand(ctx, {
				action: "fork",
				sessionId: sourceSessionId,
				forkBeforeRunCount: 1,
			}),
		).rejects.toThrow("Wait for all turns in this workspace to finish");
		expect(restore).not.toHaveBeenCalled();
		expect(ctx.restoringWorkspacePaths.size).toBe(0);
	});

	it("rejects an edit fork while a sibling session in the workspace is running", async () => {
		const sourceSessionId = "idle-source-session";
		const siblingSessionId = "busy-sibling-session";
		const restore = vi.fn();
		const ctx = {
			liveSessions: new Map([
				[
					sourceSessionId,
					{
						config: { cwd: "/workspace/project" },
						messages: [{ role: "user", content: "prompt" }],
						promptsInQueue: [],
						busy: false,
						startedAt: Date.now(),
						status: "idle",
					},
				],
				[
					siblingSessionId,
					{
						config: { workspaceRoot: "/workspace/project/." },
						messages: [],
						promptsInQueue: [],
						busy: true,
						startedAt: Date.now(),
						status: "running",
					},
				],
			]),
			restoringWorkspacePaths: new Set(),
			sessionManager: {
				get: vi.fn(async () => ({
					sessionId: sourceSessionId,
					status: "completed",
					cwd: "/workspace/project",
					workspaceRoot: "/workspace/project",
				})),
				restore,
			},
		} as unknown as SidecarContext;

		await expect(
			handleChatSessionCommand(ctx, {
				action: "fork",
				sessionId: sourceSessionId,
				forkBeforeRunCount: 1,
			}),
		).rejects.toThrow("Wait for all turns in this workspace to finish");
		expect(restore).not.toHaveBeenCalled();
		expect(ctx.restoringWorkspacePaths.size).toBe(0);
	});

	it("allows a workspace restore after a queued turn completes through the event stream", async () => {
		const sessionId = `queued-turn-session-${Date.now()}`;
		const dataDir = mkdtempSync(join(tmpdir(), "cline-queued-restore-"));
		const originalDataDir = process.env.CLINE_SESSION_DATA_DIR;
		process.env.CLINE_SESSION_DATA_DIR = dataDir;
		try {
			const restore = vi.fn(async () => ({
				sessionId,
				messages: [{ role: "user", content: "first prompt" }],
				checkpoint: { ref: "first", createdAt: 1, runCount: 1 },
			}));
			const ctx = {
				liveSessions: new Map([
					[
						sessionId,
						{
							config: { cwd: "/workspace/project" },
							messages: [{ role: "user", content: "first prompt" }],
							promptsInQueue: [],
							// A drained queued turn is running: no send() RPC owns
							// this turn's busy flag, only the event stream does.
							busy: true,
							startedAt: Date.now(),
							status: "running",
						},
					],
				]),
				restoringWorkspacePaths: new Set(),
				streamIndices: new Map(),
				wsClients: new Set(),
				sessionManager: { restore, get: vi.fn(async () => undefined) },
			} as unknown as SidecarContext;
			const restoreRequest = {
				action: "restore_checkpoint" as const,
				sessionId,
				checkpointRunCount: 1,
				config: {
					cwd: "/workspace/project",
					provider: "cline",
					model: "test-model",
				},
			};

			// While the queued turn is still running the workspace stays locked.
			await expect(
				handleChatSessionCommand(ctx, restoreRequest),
			).rejects.toThrow("Wait for all turns in this workspace to finish");
			expect(restore).not.toHaveBeenCalled();

			// The queued turn settles through the event stream: the runtime
			// host reports the session back at idle (there is no send() RPC
			// response to clear the busy flag for event-settled turns).
			handleCoreSessionEvent(ctx, {
				type: "status",
				payload: { sessionId, status: "idle" },
			});
			expect(ctx.liveSessions.get(sessionId)).toMatchObject({
				busy: false,
				status: "idle",
			});

			await expect(
				handleChatSessionCommand(ctx, restoreRequest),
			).resolves.toMatchObject({ sessionId });
			expect(restore).toHaveBeenCalledTimes(1);
		} finally {
			if (originalDataDir === undefined) {
				delete process.env.CLINE_SESSION_DATA_DIR;
			} else {
				process.env.CLINE_SESSION_DATA_DIR = originalDataDir;
			}
			rmSync(dataDir, { force: true, recursive: true });
		}
	});

	it("blocks sends from sibling sessions while their workspace is restored", async () => {
		const send = vi.fn();
		const sessionId = "workspace-sibling-session";
		const ctx = {
			liveSessions: new Map([
				[
					sessionId,
					{
						config: { workspaceRoot: "/workspace/project/." },
						messages: [{ role: "user", content: "prompt" }],
						promptsInQueue: [],
						busy: false,
						startedAt: Date.now(),
						status: "idle",
					},
				],
			]),
			restoringWorkspacePaths: new Set(["/workspace/project"]),
			sessionManager: { send },
		} as unknown as SidecarContext;

		await expect(
			handleChatSessionCommand(ctx, {
				action: "send",
				sessionId,
				prompt: "race",
			}),
		).rejects.toThrow(
			"Cannot send a prompt while the session workspace is being restored",
		);
		expect(send).not.toHaveBeenCalled();
	});
});

describe("first-send connection updates", () => {
	const baseConfig = {
		provider: "cline",
		model: "anthropic/claude-sonnet-4.6",
		thinking: true,
		reasoningEffort: "high",
	};

	function createContext(options?: {
		attachedViaHub?: boolean;
		config?: Record<string, unknown>;
	}) {
		const updateSessionConnection = vi.fn(async () => undefined);
		const send = vi.fn(async (_input?: unknown) => ({
			text: "done",
			finishReason: "completed",
			messages: [],
		}));
		const readMessages = vi.fn(async () => [
			{ role: "user", content: "first prompt" },
			{ role: "assistant", content: "first response" },
		]);
		const readSessionCompactionState = vi.fn(async () => undefined);
		const stop = vi.fn(async () => undefined);
		const sessionId = "session-connection-test";
		const start = vi.fn(async (_input?: unknown) => ({ sessionId }));
		const get = vi.fn(async () => ({ sessionId, status: "idle" }));
		const ctx = {
			liveSessions: new Map([
				[
					sessionId,
					{
						config: options?.config ?? baseConfig,
						messages: [],
						promptsInQueue: [],
						busy: false,
						startedAt: Date.now(),
						status: "idle",
						attachedViaHub: options?.attachedViaHub ?? false,
					},
				],
			]),
			restoringWorkspacePaths: new Set(),
			streamIndices: new Map(),
			wsClients: new Set(),
			sessionManager: {
				get,
				readMessages,
				readSessionCompactionState,
				send,
				start,
				stop,
				updateSessionConnection,
				pendingPrompts: {
					list: vi.fn(async () => []),
				},
			},
		} as unknown as SidecarContext;
		return {
			ctx,
			readMessages,
			send,
			sessionId,
			start,
			stop,
			updateSessionConnection,
		};
	}

	it("skips an identical update for a locally-created session", async () => {
		const { ctx, send, sessionId, updateSessionConnection } = createContext();

		await handleChatSessionCommand(ctx, {
			action: "send",
			sessionId,
			prompt: "hello",
			config: { ...baseConfig },
		});

		expect(updateSessionConnection).not.toHaveBeenCalled();
		expect(send).toHaveBeenCalledTimes(1);
	});

	it("allows an image-only user turn", async () => {
		const { ctx, send, sessionId } = createContext();

		await handleChatSessionCommand(ctx, {
			action: "send",
			sessionId,
			prompt: "",
			attachments: {
				userImages: ["data:image/png;base64,aGVsbG8="],
				userFiles: [],
			},
		});

		expect(send).toHaveBeenCalledWith({
			sessionId,
			prompt: "",
			delivery: undefined,
			userImages: ["data:image/png;base64,aGVsbG8="],
		});
	});

	it.each([
		undefined,
		"queue",
	] as const)("forwards file attachments for %s delivery", async (delivery) => {
		const { ctx, send, sessionId } = createContext();
		const previousSessionDataDir = process.env.CLINE_SESSION_DATA_DIR;
		const testSessionDataDir = join(
			tmpdir(),
			`cline-desktop-attachments-${Date.now()}-${delivery ?? "immediate"}`,
		);
		let sentFileContent: string | undefined;
		send.mockImplementation(async (input?: unknown) => {
			const files = (input as { userFiles?: string[] } | undefined)?.userFiles;
			if (files?.[0]) {
				sentFileContent = readFileSync(files[0], "utf8");
			}
			return { text: "done", finishReason: "completed", messages: [] };
		});

		try {
			process.env.CLINE_SESSION_DATA_DIR = testSessionDataDir;
			await handleChatSessionCommand(ctx, {
				action: "send",
				sessionId,
				prompt: "",
				delivery,
				attachments: {
					userFiles: [{ name: "notes.txt", content: "hello" }],
				},
			});

			const input = send.mock.calls[0]?.[0] as
				| { userFiles?: string[] }
				| undefined;
			expect(send).toHaveBeenCalledWith({
				sessionId,
				prompt: "",
				delivery,
				userImages: undefined,
				userFiles: [expect.stringMatching(/notes\.txt$/)],
			});
			expect(sentFileContent).toBe("hello");
			if (delivery === "queue") {
				// Queued attachments stay on disk until the prompt is consumed.
				expect(existsSync(input?.userFiles?.[0] ?? "")).toBe(true);
			} else {
				// Immediate turns delete the materialized file once the send resolves.
				expect(existsSync(input?.userFiles?.[0] ?? "")).toBe(false);
			}
		} finally {
			if (previousSessionDataDir === undefined) {
				delete process.env.CLINE_SESSION_DATA_DIR;
			} else {
				process.env.CLINE_SESSION_DATA_DIR = previousSessionDataDir;
			}
			rmSync(testSessionDataDir, { recursive: true, force: true });
		}
	});

	it("deletes materialized attachments when a queued prompt is removed", async () => {
		const { ctx, send, sessionId } = createContext();
		const previousSessionDataDir = process.env.CLINE_SESSION_DATA_DIR;
		const testSessionDataDir = join(
			tmpdir(),
			`cline-desktop-attachments-remove-${Date.now()}`,
		);

		try {
			process.env.CLINE_SESSION_DATA_DIR = testSessionDataDir;
			const queue: Array<{
				id: string;
				prompt: string;
				delivery: "queue";
				attachmentCount: number;
				userFiles?: string[];
			}> = [];
			const manager = ctx.sessionManager as unknown as {
				send: typeof send;
				pendingPrompts: {
					list: (input: unknown) => Promise<unknown[]>;
					delete: (input: {
						sessionId: string;
						promptId: string;
					}) => Promise<unknown>;
				};
			};
			manager.send = vi.fn(async (input?: unknown) => {
				const { prompt, userFiles } = input as {
					prompt: string;
					userFiles?: string[];
				};
				queue.push({
					id: "pending_1",
					prompt,
					delivery: "queue",
					attachmentCount: userFiles?.length ?? 0,
					userFiles,
				});
				return undefined;
			}) as unknown as typeof send;
			manager.pendingPrompts = {
				list: vi.fn(async () => [...queue]),
				delete: vi.fn(async ({ promptId }) => {
					const index = queue.findIndex((entry) => entry.id === promptId);
					const [removed] = index >= 0 ? queue.splice(index, 1) : [];
					return {
						sessionId,
						prompts: [...queue],
						prompt: removed,
						removed: index >= 0,
					};
				}),
			};

			await handleChatSessionCommand(ctx, {
				action: "send",
				sessionId,
				prompt: "queued with file",
				delivery: "queue",
				attachments: {
					userFiles: [{ name: "notes.txt", content: "hello" }],
				},
			});
			const filePath = queue[0]?.userFiles?.[0] ?? "";
			expect(existsSync(filePath)).toBe(true);
			expect(
				ctx.liveSessions
					.get(sessionId)
					?.queuedAttachmentFiles?.get("pending_1"),
			).toEqual([filePath]);

			await handleChatSessionCommand(ctx, {
				action: "remove_pending_prompt",
				sessionId,
				promptId: "pending_1",
			});
			expect(existsSync(filePath)).toBe(false);
			expect(
				ctx.liveSessions.get(sessionId)?.queuedAttachmentFiles?.size ?? 0,
			).toBe(0);
		} finally {
			if (previousSessionDataDir === undefined) {
				delete process.env.CLINE_SESSION_DATA_DIR;
			} else {
				process.env.CLINE_SESSION_DATA_DIR = previousSessionDataDir;
			}
			rmSync(testSessionDataDir, { recursive: true, force: true });
		}
	});

	it("deletes tracked attachments when a session is reset", async () => {
		const { ctx, sessionId } = createContext();
		const previousSessionDataDir = process.env.CLINE_SESSION_DATA_DIR;
		const testSessionDataDir = join(
			tmpdir(),
			`cline-desktop-attachments-reset-${Date.now()}`,
		);

		try {
			process.env.CLINE_SESSION_DATA_DIR = testSessionDataDir;
			const [queuedFile] = materializeUserFiles(sessionId, [
				{ name: "queued.txt", content: "q" },
			]) as string[];
			const [consumedFile] = materializeUserFiles(sessionId, [
				{ name: "consumed.txt", content: "c" },
			]) as string[];
			const session = ctx.liveSessions.get(sessionId);
			if (!session) throw new Error("missing session");
			session.queuedAttachmentFiles = new Map([["pending_1", [queuedFile]]]);
			session.consumedAttachmentFiles = new Map([
				["pending_2", [consumedFile]],
			]);

			await handleChatSessionCommand(ctx, {
				action: "reset",
				sessionId,
			});

			expect(existsSync(queuedFile)).toBe(false);
			expect(existsSync(consumedFile)).toBe(false);
			expect(ctx.liveSessions.has(sessionId)).toBe(false);
		} finally {
			if (previousSessionDataDir === undefined) {
				delete process.env.CLINE_SESSION_DATA_DIR;
			} else {
				process.env.CLINE_SESSION_DATA_DIR = previousSessionDataDir;
			}
			rmSync(testSessionDataDir, { recursive: true, force: true });
		}
	});

	it("preserves tracked attachments across re-attach", async () => {
		const { ctx, sessionId } = createContext();
		const previousSessionDataDir = process.env.CLINE_SESSION_DATA_DIR;
		const testSessionDataDir = join(
			tmpdir(),
			`cline-desktop-attachments-attach-${Date.now()}`,
		);

		try {
			process.env.CLINE_SESSION_DATA_DIR = testSessionDataDir;
			const [queuedFile] = materializeUserFiles(sessionId, [
				{ name: "queued.txt", content: "q" },
			]) as string[];
			const session = ctx.liveSessions.get(sessionId);
			if (!session) throw new Error("missing session");
			const queuedMap = new Map([["pending_1", [queuedFile]]]);
			session.queuedAttachmentFiles = queuedMap;
			(ctx.sessionManager as unknown as { get: unknown }).get = vi.fn(
				async () => ({
					status: "idle",
					provider: "cline",
					model: "anthropic/claude-sonnet-4.6",
					cwd: "/workspace",
					workspaceRoot: "/workspace",
				}),
			);

			await handleChatSessionCommand(ctx, {
				action: "attach",
				sessionId,
			});

			expect(existsSync(queuedFile)).toBe(true);
			expect(
				ctx.liveSessions
					.get(sessionId)
					?.queuedAttachmentFiles?.get("pending_1"),
			).toEqual([queuedFile]);
		} finally {
			if (previousSessionDataDir === undefined) {
				delete process.env.CLINE_SESSION_DATA_DIR;
			} else {
				process.env.CLINE_SESSION_DATA_DIR = previousSessionDataDir;
			}
			rmSync(testSessionDataDir, { recursive: true, force: true });
		}
	});

	it("preserves an idle fork status when Core reports its resident process as running", async () => {
		const { ctx, sessionId } = createContext();
		const existing = ctx.liveSessions.get(sessionId);
		if (!existing) throw new Error("missing session");
		existing.status = "idle";
		existing.busy = false;
		(ctx.sessionManager as unknown as { get: unknown }).get = vi.fn(
			async () => ({
				sessionId,
				status: "running",
				provider: "cline",
				model: "anthropic/claude-sonnet-4.6",
				cwd: "/workspace",
				workspaceRoot: "/workspace",
			}),
		);

		const result = (await handleChatSessionCommand(ctx, {
			action: "attach",
			sessionId,
		})) as { status: string };

		expect(result.status).toBe("idle");
		expect(ctx.liveSessions.get(sessionId)).toMatchObject({
			status: "idle",
			busy: false,
		});
	});

	it("updates a changed connection before sending", async () => {
		const { ctx, send, sessionId, updateSessionConnection } = createContext({
			config: { ...baseConfig, reasoningEffort: "low" },
		});

		await handleChatSessionCommand(ctx, {
			action: "send",
			sessionId,
			prompt: "hello",
			config: { ...baseConfig },
		});

		expect(updateSessionConnection).toHaveBeenCalledTimes(1);
		expect(updateSessionConnection.mock.invocationCallOrder[0]).toBeLessThan(
			send.mock.invocationCallOrder[0] ?? 0,
		);
	});

	it("rebuilds the same session with its transcript before a provider switch", async () => {
		const {
			ctx,
			readMessages,
			send,
			sessionId,
			start,
			stop,
			updateSessionConnection,
		} = createContext();

		await handleChatSessionCommand(ctx, {
			action: "send",
			sessionId,
			prompt: "continue with Codex",
			config: {
				...baseConfig,
				provider: "openai-codex",
				model: "gpt-5.3-codex",
			},
		});

		expect(readMessages).toHaveBeenCalledWith(sessionId);
		expect(stop).toHaveBeenCalledWith(sessionId);
		expect(start).toHaveBeenCalledWith(
			expect.objectContaining({
				config: expect.objectContaining({
					providerId: "openai-codex",
					modelId: "gpt-5.3-codex",
					sessionId,
				}),
				initialMessages: [
					{ role: "user", content: "first prompt" },
					{ role: "assistant", content: "first response" },
				],
			}),
		);
		expect(updateSessionConnection).toHaveBeenCalledWith(sessionId, {
			providerId: "openai-codex",
			modelId: "gpt-5.3-codex",
			thinking: true,
			reasoningEffort: "high",
			thinkingBudgetTokens: null,
		});
		expect(start.mock.invocationCallOrder[0]).toBeLessThan(
			send.mock.invocationCallOrder[0] ?? 0,
		);
	});

	it("blocks a concurrent send throughout provider-switch preparation", async () => {
		let resolveMessages:
			| ((messages: Array<{ role: string; content: string }>) => void)
			| undefined;
		const messages = new Promise<Array<{ role: string; content: string }>>(
			(resolve) => {
				resolveMessages = resolve;
			},
		);
		const { ctx, readMessages, sessionId } = createContext();
		readMessages.mockImplementationOnce(async () => await messages);

		const switching = handleChatSessionCommand(ctx, {
			action: "send",
			sessionId,
			prompt: "continue with Codex",
			config: {
				...baseConfig,
				provider: "openai-codex",
				model: "gpt-5.3-codex",
			},
		});
		await vi.waitFor(() => expect(readMessages).toHaveBeenCalledOnce());

		await expect(
			handleChatSessionCommand(ctx, {
				action: "send",
				sessionId,
				prompt: "racing prompt",
				config: { ...baseConfig },
			}),
		).rejects.toThrow("A provider switch is already in progress");

		resolveMessages?.([
			{ role: "user", content: "first prompt" },
			{ role: "assistant", content: "first response" },
		]);
		await switching;
	});

	it.each([
		"queue",
		"steer",
	] as const)("locks provider-switch preparation for explicit %s delivery", async (delivery) => {
		let resolveMessages:
			| ((messages: Array<{ role: string; content: string }>) => void)
			| undefined;
		const messages = new Promise<Array<{ role: string; content: string }>>(
			(resolve) => {
				resolveMessages = resolve;
			},
		);
		const { ctx, readMessages, sessionId } = createContext();
		readMessages.mockImplementationOnce(async () => await messages);

		const switching = handleChatSessionCommand(ctx, {
			action: "send",
			sessionId,
			prompt: "queue this for Codex",
			delivery,
			config: {
				...baseConfig,
				provider: "openai-codex",
				model: "gpt-5.3-codex",
			},
		});
		await vi.waitFor(() => expect(readMessages).toHaveBeenCalledOnce());

		await expect(
			handleChatSessionCommand(ctx, {
				action: "send",
				sessionId,
				prompt: "racing prompt",
				config: { ...baseConfig },
			}),
		).rejects.toThrow("A provider switch is already in progress");

		resolveMessages?.([
			{ role: "user", content: "first prompt" },
			{ role: "assistant", content: "first response" },
		]);
		await switching;
	});

	it("restores the previous provider runtime when replacement startup fails", async () => {
		const { ctx, send, sessionId, start, stop } = createContext();
		const previousKanbanDataDir = process.env.CLINE_KANBAN_DATA_DIR;
		const testKanbanDataDir = join(
			tmpdir(),
			`cline-provider-rollback-${process.pid}`,
		);
		process.env.CLINE_KANBAN_DATA_DIR = testKanbanDataDir;
		start
			.mockRejectedValueOnce(new Error("Codex bootstrap failed"))
			.mockResolvedValueOnce({ sessionId });

		try {
			const result = (await handleChatSessionCommand(ctx, {
				action: "send",
				sessionId,
				prompt: "continue with Codex",
				config: {
					...baseConfig,
					provider: "openai-codex",
					model: "gpt-5.3-codex",
				},
			})) as { result?: { finishReason?: string; text?: string } };

			expect(stop).toHaveBeenCalledOnce();
			expect(start).toHaveBeenCalledTimes(2);
			expect(start.mock.calls[1]?.[0]).toEqual(
				expect.objectContaining({
					config: expect.objectContaining({
						providerId: "cline",
						modelId: "anthropic/claude-sonnet-4.6",
						sessionId,
					}),
				}),
			);
			expect(send).not.toHaveBeenCalled();
			expect(result.result).toEqual({
				finishReason: "error",
				text: "Codex bootstrap failed",
			});

			await handleChatSessionCommand(ctx, {
				action: "send",
				sessionId,
				prompt: "continue with Cline",
				config: { ...baseConfig },
			});
			expect(send).toHaveBeenCalledOnce();
		} finally {
			if (previousKanbanDataDir === undefined) {
				delete process.env.CLINE_KANBAN_DATA_DIR;
			} else {
				process.env.CLINE_KANBAN_DATA_DIR = previousKanbanDataDir;
			}
			rmSync(testKanbanDataDir, { recursive: true, force: true });
		}
	});

	it("restores the previous provider when replacement label sync fails", async () => {
		const { ctx, send, sessionId, start, stop, updateSessionConnection } =
			createContext();
		const previousKanbanDataDir = process.env.CLINE_KANBAN_DATA_DIR;
		const testKanbanDataDir = join(
			tmpdir(),
			`cline-provider-label-rollback-${process.pid}`,
		);
		process.env.CLINE_KANBAN_DATA_DIR = testKanbanDataDir;
		try {
			updateSessionConnection
				.mockRejectedValueOnce(new Error("manifest write failed"))
				.mockResolvedValueOnce(undefined);

			const result = (await handleChatSessionCommand(ctx, {
				action: "send",
				sessionId,
				prompt: "continue with Codex",
				config: {
					...baseConfig,
					provider: "openai-codex",
					model: "gpt-5.3-codex",
				},
			})) as { result?: { finishReason?: string; text?: string } };

			expect(stop).toHaveBeenCalledTimes(2);
			expect(start).toHaveBeenCalledTimes(2);
			expect(start.mock.calls[1]?.[0]).toEqual(
				expect.objectContaining({
					config: expect.objectContaining({
						providerId: "cline",
						modelId: "anthropic/claude-sonnet-4.6",
						sessionId,
					}),
				}),
			);
			expect(updateSessionConnection).toHaveBeenNthCalledWith(2, sessionId, {
				providerId: "cline",
				modelId: "anthropic/claude-sonnet-4.6",
				thinking: true,
				reasoningEffort: "high",
				thinkingBudgetTokens: null,
			});
			expect(send).not.toHaveBeenCalled();
			expect(result.result).toEqual({
				finishReason: "error",
				text: "manifest write failed",
			});
			expect(ctx.liveSessions.get(sessionId)?.config).toEqual(baseConfig);

			await handleChatSessionCommand(ctx, {
				action: "send",
				sessionId,
				prompt: "continue with Cline",
				config: { ...baseConfig },
			});
			expect(send).toHaveBeenCalledOnce();
			expect(start).toHaveBeenCalledTimes(2);
		} finally {
			if (previousKanbanDataDir === undefined) {
				delete process.env.CLINE_KANBAN_DATA_DIR;
			} else {
				process.env.CLINE_KANBAN_DATA_DIR = previousKanbanDataDir;
			}
			rmSync(testKanbanDataDir, { recursive: true, force: true });
		}
	});

	it("refreshes hub-attached sessions even when the cached config matches", async () => {
		const { ctx, sessionId, updateSessionConnection } = createContext({
			attachedViaHub: true,
		});

		await handleChatSessionCommand(ctx, {
			action: "send",
			sessionId,
			prompt: "hello",
			config: { ...baseConfig },
		});

		expect(updateSessionConnection).toHaveBeenCalledTimes(1);
		expect(ctx.liveSessions.get(sessionId)?.attachedViaHub).toBe(false);
	});
});

describe("workspace metadata prewarming", () => {
	it("reuses one in-flight scan and consumes it only once", async () => {
		let resolveFirst: ((value: string) => void) | undefined;
		const firstResult = new Promise<string>((resolve) => {
			resolveFirst = resolve;
		});
		const load = vi
			.fn<(cwd: string) => Promise<string>>()
			.mockImplementationOnce(async () => await firstResult)
			.mockResolvedValueOnce("fresh metadata");
		const cwd = "/tmp/cline-desktop-prewarm-reuse";

		prewarmWorkspaceMetadata(cwd, load);
		const consumed = consumeWorkspaceMetadata(cwd, load);
		expect(load).toHaveBeenCalledTimes(1);
		resolveFirst?.("prewarmed metadata");

		await expect(consumed).resolves.toBe("prewarmed metadata");
		await expect(consumeWorkspaceMetadata(cwd, load)).resolves.toBe(
			"fresh metadata",
		);
		expect(load).toHaveBeenCalledTimes(2);
	});

	it("evicts failed scans so the next session can retry", async () => {
		const load = vi
			.fn<(cwd: string) => Promise<string>>()
			.mockRejectedValueOnce(new Error("git unavailable"))
			.mockResolvedValueOnce("recovered metadata");
		const cwd = "/tmp/cline-desktop-prewarm-retry";

		prewarmWorkspaceMetadata(cwd, load);
		await expect(consumeWorkspaceMetadata(cwd, load)).rejects.toThrow(
			"git unavailable",
		);
		await expect(consumeWorkspaceMetadata(cwd, load)).resolves.toBe(
			"recovered metadata",
		);
		expect(load).toHaveBeenCalledTimes(2);
	});

	it("keeps different workspaces in separate single-flight entries", () => {
		const load = vi.fn(async (cwd: string) => `metadata for ${cwd}`);

		prewarmWorkspaceMetadata("/tmp/cline-desktop-prewarm-a", load);
		prewarmWorkspaceMetadata("/tmp/cline-desktop-prewarm-b", load);

		expect(load).toHaveBeenCalledTimes(2);
	});

	it("refreshes a prewarm that is older than the startup window", async () => {
		const load = vi
			.fn<(cwd: string) => Promise<string>>()
			.mockResolvedValueOnce("startup metadata")
			.mockResolvedValueOnce("current metadata");
		const cwd = "/tmp/cline-desktop-prewarm-expired";

		prewarmWorkspaceMetadata(cwd, load, () => 0);
		await expect(
			consumeWorkspaceMetadata(
				cwd,
				load,
				() => WORKSPACE_METADATA_PREWARM_TTL_MS + 1,
			),
		).resolves.toBe("current metadata");
		expect(load).toHaveBeenCalledTimes(2);
	});
});

describe("cloud handoff gates", () => {
	beforeEach(() => {
		enableCloudHandoffGates();
	});

	it("blocks handoff actions when the rollout flag is off", async () => {
		const { ctx, sessionId } = createHandoffGateContext({ busy: false });

		process.env.CLINE_CODE_CLOUD_HANDOFF = "0";
		await expect(
			handleChatSessionCommand(ctx, {
				action: "prepare_handoff",
				sessionId,
			}),
		).rejects.toThrow("Cloud handoff is not enabled for this account.");
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
		).rejects.toThrow("Cloud handoff is not enabled for this account.");
		expect(ctx.cloudSessionManager).toBeFalsy();
	});

	it("exempts a persisted pending handoff from the rollout flag gate", async () => {
		process.env.CLINE_CODE_CLOUD_HANDOFF = "0";
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

		await expect(recovery).rejects.not.toThrow("Cloud handoff is not enabled");
		await expect(recovery).rejects.toThrow(
			"Start a conversation before handing it off to cloud.",
		);
	});

	it("keeps the rollout flag gate for sessions without a pending handoff", async () => {
		process.env.CLINE_CODE_CLOUD_HANDOFF = "0";
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
		).rejects.toThrow("Cloud handoff is not enabled for this account.");
	});

	it("blocks new handoffs when the Cloud sessions opt-in is off", async () => {
		// The rollout flag is on (suite setup), but the user has not opted in:
		// a handoff uploads the local transcript and needs that consent.
		writeDesktopSettings({ cloudSessionsEnabled: false });
		const { ctx, sessionId } = createHandoffGateContext({ busy: false });

		await expect(
			handleChatSessionCommand(ctx, {
				action: "prepare_handoff",
				sessionId,
			}),
		).rejects.toThrow(
			"Enable Cloud sessions in Settings before using cloud handoff.",
		);
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
		).rejects.toThrow(
			"Enable Cloud sessions in Settings before using cloud handoff.",
		);
		expect(ctx.cloudSessionManager).toBeFalsy();
	});

	it("lets new handoffs proceed when the flag and opt-in are both on", async () => {
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

		await expect(attempt).rejects.not.toThrow("Enable Cloud sessions");
		await expect(attempt).rejects.not.toThrow("Cloud handoff is not enabled");
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

		expect(message).toContain("delete it before retrying /handoff");
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
			reconcilePendingCloudHandoff(
				{ update: vi.fn() } as never,
				{ handoffTargetExists },
				{
					sourceSessionId: "local-1",
					metadata: { workspace: "preserved" },
					fingerprint: changedFingerprint,
					appBaseUrl: "not a valid URL",
				},
			),
		).resolves.toEqual({
			metadata: { workspace: "preserved" },
			pending: undefined,
		});
		expect(handoffTargetExists).not.toHaveBeenCalled();
	});

	it("preserves a mismatched pending handoff while its target exists", async () => {
		const update = vi.fn();
		await expect(
			reconcilePendingCloudHandoff(
				{ update } as never,
				{ handoffTargetExists: vi.fn(async () => true) },
				{
					sourceSessionId: "local-1",
					metadata: pendingMetadata,
					pending: pendingMetadata.handoff,
					fingerprint: changedFingerprint,
					appBaseUrl: "https://app.cline.bot",
				},
			),
		).rejects.toThrow("still pending for a different");
		expect(update).not.toHaveBeenCalled();
	});

	it("preserves a mismatched pending handoff when it is invisible to the current account", async () => {
		const update = vi.fn();
		await expect(
			reconcilePendingCloudHandoff(
				{ update } as never,
				{ handoffTargetExists: vi.fn(async () => false) },
				{
					sourceSessionId: "local-1",
					metadata: pendingMetadata,
					pending: pendingMetadata.handoff,
					fingerprint: changedFingerprint,
					appBaseUrl: "https://app.cline.bot",
				},
			),
		).rejects.toThrow("not visible from the current account");
		expect(update).not.toHaveBeenCalled();
	});

	it("preserves pending lineage when target lookup is uncertain", async () => {
		const update = vi.fn();
		await expect(
			reconcilePendingCloudHandoff(
				{ update } as never,
				{
					handoffTargetExists: vi.fn(async () => {
						throw new Error("network unavailable");
					}),
				},
				{
					sourceSessionId: "local-1",
					metadata: pendingMetadata,
					pending: pendingMetadata.handoff,
					fingerprint: changedFingerprint,
					appBaseUrl: "https://app.cline.bot",
				},
			),
		).rejects.toThrow("network unavailable");
		expect(update).not.toHaveBeenCalled();
	});

	it("does not clear gone lineage before proving the current account owns it", async () => {
		const update = vi.fn(async () => ({ updated: false }));
		await expect(
			reconcilePendingCloudHandoff(
				{ update } as never,
				{ handoffTargetExists: vi.fn(async () => false) },
				{
					sourceSessionId: "local-1",
					metadata: pendingMetadata,
					pending: pendingMetadata.handoff,
					fingerprint: changedFingerprint,
					appBaseUrl: "https://app.cline.bot",
				},
			),
		).rejects.toThrow("not visible from the current account");
		expect(update).not.toHaveBeenCalled();
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
			sessionManager: {
				get: vi.fn(async () => ({
					sessionId,
					status:
						options.persistedStatus ?? (options.busy ? "running" : "completed"),
					cwd: "/workspace/project",
					model: "anthropic/claude-sonnet-4.6",
					metadata: options.metadata,
				})),
				readLiveMessages: vi.fn(async () => messages),
				send,
				pendingPrompts: { list: vi.fn(async () => []) },
			},
		} as unknown as SidecarContext;
		return { ctx, send, sessionId };
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

	it("completes a fresh handoff end to end", async () => {
		const sourceSessionId = "local-handoff-source";
		const modelId = "anthropic/claude-sonnet-4.6";
		const headSha = "a".repeat(40);
		vi.mocked(preflightCloudHandoffGit).mockResolvedValue({
			repoUrl: "https://github.com/cline/test",
			branch: "main",
			remoteName: "origin",
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
					: new Response("not found", { status: 404 }),
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
		let persistedMetadata: Record<string, unknown> = {};
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
			sessionManager: {
				get: vi.fn(async () => ({
					sessionId: sourceSessionId,
					status: "completed",
					cwd: "/workspace/project",
					model: modelId,
					metadata: persistedMetadata,
				})),
				readLiveMessages: vi.fn(async () => messages),
				update: vi.fn(
					async (_id: string, input: { metadata: Record<string, unknown> }) => {
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
					onOuterSessionCreated?: (id: string) => Promise<void>;
					resolveMessages: () => Promise<unknown>;
					onSeeding?: () => void;
				};
			}) => {
				await input.handoff?.onOuterSessionCreated?.("ses-cloud");
				await input.handoff?.resolveMessages();
				input.handoff?.onSeeding?.();
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
		expect(metadataUpdates).toHaveLength(2);
		expect(readCloudHandoffMetadata(persistedMetadata)).toMatchObject({
			status: "complete",
			toCloudSessionId: "ses-cloud",
			innerSessionId: "inner-cloud",
			dashboardUrl: result.dashboardUrl,
		});
		expect(verifyHandoffTranscript).toHaveBeenCalledWith(
			"ses-cloud",
			messages,
			{ allowAppendedMessages: false },
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

	// Mirrors the fresh end-to-end handoff above, but with a follow-up command
	// whose queueing fails with the given error.
	async function runHandoffWithFailingFollowUp(sendError: Error): Promise<{
		cloudSend: ReturnType<typeof vi.fn>;
		result: { sessionId: string; warning?: string; warningKind?: string };
		completeEvent: Record<string, unknown> | undefined;
	}> {
		const sourceSessionId = "local-handoff-source";
		const modelId = "anthropic/claude-sonnet-4.6";
		const headSha = "a".repeat(40);
		vi.mocked(preflightCloudHandoffGit).mockResolvedValue({
			repoUrl: "https://github.com/cline/test",
			branch: "main",
			remoteName: "origin",
			headSha,
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: unknown) =>
				String(input).endsWith("/api/v1/ai/cline/models")
					? new Response(
							JSON.stringify({ data: [{ id: modelId, name: "Sonnet" }] }),
							{ status: 200, headers: { "content-type": "application/json" } },
						)
					: new Response("not found", { status: 404 }),
			),
		);

		const messages = [
			{ role: "user" as const, content: "continue this work" },
			{ role: "assistant" as const, content: "done locally" },
		];
		const events: Array<{ name: string; payload: Record<string, unknown> }> =
			[];
		let persistedMetadata: Record<string, unknown> = {};
		const ctx = {
			liveSessions: new Map([
				[
					sourceSessionId,
					{
						config: {
							cwd: "/workspace/project",
							provider: "cline",
							model: modelId,
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
					},
				},
			]),
			sessionManager: {
				get: vi.fn(async () => ({
					sessionId: sourceSessionId,
					status: "completed",
					cwd: "/workspace/project",
					model: modelId,
					metadata: persistedMetadata,
				})),
				readLiveMessages: vi.fn(async () => messages),
				update: vi.fn(
					async (_id: string, input: { metadata: Record<string, unknown> }) => {
						persistedMetadata = input.metadata;
						return { updated: true };
					},
				),
				pendingPrompts: { list: vi.fn(async () => []) },
			},
		} as unknown as SidecarContext;

		const cloudSend = vi.fn(async () => {
			throw sendError;
		});
		const cloud = new CloudSessionManager(ctx, {
			api: {} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
		});
		Object.assign(cloud, {
			prepareHandoffRepository: vi.fn(async () => ({})),
			create: vi.fn(
				async (input: {
					handoff?: {
						onOuterSessionCreated?: (id: string) => Promise<void>;
						resolveMessages: () => Promise<unknown>;
						onSeeding?: () => void;
					};
				}) => {
					await input.handoff?.onOuterSessionCreated?.("ses-cloud");
					await input.handoff?.resolveMessages();
					input.handoff?.onSeeding?.();
					return { sessionId: "ses-cloud", innerSessionId: "inner-cloud" };
				},
			),
			verifyHandoffTranscript: vi.fn(async () => undefined),
			send: cloudSend,
		});
		ctx.cloudSessionManager = cloud;

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

describe("runtime slash command expansion on send", () => {
	const tempRoots: string[] = [];

	afterEach(() => {
		for (const dir of tempRoots) {
			rmSync(dir, { recursive: true, force: true });
		}
		tempRoots.length = 0;
	});

	function createWorkspaceWithSkill(): string {
		const workspace = mkdtempSync(join(tmpdir(), "desktop-slash-send-"));
		tempRoots.push(workspace);
		const skillDir = join(workspace, ".cline", "skills", "desktop-send-skill");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(skillDir, "SKILL.md"),
			`---
name: desktop-send-skill
---
Follow the desktop send skill instructions.`,
		);
		const workflowsDir = join(workspace, ".cline", "workflows");
		mkdirSync(workflowsDir, { recursive: true });
		writeFileSync(
			join(workflowsDir, "desktop-send-workflow.md"),
			`---
name: desktop-send-workflow
---
Follow the desktop send workflow instructions.`,
		);
		return workspace;
	}

	function createContext(workspace: string) {
		const sessionId = "slash-expansion-session";
		const send = vi.fn(async (_input?: unknown) => ({
			text: "done",
			finishReason: "completed",
			messages: [],
		}));
		const session = {
			config: { provider: "cline", model: "test-model", cwd: workspace },
			messages: [],
			promptsInQueue: [],
			busy: false,
			startedAt: Date.now(),
			status: "idle",
			prompt: undefined as string | undefined,
		};
		const updatePendingPrompt = vi.fn(
			async (input: { promptId: string; prompt?: string }) => ({
				updated: true,
				prompt: { id: input.promptId, prompt: input.prompt },
				prompts: [],
			}),
		);
		const ctx = {
			workspaceRoot: workspace,
			liveSessions: new Map([[sessionId, session]]),
			restoringWorkspacePaths: new Set(),
			streamIndices: new Map(),
			wsClients: new Set(),
			sessionManager: {
				send,
				pendingPrompts: {
					list: vi.fn(async () => []),
					update: updatePendingPrompt,
				},
			},
		} as unknown as SidecarContext;
		return { ctx, send, session, sessionId, updatePendingPrompt };
	}

	it("sends a skill command through as typed for the skills tool", async () => {
		const workspace = createWorkspaceWithSkill();
		const { ctx, send, session, sessionId } = createContext(workspace);

		await handleChatSessionCommand(ctx, {
			action: "send",
			sessionId,
			prompt: "/desktop-send-skill write the docs",
		});

		// Skills are not expanded into the user message: the runtime's skills
		// tool loads the instructions, and the persisted transcript keeps the
		// typed command.
		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({
				prompt: "/desktop-send-skill write the docs",
			}),
		);
		expect(session.prompt).toBe("/desktop-send-skill write the docs");
	});

	it("expands a skill command in yolo mode, where the skills tool is unavailable", async () => {
		const workspace = createWorkspaceWithSkill();
		const { ctx, send, session, sessionId } = createContext(workspace);
		(session.config as Record<string, unknown>).mode = "yolo";

		await handleChatSessionCommand(ctx, {
			action: "send",
			sessionId,
			prompt: "/desktop-send-skill write the docs",
		});

		// The yolo preset has no skills tool, so textual expansion is the only
		// way the instructions reach the model.
		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({
				prompt: "Follow the desktop send skill instructions. write the docs",
			}),
		);
	});

	it("expands a leading workflow command into its instructions", async () => {
		const workspace = createWorkspaceWithSkill();
		const { ctx, send, session, sessionId } = createContext(workspace);

		await handleChatSessionCommand(ctx, {
			action: "send",
			sessionId,
			prompt: "/desktop-send-workflow ship it",
		});

		// Workflows are not served by the skills tool, so they keep textual
		// expansion.
		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({
				prompt: "Follow the desktop send workflow instructions. ship it",
			}),
		);
		// The session's display prompt keeps the raw token.
		expect(session.prompt).toBe("/desktop-send-workflow ship it");
	});

	it("keeps a skill command as typed when a queued prompt is edited", async () => {
		const workspace = createWorkspaceWithSkill();
		const { ctx, sessionId, updatePendingPrompt } = createContext(workspace);

		await handleChatSessionCommand(ctx, {
			action: "update_pending_prompt",
			sessionId,
			promptId: "queued-1",
			prompt: "/desktop-send-skill later please",
		});

		expect(updatePendingPrompt).toHaveBeenCalledWith({
			sessionId,
			promptId: "queued-1",
			prompt: "/desktop-send-skill later please",
		});
	});

	it("expands a workflow command when a queued prompt is edited", async () => {
		const workspace = createWorkspaceWithSkill();
		const { ctx, sessionId, updatePendingPrompt } = createContext(workspace);

		await handleChatSessionCommand(ctx, {
			action: "update_pending_prompt",
			sessionId,
			promptId: "queued-2",
			prompt: "/desktop-send-workflow later please",
		});

		expect(updatePendingPrompt).toHaveBeenCalledWith({
			sessionId,
			promptId: "queued-2",
			prompt: "Follow the desktop send workflow instructions. later please",
		});
	});

	it("rewrites a team command when a queued prompt is edited", async () => {
		const workspace = createWorkspaceWithSkill();
		const { ctx, sessionId, updatePendingPrompt } = createContext(workspace);

		await handleChatSessionCommand(ctx, {
			action: "update_pending_prompt",
			sessionId,
			promptId: "queued-team",
			prompt: "/team inspect the app",
		});

		expect(updatePendingPrompt).toHaveBeenCalledWith({
			sessionId,
			promptId: "queued-team",
			prompt:
				'<user_command slash="team">spawn a team of agents for the following task: inspect the app</user_command>',
		});
	});

	it("expands a user /handoff workflow while the feature gate is off", async () => {
		const workspace = createWorkspaceWithSkill();
		const workflowsDir = join(workspace, ".cline", "workflows");
		writeFileSync(
			join(workflowsDir, "handoff.md"),
			`---
name: handoff
---
Follow the user handoff workflow instructions.`,
		);
		const { ctx, send, sessionId } = createContext(workspace);

		// Gate off (default in tests): the user's workflow owns /handoff.
		await handleChatSessionCommand(ctx, {
			action: "send",
			sessionId,
			prompt: "/handoff please",
		});
		expect(send).toHaveBeenLastCalledWith(
			expect.objectContaining({
				prompt: "Follow the user handoff workflow instructions. please",
			}),
		);

		// Gate on: /handoff is built-in again and passes through untouched.
		enableCloudHandoffGates();
		await handleChatSessionCommand(ctx, {
			action: "send",
			sessionId,
			prompt: "/handoff please",
		});
		expect(send).toHaveBeenLastCalledWith(
			expect.objectContaining({ prompt: "/handoff please" }),
		);
	});

	it("leaves built-in and unknown slash commands untouched", async () => {
		const workspace = createWorkspaceWithSkill();
		const { ctx, send, sessionId } = createContext(workspace);

		await handleChatSessionCommand(ctx, {
			action: "send",
			sessionId,
			prompt: "/fork",
		});
		expect(send).toHaveBeenLastCalledWith(
			expect.objectContaining({ prompt: "/fork" }),
		);

		await handleChatSessionCommand(ctx, {
			action: "send",
			sessionId,
			prompt: "/not-a-real-command hello",
		});
		expect(send).toHaveBeenLastCalledWith(
			expect.objectContaining({ prompt: "/not-a-real-command hello" }),
		);
	});
});
