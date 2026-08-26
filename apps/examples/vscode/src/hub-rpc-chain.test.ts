import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	clearHubDiscovery,
	createInMemoryHubOwnerContext,
	createLocalHubScheduleRuntimeHandlers,
	ensureHubWebSocketServer,
	HubRuntimeHost,
	HubSessionClient,
	NodeHubClient,
	type SendSessionInput,
	type StartSessionInput,
	type StartSessionResult,
} from "@cline/core";
import type { AgentResult, HubEventEnvelope } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

const WORKSPACE_ROOT = join(tmpdir(), "cline-rpc-chain-workspace");

function createAgentResult(text: string): AgentResult {
	const startedAt = new Date();
	return {
		text,
		usage: { inputTokens: 1, outputTokens: 2 },
		messages: [],
		toolCalls: [],
		iterations: 1,
		finishReason: "completed",
		model: { id: "test-model", provider: "test-provider" },
		startedAt,
		endedAt: startedAt,
		durationMs: 1,
	} as unknown as AgentResult;
}

type StubSessionRecord = Record<string, unknown> & { sessionId: string };

function createStubSessionRecord(sessionId: string): StubSessionRecord {
	return {
		sessionId,
		source: "vscode",
		pid: process.pid,
		startedAt: new Date(0).toISOString(),
		updatedAt: new Date(0).toISOString(),
		status: "idle",
		interactive: true,
		provider: "test-provider",
		model: "test-model",
		cwd: WORKSPACE_ROOT,
		workspaceRoot: WORKSPACE_ROOT,
		enableTools: true,
		enableSpawn: true,
		enableTeams: true,
		isSubagent: false,
	};
}

/**
 * Server-side RuntimeHost double. The hub executes incoming
 * session.create / run.start / run.abort traffic against this stub, so the
 * tests below exercise the real WebSocket transport and command dispatch
 * without launching an LLM or VS Code.
 */
function createStubSessionHost() {
	const sessions = new Map<string, StubSessionRecord>();
	return {
		sessions,
		startSession: vi.fn(async (input: StartSessionInput) => {
			const sessionId =
				input.config.sessionId?.trim() ||
				`stub-${Math.random().toString(36).slice(2, 10)}`;
			sessions.set(sessionId, createStubSessionRecord(sessionId));
			return {
				sessionId,
				manifest: {} as never,
				manifestPath: "",
				messagesPath: "",
			} satisfies StartSessionResult;
		}),
		runTurn: vi.fn(async (input: SendSessionInput) =>
			createAgentResult(`echo:${input.prompt}`),
		),
		abort: vi.fn(async () => {}),
		restoreSession: vi.fn(async () => {
			throw new Error("restoreSession not expected in this test");
		}),
		stopSession: vi.fn(async () => {}),
		dispose: vi.fn(async () => {}),
		getSession: vi.fn(
			async (sessionId: string) => sessions.get(sessionId) ?? undefined,
		),
		listSessions: vi.fn(async () => [...sessions.values()]),
		deleteSession: vi.fn(async () => true),
		updateSession: vi.fn(async () => ({ updated: true })),
		updateSessionCompactionState: vi.fn(async () => ({ updated: true })),
		readSessionCompactionState: vi.fn(async () => undefined),
		readSessionMessages: vi.fn(async () => []),
		dispatchHookEvent: vi.fn(async () => {}),
		subscribe: vi.fn(() => () => {}),
	};
}

type StubSessionHost = ReturnType<typeof createStubSessionHost>;

async function startHubWithStub(stub: StubSessionHost) {
	const owner = createInMemoryHubOwnerContext("vscode-example-rpc-chain-test");
	owner.discoveryPath = join(
		await mkdtemp(join(tmpdir(), "cline-hub-rpc-chain-")),
		"hub-discovery.json",
	);
	const ensured = await ensureHubWebSocketServer({
		owner,
		host: "127.0.0.1",
		port: 0,
		pathname: "/hub",
		runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		sessionHost: stub as never,
	});
	expect(ensured.action).toBe("started");
	const server = ensured.server;
	expect(server).toBeDefined();
	if (!server) {
		throw new Error("Expected in-process hub server to be defined");
	}
	return {
		url: ensured.url,
		authToken: ensured.authToken,
		async stop() {
			await server.close();
			await clearHubDiscovery(owner.discoveryPath);
		},
	};
}

async function waitFor(
	predicate: () => boolean,
	timeoutMs = 5_000,
	stepMs = 25,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, stepMs));
	}
	throw new Error("Timed out waiting for condition");
}

