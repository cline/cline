import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as LlmsProviders from "@clinebot/llms";
import type { AgentResult } from "@clinebot/shared";
import { setClineDir, setHomeDir } from "@clinebot/shared/storage";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { splitCoreSessionConfig } from "../runtime/host/runtime-host";
import type { SessionManifest } from "../session/models/session-manifest";
import type { SessionRow } from "../session/models/session-row";
import type { RootSessionArtifacts } from "../session/services/session-service";
import type { SessionSource, SessionStatus } from "../types/common";
import { LocalRuntimeHost as RuntimeHostUnderTest } from "./local";

function nowIso(): string {
	return new Date().toISOString();
}

function createResult(overrides: Partial<AgentResult> = {}): AgentResult {
	return {
		text: "ok",
		iterations: 1,
		finishReason: "completed",
		usage: {
			inputTokens: 1,
			outputTokens: 2,
			totalCost: 0,
		},
		messages: [],
		toolCalls: [],
		durationMs: 1,
		model: {
			id: "mock-model",
			provider: "mock-provider",
		},
		startedAt: new Date("2026-01-01T00:00:00.000Z"),
		endedAt: new Date("2026-01-01T00:00:01.000Z"),
		...overrides,
	};
}

class LocalFileSessionService {
	private readonly rows = new Map<string, SessionRow>();

	constructor(private readonly sessionsDir: string) {}

	ensureSessionsDir(): string {
		mkdirSync(this.sessionsDir, { recursive: true });
		return this.sessionsDir;
	}

	createRootSessionWithArtifacts(input: {
		sessionId: string;
		source: SessionSource;
		pid: number;
		interactive: boolean;
		provider: string;
		model: string;
		cwd: string;
		workspaceRoot: string;
		teamName?: string;
		enableTools: boolean;
		enableSpawn: boolean;
		enableTeams: boolean;
		prompt?: string;
		startedAt?: string;
	}): RootSessionArtifacts {
		const startedAt = input.startedAt ?? nowIso();
		const sessionId = input.sessionId.trim() || `${Date.now()}_${nanoid(5)}`;
		const sessionPath = join(this.sessionsDir, sessionId);
		mkdirSync(sessionPath, { recursive: true });

		const manifestPath = join(sessionPath, `${sessionId}.json`);
		const messagesPath = join(sessionPath, `${sessionId}.messages.json`);
		const prompt = input.prompt?.trim() || undefined;
		const manifest: SessionManifest = {
			version: 1,
			session_id: sessionId,
			source: input.source,
			pid: input.pid,
			started_at: startedAt,
			status: "running",
			interactive: input.interactive,
			provider: input.provider,
			model: input.model,
			cwd: input.cwd,
			workspace_root: input.workspaceRoot,
			team_name: input.teamName,
			enable_tools: input.enableTools,
			enable_spawn: input.enableSpawn,
			enable_teams: input.enableTeams,
			prompt,
			messages_path: messagesPath,
		};
		writeFileSync(
			manifestPath,
			`${JSON.stringify(manifest, null, 2)}\n`,
			"utf8",
		);
		writeFileSync(
			messagesPath,
			`${JSON.stringify({ version: 1, updated_at: startedAt, messages: [] }, null, 2)}\n`,
			"utf8",
		);

		this.rows.set(sessionId, {
			sessionId,
			source: input.source,
			pid: input.pid,
			startedAt,
			endedAt: null,
			exitCode: null,
			status: "running",
			statusLock: 0,
			interactive: input.interactive,
			provider: input.provider,
			model: input.model,
			cwd: input.cwd,
			workspaceRoot: input.workspaceRoot,
			teamName: input.teamName ?? null,
			enableTools: input.enableTools,
			enableSpawn: input.enableSpawn,
			enableTeams: input.enableTeams,
			parentSessionId: null,
			parentAgentId: null,
			agentId: null,
			conversationId: null,
			isSubagent: false,
			prompt: prompt ?? null,
			hookPath: "",
			messagesPath,
			updatedAt: startedAt,
		});

		return {
			manifestPath,
			messagesPath,
			manifest,
		};
	}

