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
import type * as LlmsProviders from "@cline/llms";
import type { AgentResult } from "@cline/shared";
import { setClineDir, setHomeDir } from "@cline/shared/storage";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveTitleFromPrompt } from "../../services/session-data";
import type { SessionManifest } from "../../session/models/session-manifest";
import type { SessionRow } from "../../session/models/session-row";
import type { RootSessionArtifacts } from "../../session/services/session-service";
import type { SessionSource, SessionStatus } from "../../types/common";
import { listSessionHistory } from "./history";
import { LocalRuntimeHost as RuntimeHostUnderTest } from "./local-runtime-host";
import { splitCoreSessionConfig } from "./runtime-host";

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
		metadata?: Record<string, unknown>;
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
			metadata: input.metadata,
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
			metadata: input.metadata ?? null,
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

	readSessionManifest(sessionId: string): SessionManifest | undefined {
		const manifestPath = join(this.sessionsDir, sessionId, `${sessionId}.json`);
		try {
			return JSON.parse(readFileSync(manifestPath, "utf8")) as SessionManifest;
		} catch {
			return undefined;
		}
	}

	// Mirrors the real persistence-service contract: updates land in both the
	// session row and the on-disk manifest, an explicit title wins, an
	// existing title is preserved, and an untitled row is titled from the
	// prompt exactly like the create path.
	updateSession(input: {
		sessionId: string;
		prompt?: string | null;
		metadata?: Record<string, unknown> | null;
		title?: string | null;
	}): { updated: boolean } {
		const row = this.rows.get(input.sessionId);
		if (!row) return { updated: false };
		if (input.prompt !== undefined) {
			row.prompt = input.prompt ?? null;
		}
		const existingTitle =
			typeof row.metadata?.title === "string" ? row.metadata.title : undefined;
		const metadata = {
			...((input.metadata !== undefined ? input.metadata : row.metadata) ?? {}),
		} as Record<string, unknown>;
		const nextTitle =
			input.title !== undefined
				? (input.title ?? undefined)
				: (existingTitle ?? deriveTitleFromPrompt(input.prompt));
		if (nextTitle) {
			metadata.title = nextTitle;
		} else {
			delete metadata.title;
		}
		row.metadata = Object.keys(metadata).length > 0 ? metadata : null;
		const manifest = this.readSessionManifest(input.sessionId);
		if (manifest) {
			if (input.prompt !== undefined) {
				manifest.prompt = input.prompt ?? undefined;
			}
			manifest.metadata = row.metadata ?? undefined;
			this.writeSessionManifest(
				join(this.sessionsDir, input.sessionId, `${input.sessionId}.json`),
				manifest,
			);
		}
		return { updated: true };
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

		const started = await manager.startSession({
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

		const first = await manager.runTurn({
			sessionId: started.sessionId,
			prompt: "first prompt",
		});
		const second = await manager.runTurn({
			sessionId: started.sessionId,
			prompt: "second prompt",
		});
		expect(existsSync(started.manifestPath)).toBe(true);
		expect(existsSync(started.messagesPath)).toBe(true);

		expect(first?.text).toContain("first prompt");
		expect(second?.text).toContain("second prompt");
		expect(run).toHaveBeenCalledTimes(1);
		expect(continueFn).toHaveBeenCalledTimes(1);

		const persistedMessages = await manager.readSessionMessages(
			started.sessionId,
		);
		expect(persistedMessages.length).toBeGreaterThan(0);
		expect(JSON.stringify(persistedMessages)).toContain("second prompt");

		const listed = await manager.listSessions(20);
		expect(
			listed.some((session) => session.sessionId === started.sessionId),
		).toBe(true);

		await manager.stopSession(started.sessionId);
		const stopped = await manager.getSession(started.sessionId);
		expect(stopped?.status).toBe("completed");
		expect(stopped?.exitCode).toBe(0);
		expect(agentShutdown).toHaveBeenCalledTimes(1);
		expect(runtimeShutdown).toHaveBeenCalledTimes(1);
		const parsedManifest = JSON.parse(
			readFileSync(started.manifestPath, "utf8"),
		) as SessionManifest;
		expect(parsedManifest.status).toBe("completed");

		const deleted = await manager.deleteSession(started.sessionId);
		expect(deleted).toBe(true);
		expect(await manager.getSession(started.sessionId)).toBeUndefined();
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
								name: "tool",
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

		const started = await manager.startSession({
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

		await manager.runTurn({
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

	// Regression guard for the "cancel a turn, lose the whole conversation"
	// report: the daemon dies while a cancelled turn is only in memory, the
	// client recovers by seeding a replacement session from disk, and that
	// replacement itself dies before its first turn. Every hop has to keep the
	// transcript, so this walks the whole chain against real artifact files.
	it("keeps the transcript across an abort, a host restart, and a seeded recovery that never runs a turn", async () => {
		const sessionsDir = mkdtempSync(join(tmpdir(), "core-e2e-durability-"));
		tempDirs.push(sessionsDir);

		// One service instance across every host: a daemon restart loses the
		// resident sessions, not the session database or the artifact files.
		const sessionService = new LocalFileSessionService(sessionsDir);
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({ tools: [], shutdown: vi.fn() }),
		};
		const config = splitCoreSessionConfig({
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: "test-key",
			cwd: sessionsDir,
			systemPrompt: "You are a test agent",
			mode: "act",
			enableTools: false,
			enableSpawnAgent: false,
			enableAgentTeams: false,
		});

		let messages: LlmsProviders.Message[] = [];
		let running = false;
		let rejectRun: ((error: Error) => void) | undefined;
		let markRunStarted: (() => void) | undefined;
		const runStarted = new Promise<void>((resolve) => {
			markRunStarted = resolve;
		});
		const appendUser = (prompt: string) => {
			messages = [
				...messages,
				{
					role: "user",
					content: [{ type: "text", text: prompt }],
				},
			] as LlmsProviders.Message[];
		};
		const run = vi.fn(async (prompt: string) => {
			appendUser(prompt);
			messages = [
				...messages,
				{
					role: "assistant",
					content: [{ type: "text", text: "the auth flow works like this" }],
				},
			] as LlmsProviders.Message[];
			return createResult({ text: "the auth flow works like this", messages });
		});
		// The real agent appends the user turn before the provider stream
		// starts, so a cancelled turn leaves the prompt in the transcript.
		// The first continue hangs until aborted; later continues complete
		// normally so the recovered session can run a real turn.
		let continueCalls = 0;
		const continueFn = vi.fn((prompt: string) => {
			continueCalls += 1;
			if (continueCalls === 1) {
				return new Promise<AgentResult>((_resolve, reject) => {
					appendUser(prompt);
					running = true;
					rejectRun = (error) => {
						running = false;
						reject(error);
					};
					markRunStarted?.();
				});
			}
			appendUser(prompt);
			messages = [
				...messages,
				{
					role: "assistant",
					content: [{ type: "text", text: "tests added" }],
				},
			] as LlmsProviders.Message[];
			return Promise.resolve(createResult({ text: "tests added", messages }));
		});
		const abort = vi.fn(() => rejectRun?.(new Error("user cancelled")));
		const createAgent = vi.fn(
			() =>
				({
					run,
					continue: continueFn,
					abort,
					canStartRun: vi.fn(() => !running),
					getAgentId: vi.fn().mockReturnValue("agent-durability"),
					getConversationId: vi.fn().mockReturnValue("conv-durability"),
					restore: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					updateConnection: vi.fn(),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn(() => [...messages]),
				}) as never,
		);

		const firstHost = new RuntimeHostUnderTest({
			distinctId: `test-${nanoid(5)}`,
			sessionService: sessionService as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent,
		});
		const started = await firstHost.startSession({
			interactive: true,
			...config,
		});
		await firstHost.runTurn({
			sessionId: started.sessionId,
			prompt: "explain the auth flow",
		});

		const cancelledTurn = firstHost.runTurn({
			sessionId: started.sessionId,
			prompt: "now walk me through token refresh",
		});
		await runStarted;
		await firstHost.abort(started.sessionId, new Error("user cancelled"));
		await expect(cancelledTurn).resolves.toMatchObject({
			finishReason: "aborted",
		});

		// The daemon dies here: no dispose, no graceful shutdown. Everything the
		// replacement host knows has to come off disk.
		const secondHost = new RuntimeHostUnderTest({
			distinctId: `test-${nanoid(5)}`,
			sessionService: sessionService as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent,
		});
		const recoveredMessages = await secondHost.readSessionMessages(
			started.sessionId,
		);
		expect(
			recoveredMessages.map((message) => [
				message.role,
				JSON.stringify(message.content),
			]),
		).toEqual([
			["user", expect.stringContaining("explain the auth flow")],
			["assistant", expect.stringContaining("the auth flow works like this")],
			["user", expect.stringContaining("now walk me through token refresh")],
		]);

		// Client-side recovery: a brand-new session id seeded with the rescued
		// transcript, exactly like the interactive CLI does on session_not_found.
		messages = [...recoveredMessages];
		const recovered = await secondHost.startSession({
			interactive: true,
			initialMessages: recoveredMessages as never,
			...config,
		});
		expect(recovered.sessionId).not.toBe(started.sessionId);

		// ...and that replacement dies too, before the user sends anything. The
		// seed has to already be on disk or the conversation is gone for good.
		const thirdHost = new RuntimeHostUnderTest({
			distinctId: `test-${nanoid(5)}`,
			sessionService: sessionService as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent,
		});
		await expect(
			thirdHost.readSessionMessages(recovered.sessionId),
		).resolves.toHaveLength(3);

		// Materializing at start means the row exists before any prompt, so it
		// is promptless and untitled at the raw level (before eager
		// persistence it did not exist at all yet); history hydration infers a
		// display title from the inherited transcript.
		const recoveredRow = await thirdHost.getSession(recovered.sessionId);
		expect(recoveredRow?.metadata?.title ?? undefined).toBeUndefined();
		expect(recoveredRow?.prompt ?? undefined).toBeUndefined();
		const hydrated = await listSessionHistory(thirdHost);
		expect(
			hydrated.find((row) => row.sessionId === recovered.sessionId)?.metadata
				?.title,
		).toBe("explain the auth flow");

		// The first prompt after the seed retitles the row — pre-eager-
		// persistence parity, where a fork was named after what the user did
		// with it rather than the conversation it inherited.
		await secondHost.runTurn({
			sessionId: recovered.sessionId,
			prompt: "now add tests",
		});
		const retitledRow = await thirdHost.getSession(recovered.sessionId);
		expect(retitledRow?.metadata?.title).toBe("now add tests");
		expect(retitledRow?.prompt).toContain("now add tests");

		// A rename between materialization and the first prompt wins over the
		// automatic retitle; the prompt column is still backfilled.
		messages = [...recoveredMessages];
		const renamedFork = await secondHost.startSession({
			interactive: true,
			initialMessages: recoveredMessages as never,
			...config,
		});
		await secondHost.updateSession(renamedFork.sessionId, {
			title: "my renamed fork",
		});
		await secondHost.runTurn({
			sessionId: renamedFork.sessionId,
			prompt: "refactor the parser",
		});
		const renamedRow = await thirdHost.getSession(renamedFork.sessionId);
		expect(renamedRow?.metadata?.title).toBe("my renamed fork");
		expect(renamedRow?.prompt).toContain("refactor the parser");
	});
});