describe("example vscode extension RPC chain over an in-process hub", () => {
	const cleanupTasks: Array<() => Promise<void>> = [];

	afterEach(async () => {
		vi.restoreAllMocks();
		while (cleanupTasks.length > 0) {
			const task = cleanupTasks.pop();
			if (task) await task();
		}
	});

	it("drives startRuntimeSession / sendRuntimeSession / abortRuntimeSession through the real hub transport", async () => {
		const stub = createStubSessionHost();
		const hub = await startHubWithStub(stub);
		cleanupTasks.push(() => hub.stop());

		const client = new HubSessionClient({
			address: hub.url,
			authToken: hub.authToken,
			clientType: "vscode-example-test",
			displayName: "vscode example rpc test",
			workspaceRoot: WORKSPACE_ROOT,
			cwd: WORKSPACE_ROOT,
		});
		cleanupTasks.push(() => client.dispose());

		const observer = new NodeHubClient({
			url: hub.url,
			authToken: hub.authToken,
			clientType: "vscode-example-test-observer",
		});
		await observer.connect();
		const observedEvents: HubEventEnvelope[] = [];
		observer.subscribe((event) => observedEvents.push(event));
		cleanupTasks.push(async () => observer.close());

		const baseRequest = {
			workspaceRoot: WORKSPACE_ROOT,
			cwd: WORKSPACE_ROOT,
			provider: "test-provider",
			model: "test-model",
			apiKey: "test-key",
			systemPrompt: "",
			mode: "act" as const,
			enableTools: true,
			enableSpawn: false,
			enableTeams: false,
			interactive: true,
			source: "vscode",
		};

		const started = await client.startRuntimeSession(baseRequest);
		expect(started.sessionId).toBeTruthy();

		const startInput = stub.startSession.mock.calls[0]?.[0];
		expect(startInput?.config.providerId).toBe("test-provider");
		expect(startInput?.config.modelId).toBe("test-model");
		expect(startInput?.config.workspaceRoot).toBe(WORKSPACE_ROOT);

		await waitFor(() =>
			observedEvents.some((event) => event.event === "session.created"),
		);

		const sent = await client.sendRuntimeSession(started.sessionId, {
			config: baseRequest,
			prompt: "hello from vscode example",
		});
		expect(sent.result?.text).toBe("echo:hello from vscode example");
		expect(sent.result?.finishReason).toBe("completed");
		expect(stub.runTurn).toHaveBeenCalledTimes(1);
		expect(stub.runTurn.mock.calls[0]?.[0]).toMatchObject({
			sessionId: started.sessionId,
			prompt: "hello from vscode example",
			mode: "act",
		});

		await waitFor(() =>
			observedEvents.some(
				(event) =>
					event.event === "run.started" && event.sessionId === started.sessionId,
			),
		);
		await waitFor(() =>
			observedEvents.some(
				(event) =>
					event.event === "run.completed" &&
					event.sessionId === started.sessionId,
			),
		);

		const aborted = await client.abortRuntimeSession(started.sessionId);
		expect(aborted.applied).toBe(true);
		expect(stub.abort).toHaveBeenCalledWith(started.sessionId, undefined);

		await expect(client.getSession(started.sessionId)).resolves.toMatchObject({
			sessionId: started.sessionId,
			messagesPath: undefined,
		});
	});

	it("routes HubRuntimeHost start/runTurn/abort through the same hub commands used by ClineCore backendMode=hub", async () => {
		const stub = createStubSessionHost();
		const hub = await startHubWithStub(stub);
		cleanupTasks.push(() => hub.stop());

		const host = new HubRuntimeHost(
			{
				url: hub.url,
				authToken: hub.authToken,
				clientType: "vscode-example-test-runtime",
				displayName: "vscode example runtime host test",
			},
			{ workspaceRoot: WORKSPACE_ROOT, cwd: WORKSPACE_ROOT },
		);
		cleanupTasks.push(async () => host.dispose().catch(() => undefined));

		const sessionId = "stub-planned-session-1";
		const started = await host.startSession({
			source: "cli",
			interactive: true,
			prompt: "initial prompt",
			config: {
				sessionId,
				providerId: "test-provider",
				modelId: "test-model",
				apiKey: "test-key",
				cwd: WORKSPACE_ROOT,
				workspaceRoot: WORKSPACE_ROOT,
				systemPrompt: "",
				mode: "act",
				enableTools: true,
				enableSpawnAgent: true,
				enableAgentTeams: true,
			},
		});

		expect(started.sessionId).toBe(sessionId);
		expect(started.manifest).toMatchObject({
			session_id: sessionId,
			provider: "test-provider",
			model: "test-model",
			workspace_root: WORKSPACE_ROOT,
		});
		expect(stub.startSession).toHaveBeenCalledTimes(1);
		expect(stub.startSession.mock.calls[0]?.[0].config).toMatchObject({
			sessionId,
			providerId: "test-provider",
			mode: "act",
		});

		const result = await host.runTurn({
			sessionId,
			prompt: "turn one",
		});
		expect(result?.text).toBe("echo:turn one");
		expect(result?.finishReason).toBe("completed");
		expect(stub.runTurn).toHaveBeenCalledWith(
			expect.objectContaining({ sessionId, prompt: "turn one" }),
		);

		await host.abort(sessionId, "user requested abort");
		expect(stub.abort).toHaveBeenCalledWith(sessionId, "user requested abort");

		const record = await host.getSession(sessionId);
		expect(record?.sessionId).toBe(sessionId);
	});
});