	persistSessionMessages(
		sessionId: string,
		messages: LlmsProviders.Message[],
		systemPrompt?: string,
	): void {
		const row = this.rows.get(sessionId);
		if (!row?.messagesPath) {
			throw new Error(`session not found: ${sessionId}`);
		}
		const payload: {
			version: number;
			updated_at: string;
			systemPrompt?: string;
			messages: LlmsProviders.Message[];
		} = { version: 1, updated_at: nowIso(), messages };
		if (systemPrompt !== undefined && systemPrompt !== "") {
			payload.systemPrompt = systemPrompt;
		}
		writeFileSync(
			row.messagesPath,
			`${JSON.stringify(payload, null, 2)}\n`,
			"utf8",
		);
	}

	updateSessionStatus(
		sessionId: string,
		status: SessionStatus,
		exitCode?: number | null,
	): { updated: boolean; endedAt?: string } {
		const row = this.rows.get(sessionId);
		if (!row) {
			return { updated: false };
		}
		const endedAt = nowIso();
		row.status = status;
		row.endedAt = endedAt;
		row.exitCode = typeof exitCode === "number" ? exitCode : null;
		row.updatedAt = endedAt;
		row.statusLock = row.statusLock + 1;
		return { updated: true, endedAt };
	}

	writeSessionManifest(manifestPath: string, manifest: SessionManifest): void {
		writeFileSync(
			manifestPath,
			`${JSON.stringify(manifest, null, 2)}\n`,
			"utf8",
		);
	}

	listSessions(limit = 200): SessionRow[] {
		return Array.from(this.rows.values()).slice(0, limit);
	}

	deleteSession(sessionId: string): { deleted: boolean } {
		const row = this.rows.get(sessionId);
		if (!row) {
			return { deleted: false };
		}
		this.rows.delete(sessionId);
		unlinkSync(row.messagesPath ?? "");
		unlinkSync(join(this.sessionsDir, sessionId, `${sessionId}.json`));
		return { deleted: true };
	}
}

describe("LocalRuntimeHost e2e", () => {
	const envSnapshot = {
		HOME: process.env.HOME,
		CLINE_DIR: process.env.CLINE_DIR,
	};
	const tempDirs: string[] = [];
	let isolatedHomeDir = "";

	beforeEach(() => {
		isolatedHomeDir = mkdtempSync(join(tmpdir(), "core-session-home-"));
		process.env.HOME = isolatedHomeDir;
		process.env.CLINE_DIR = join(isolatedHomeDir, ".cline");
		setHomeDir(isolatedHomeDir);
		setClineDir(process.env.CLINE_DIR);
	});

	afterEach(() => {
		process.env.HOME = envSnapshot.HOME;
		process.env.CLINE_DIR = envSnapshot.CLINE_DIR;
		setHomeDir(envSnapshot.HOME ?? "~");
		setClineDir(envSnapshot.CLINE_DIR ?? join("~", ".cline"));
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
		rmSync(isolatedHomeDir, { recursive: true, force: true });
	});

	it("runs an interactive lifecycle with real artifact files", async () => {
		const sessionsDir = mkdtempSync(join(tmpdir(), "core-e2e-sessions-"));
		tempDirs.push(sessionsDir);

		const sessionService = new LocalFileSessionService(sessionsDir);
		const runtimeShutdown = vi.fn();
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: runtimeShutdown,
			}),
		};

		let messages: LlmsProviders.Message[] = [];
		let turn = 0;
		const run = vi.fn(async (prompt: string) => {
			turn += 1;
			messages = [
				...messages,
				{
					role: "user",
					content: [{ type: "text", text: prompt }],
				},
				{
					role: "assistant",
					content: [{ type: "text", text: `reply:${turn}:${prompt}` }],
				},
			] as LlmsProviders.Message[];
			return createResult({
				text: `reply:${turn}:${prompt}`,
				messages: [...messages],
			});
		});
		const continueFn = vi.fn(async (prompt: string) => {
			turn += 1;
			messages = [
				...messages,
				{
					role: "user",
					content: [{ type: "text", text: prompt }],
				},
				{
					role: "assistant",
					content: [{ type: "text", text: `reply:${turn}:${prompt}` }],
				},
			] as LlmsProviders.Message[];
			return createResult({
				text: `reply:${turn}:${prompt}`,
				messages: [...messages],
			});
		});
		const agentShutdown = vi.fn().mockResolvedValue(undefined);

		const manager = new RuntimeHostUnderTest({
			distinctId: `test-${nanoid(5)}`,
			sessionService: sessionService as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent: () =>
				({
					run,
					continue: continueFn,
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-e2e-1"),
					getConversationId: vi.fn().mockReturnValue("conv-e2e-1"),
					restore: vi.fn((baseline: LlmsProviders.Message[]) => {
						messages = [...baseline];
					}),
					updateConnection: vi.fn(),
					shutdown: agentShutdown,
					getMessages: vi.fn(() => [...messages]),
					messages: [],
				}) as never,
		});

		const started = await manager.start({
			interactive: true,
			...splitCoreSessionConfig({
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: "test-key",
				cwd: sessionsDir,
				systemPrompt: "You are a test agent",
				mode: "act",
				enableTools: false,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			}),
		});

		expect(started.sessionId.length).toBeGreaterThan(0);
		expect(existsSync(started.manifestPath)).toBe(false);
		expect(existsSync(started.messagesPath)).toBe(false);

		const first = await manager.send({
			sessionId: started.sessionId,
			prompt: "first prompt",
		});
		const second = await manager.send({
			sessionId: started.sessionId,
			prompt: "second prompt",
		});
		expect(existsSync(started.manifestPath)).toBe(true);
		expect(existsSync(started.messagesPath)).toBe(true);

		expect(first?.text).toContain("first prompt");
		expect(second?.text).toContain("second prompt");
		expect(run).toHaveBeenCalledTimes(1);
		expect(continueFn).toHaveBeenCalledTimes(1);

		const persistedMessages = await manager.readMessages(started.sessionId);
		expect(persistedMessages.length).toBeGreaterThan(0);
		expect(JSON.stringify(persistedMessages)).toContain("second prompt");

		const listed = await manager.list(20);
		expect(
			listed.some((session) => session.sessionId === started.sessionId),
		).toBe(true);

		await manager.stop(started.sessionId);
		const stopped = await manager.get(started.sessionId);
		expect(stopped?.status).toBe("cancelled");
		expect(stopped?.exitCode).toBe(0);
		expect(agentShutdown).toHaveBeenCalledTimes(1);
		expect(runtimeShutdown).toHaveBeenCalledTimes(1);
		const parsedManifest = JSON.parse(
			readFileSync(started.manifestPath, "utf8"),
		) as SessionManifest;
		expect(parsedManifest.status).toBe("cancelled");

		const deleted = await manager.delete(started.sessionId);
		expect(deleted).toBe(true);
		expect(await manager.get(started.sessionId)).toBeUndefined();
		expect(existsSync(started.manifestPath)).toBe(false);
		expect(existsSync(started.messagesPath)).toBe(false);
	});

	it("persists replayable assistant content blocks with turn metadata in messages artifacts", async () => {
		const sessionsDir = mkdtempSync(
			join(tmpdir(), "core-e2e-messages-contract-"),
		);
		tempDirs.push(sessionsDir);

		const sessionService = new LocalFileSessionService(sessionsDir);
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn(),
			}),
		};

		const assistantToolUseId = "tool-call-1";
		const run = vi.fn(async (prompt: string) =>
			createResult({
				text: "done",
				usage: {
					inputTokens: 21,
					outputTokens: 8,
					cacheReadTokens: 3,
					cacheWriteTokens: 1,
					totalCost: 0.13,
				},
				model: {
					id: "claude-sonnet-4-6",
					provider: "anthropic",
					info: {
						id: "claude-sonnet-4-6",
						family: "claude-sonnet-4",
					},
				},
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: prompt }],
					},
					{
						role: "assistant",
						content: [
							{ type: "thinking", thinking: "Need to inspect files first." },
							{
								type: "tool_use",
								id: assistantToolUseId,
								name: "read_files",
								input: { path: "/tmp/project/README.md" },
							},
						],
						// Per-turn metrics stamped by agent.ts at append time (turn 1).
						metrics: {
							inputTokens: 15,
							outputTokens: 6,
							cacheReadTokens: 2,
							cacheWriteTokens: 1,
							cost: 0.07,
						},
					},
					{
						role: "user",
						content: [
							{
								type: "tool_result",
								tool_use_id: assistantToolUseId,
								content: "README content",
							},
						],
					},
					{
						role: "assistant",
						content: [{ type: "text", text: "I found the relevant section." }],
						// Per-turn metrics stamped by agent.ts at append time (turn 2).
						metrics: {
							inputTokens: 21,
							outputTokens: 8,
							cacheReadTokens: 3,
							cacheWriteTokens: 1,
							cost: 0.13,
						},
					},
				] satisfies LlmsProviders.MessageWithMetadata[] as LlmsProviders.Message[],
			}),
		);

		const manager = new RuntimeHostUnderTest({
			distinctId: `test-${nanoid(5)}`,
			sessionService: sessionService as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent: () =>
				({
					run,
					continue: vi.fn(),
					abort: vi.fn(),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-e2e-artifacts"),
					getConversationId: vi.fn().mockReturnValue("conv-e2e-artifacts"),
					restore: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					updateConnection: vi.fn(),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		const started = await manager.start({
			interactive: false,
			...splitCoreSessionConfig({
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: "test-key",
				cwd: sessionsDir,
				systemPrompt: "You are a test agent",
				mode: "act",
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			}),
		});

		await manager.send({
			sessionId: started.sessionId,
			prompt: "Inspect the README",
		});

		const payload = JSON.parse(readFileSync(started.messagesPath, "utf8")) as {
			messages?: Array<Record<string, unknown>>;
		};
		const persisted = payload.messages ?? [];
		expect(persisted).toHaveLength(4);

		const firstAssistant = persisted[1] as {
			role: string;
			content: Array<{ type: string }>;
			modelInfo?: { id?: string; provider?: string };
			metrics?: Record<string, unknown>;
		};
		const toolResultUser = persisted[2] as {
			role: string;
			content: Array<{ type: string; tool_use_id?: string }>;
		};
		const terminalAssistant = persisted[3] as {
			role: string;
			content: Array<{ type: string; text?: string }>;
			modelInfo?: { id?: string; provider?: string };
			metrics?: {
				inputTokens?: number;
				outputTokens?: number;
				cacheReadTokens?: number;
				cacheWriteTokens?: number;
				cost?: number;
			};
		};

		expect(firstAssistant.role).toBe("assistant");
		expect(firstAssistant.content[0]?.type).toBe("thinking");
		expect(firstAssistant.content[1]?.type).toBe("tool_use");
		expect(firstAssistant.modelInfo).toMatchObject({
			id: "claude-sonnet-4-6",
			provider: "anthropic",
		});
		// Per-turn metrics are stamped by agent.ts at append time and
		// preserved by withLatestAssistantTurnMetadata. Each assistant message
		// should carry its own turn's usage, not the session total.
		expect(firstAssistant.metrics).toMatchObject({
			inputTokens: 15,
			outputTokens: 6,
			cacheReadTokens: 2,
			cacheWriteTokens: 1,
			cost: 0.07,
		});

		expect(toolResultUser.role).toBe("user");
		expect(toolResultUser.content[0]?.type).toBe("tool_result");
		expect(toolResultUser.content[0]?.tool_use_id).toBe(assistantToolUseId);

		expect(terminalAssistant.role).toBe("assistant");
		expect(terminalAssistant.content[0]?.type).toBe("text");
		expect(terminalAssistant.modelInfo).toMatchObject({
			id: "claude-sonnet-4-6",
			provider: "anthropic",
		});
		expect(terminalAssistant.metrics).toMatchObject({
			inputTokens: 21,
			outputTokens: 8,
			cacheReadTokens: 3,
			cacheWriteTokens: 1,
			cost: 0.13,
		});
	});
});
