/**
 * Typed client surface added for application consumption (Gateway
 * Desktop validation app): `gateway.status` execution mode, typed
 * command wrappers, `session.get` hydration snapshots, `run.retry`
 * (same runId, new attempt), and the `approval.resolved` broadcast
 * that makes first-answer-wins visible to every attached client.
 */

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { GatewayEvent } from "@cline/shared/gateway";
import { createEventCursor, encodeEventCursor } from "@cline/shared/gateway";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayClient } from "./client";
import type { GatewayClineAccountPort } from "./cline-account";
import type { GatewayClineOAuthPort } from "./cline-oauth";
import { GatewayGlobalSettingsStore } from "./global-settings";
import { GatewayProviderSettingsStore } from "./provider-settings";
import { GatewayServer, type GatewayServerOptions } from "./server";
import { ScriptedEnginePort, tempDataRoot, waitFor } from "./test-support";
import type { GatewayVoicePrimitives } from "./voice";

const servers: GatewayServer[] = [];
const clients: GatewayClient[] = [];

afterEach(async () => {
	for (const client of clients.splice(0)) {
		client.close();
	}
	for (const server of servers.splice(0)) {
		await server.stop("graceful").catch(() => {});
	}
});

async function startServer(overrides: Partial<GatewayServerOptions> = {}) {
	const engine =
		(overrides.engine as ScriptedEnginePort | undefined) ??
		new ScriptedEnginePort();
	const dataRoot = tempDataRoot();
	const providerSettings =
		overrides.providerSettings ??
		new GatewayProviderSettingsStore({
			filePath: join(dataRoot, "provider-settings.json"),
		});
	const globalSettings =
		overrides.globalSettings ??
		new GatewayGlobalSettingsStore({
			filePath: join(dataRoot, "global-settings.json"),
		});
	const server = await GatewayServer.start({
		dataRoot,
		namespace: "default",
		engine,
		...overrides,
		providerSettings,
		globalSettings,
	});
	servers.push(server);
	const discovery = server.discovery;
	if (!discovery) {
		throw new Error("server did not publish discovery");
	}
	return {
		server,
		engine,
		dataRoot,
		async connect(name = "surface-client") {
			const client = await GatewayClient.connectToDiscovery(discovery, {
				clientName: name,
				clientVersion: "0.0.1",
			});
			clients.push(client);
			return client;
		},
		defaultBotId() {
			const botId = server.runtime.defaultBotId;
			if (!botId) {
				throw new Error("no default bot");
			}
			return botId;
		},
	};
}

function recordEvents(client: GatewayClient): GatewayEvent[] {
	const seen: GatewayEvent[] = [];
	client.onEvent((event) => seen.push(event));
	return seen;
}

describe("typed client surface", () => {
	it("reports the unsandboxed development execution mode in gateway.status", async () => {
		const { connect } = await startServer();
		const client = await connect();
		const status = await client.getStatus();
		expect(status.executionMode).toBe("development");
		expect(status.sandboxed).toBe(false);
		expect(status.state).toBe("serving");
		expect(client.hello.capabilities).toContain("runs.queuedMutations");
		expect(client.hello.capabilities).toContain("sessions.dedicated");
		expect(client.hello.capabilities).toContain("sessions.fork");
		expect(client.hello.capabilities).toContain("sessions.metadata");
		expect(client.hello.capabilities).toContain("sessions.lifecycle");
		expect(client.hello.capabilities).toContain("schedules.mutations");
		expect(client.hello.capabilities).toContain("providers.settings");
		expect(client.hello.capabilities).toContain("providers.oauth");
		expect(client.hello.capabilities).toContain("account.cline");
		expect(client.hello.capabilities).toContain("settings.global");
		expect(client.hello.capabilities).toContain("voice.transcription");
	});

	it("round-trips Gateway-owned provider and global settings", async () => {
		const { connect, dataRoot } = await startServer();
		const client = await connect();
		const providerId = `surface-provider-${process.pid}`;

		await client.patchProviderSettings("anthropic", {
			enabled: true,
			settings: {
				apiKey: "surface-provider-secret",
				baseUrl: "https://anthropic.example.test",
			},
		});
		const publicSettings = await client.patchProviderSettings("anthropic", {
			settings: { model: "claude-test" },
		});
		expect(publicSettings).toMatchObject({
			providerId: "anthropic",
			credentials: { apiKey: true },
			settings: {
				baseUrl: "https://anthropic.example.test",
				model: "claude-test",
			},
		});
		expect(JSON.stringify(publicSettings)).not.toContain(
			"surface-provider-secret",
		);

		await client.addProvider({
			providerId,
			name: "Surface Provider",
			baseUrl: "https://surface.example.test/v1",
			models: ["surface-a", "surface-b"],
			defaultModelId: "surface-a",
		});
		expect(await client.listProviderModels(providerId)).toMatchObject({
			providerId,
			models: [{ id: "surface-a" }, { id: "surface-b" }],
		});
		await client.updateProviderModels({
			providerId,
			models: ["surface-c"],
			defaultModelId: "surface-c",
		});
		expect(await client.listProviderModels(providerId)).toMatchObject({
			models: [{ id: "surface-c" }],
		});
		expect(
			(await client.listProviderCatalog()).providers.some(
				(provider) => provider.id === providerId,
			),
		).toBe(true);

		expect(await client.getGlobalSettings()).toMatchObject({
			telemetryOptOut: false,
			autoUpdateEnabled: true,
		});
		expect(
			await client.patchGlobalSettings({
				telemetryOptOut: true,
				webSearchEnabled: true,
			}),
		).toMatchObject({
			telemetryOptOut: true,
			tools: { web_search: { enabled: true } },
		});

		expect(
			readFileSync(join(dataRoot, "provider-settings.json"), "utf8"),
		).toContain("surface-provider-secret");
	});

	it("persists voice selection and transcribes through the typed Gateway boundary", async () => {
		const voiceRoot = tempDataRoot("gateway-voice-surface-");
		const providerSettings = new GatewayProviderSettingsStore({
			filePath: join(voiceRoot, "providers.json"),
		});
		const providerSecret = "surface-voice-provider-secret";
		providerSettings.patch("elevenlabs", {
			enabled: true,
			settings: {
				apiKey: providerSecret,
				model: "scribe_v2",
			},
		});
		const transcribeAudio = vi.fn(
			async (
				_request: Parameters<GatewayVoicePrimitives["transcribeAudio"]>[0],
			) => ({ text: "typed voice result", language: "en" }),
		);
		const { server, connect } = await startServer({
			providerSettings,
			voicePrimitives: {
				transcribeAudio,
				createStreamingAudioTranscriptionSession: vi.fn(async () => ({
					token: "short-lived-token",
					url: "wss://voice.example.test",
				})),
			},
		});
		const client = await connect();

		expect(
			await client.setVoiceInput({
				providerId: "elevenlabs",
				modelId: "scribe_v2",
			}),
		).toEqual({
			voiceInput: { providerId: "elevenlabs", modelId: "scribe_v2" },
		});
		expect((await client.listProviderCatalog()).voiceInput).toEqual({
			providerId: "elevenlabs",
			modelId: "scribe_v2",
		});
		expect(
			await client.transcribeAudio({
				audioBase64: Buffer.from("audio").toString("base64"),
				mediaType: "audio/webm",
			}),
		).toEqual({ text: "typed voice result", language: "en" });
		expect(transcribeAudio).toHaveBeenCalledOnce();
		const transcriptionRequest = transcribeAudio.mock.calls[0]?.[0];
		expect(transcriptionRequest?.providerConfig).toMatchObject({
			providerId: "elevenlabs",
			apiKey: expect.any(String),
		});
		expect(
			Buffer.from(transcriptionRequest?.audio ?? []).toString("utf8"),
		).toBe("audio");

		const audit = server.stores.audit
			.list(1_000)
			.find((entry) => entry.action === "voice.transcription.transcribe");
		expect(audit).toMatchObject({
			subject: "elevenlabs",
			details: {
				modelId: "scribe_v2",
				status: "completed",
				audioBytes: 5,
			},
		});
		expect(JSON.stringify(audit)).not.toContain(providerSecret);

		await client.patchProviderSettings("elevenlabs", { enabled: false });
		expect((await client.listProviderCatalog()).voiceInput).toBeUndefined();
	});

	it("keeps Cline OAuth credentials Gateway-private across the typed account surface", async () => {
		const credential = {
			access: "oauth-access-secret",
			refresh: "oauth-refresh-secret",
			expires: Date.parse("2030-01-01T00:00:00.000Z"),
			accountId: "user-1",
			metadata: { provider: "cline", tokenType: "Bearer" },
		};
		const clineOAuth: GatewayClineOAuthPort = {
			async login(input) {
				await input.openExternalUrl("https://auth.example/device?code=ABC");
				await input.persistCredentials(credential);
			},
			cancel: () => false,
			cancelActor: () => 0,
		};
		const clineAccount = {
			query: async () => ({
				id: "user-1",
				email: "person@example.com",
				displayName: "Person",
				photoUrl: "",
				createdAt: "2026-01-01",
				updatedAt: "2026-01-01",
				organizations: [],
			}),
			switchAccount: async () => ({ switched: true as const }),
		} as unknown as GatewayClineAccountPort;
		const { connect, dataRoot } = await startServer({
			clineOAuth,
			clineAccount,
		});
		const client = await connect();
		await client.subscribe({});
		client.onServerRequest((request) => {
			expect(request.method).toBe("client.openExternalUrl");
			expect(request.params?.url).toBe("https://auth.example/device?code=ABC");
			return { opened: true };
		});

		const login = await client.loginProviderOAuth("cline");
		expect(login).toEqual({ provider: "cline", configured: true });
		expect(JSON.stringify(login)).not.toContain("secret");
		expect(await client.getProviderSettings("cline")).toMatchObject({
			credentials: { oauthAccessToken: true, oauthRefreshToken: true },
		});
		expect(
			await client.queryClineAccount({ operation: "fetchMe" }),
		).toMatchObject({ id: "user-1" });
		const stored = readFileSync(
			join(dataRoot, "provider-settings.json"),
			"utf8",
		);
		expect(stored).toContain("workos:oauth-access-secret");
		expect(stored).toContain("oauth-refresh-secret");
	});

	it("lists bots, sessions, and runs through typed wrappers", async () => {
		const { engine, connect, defaultBotId } = await startServer();
		const client = await connect();
		const bots = await client.listBots();
		expect(bots.bots.some((bot) => bot.identity.botId === defaultBotId())).toBe(
			true,
		);
		const accepted = await client.startRun({
			botId: defaultBotId(),
			prompt: "typed surface",
		});
		expect(accepted.runId).toMatch(/^run_/);
		const sessions = await client.listSessions({ botId: defaultBotId() });
		expect(sessions.sessions).toHaveLength(1);
		const runs = await client.listRuns({
			sessionId: sessions.sessions[0].sessionId,
		});
		expect(runs.runs.map((run) => run.runId)).toContain(accepted.runId);
		engine.lastHandle?.settle({});
	});

	it("persists a bot system prompt through the typed surface", async () => {
		const { connect, defaultBotId } = await startServer();
		const client = await connect();
		const initial = await client.getBotSystemPrompt({ botId: defaultBotId() });
		const updated = await client.putBotSystemPrompt({
			botId: defaultBotId(),
			content: "You are the infrastructure bot.",
			expectedRevision: initial.revision,
		});
		expect(updated.content).toBe("You are the infrastructure bot.");
		expect(updated.revision).toBe(initial.revision + 1);
		expect(await client.getBotSystemPrompt({ botId: defaultBotId() })).toEqual(
			updated,
		);
	});

	it("starts a run in an explicitly created session without leaking session fields", async () => {
		const { engine, connect, defaultBotId } = await startServer();
		const client = await connect();
		const session = await client.createSession({
			botId: defaultBotId(),
			workspaceRoot: "/tmp/gateway-explicit-session",
			kind: "dedicated",
		});
		expect(session.kind).toBe("dedicated");
		const accepted = await client.startRun({
			botId: defaultBotId(),
			sessionId: session.sessionId,
			workspaceRoot: session.workspace.rootPath,
			prompt: "explicit session",
		});
		expect(Object.keys(accepted).sort()).toEqual([
			"acceptedAt",
			"queuePosition",
			"runId",
		]);
		engine.lastHandle?.settle({});
	});

	it("forks a session through the typed protocol surface", async () => {
		const { server, engine, connect, defaultBotId } = await startServer();
		const client = await connect();
		const source = await client.createSession({
			botId: defaultBotId(),
			workspaceRoot: "/tmp/gateway-fork",
		});
		for (const message of [
			{
				id: "msg_user_1",
				role: "user" as const,
				content: [{ type: "text" as const, text: "first" }],
				createdAt: 1,
			},
			{
				id: "msg_assistant_1",
				role: "assistant" as const,
				content: [{ type: "text" as const, text: "answer" }],
				createdAt: 2,
			},
			{
				id: "msg_user_2",
				role: "user" as const,
				content: [{ type: "text" as const, text: "second" }],
				createdAt: 3,
			},
		]) {
			server.stores.messages.append(source.sessionId, undefined, message);
		}

		const fork = await client.forkSession({
			sessionId: source.sessionId,
			beforeRunCount: 2,
		});

		expect(fork.forkedFromSessionId).toBe(source.sessionId);
		expect(fork.session.sessionId).not.toBe(source.sessionId);
		expect(fork.session.workspace.rootPath).toBe(source.workspace.rootPath);
		expect(fork.session.kind).toBe("dedicated");
		expect(fork.messageCount).toBe(2);
		expect(
			(await client.getSession({ sessionId: source.sessionId })).session.state,
		).toBe("active");
		const snapshot = await client.getSession({
			sessionId: fork.session.sessionId,
		});
		expect(snapshot.messages.map(({ message }) => message.id)).toEqual([
			"msg_user_1",
			"msg_assistant_1",
		]);
		expect(snapshot.messages.every(({ runId }) => runId === undefined)).toBe(
			true,
		);

		await client.startRun({
			botId: defaultBotId(),
			sessionId: fork.session.sessionId,
			prompt: "continue the fork",
		});
		await waitFor(() => engine.handles.length === 1);
		expect(
			engine.handles[0].invocation.initialMessages?.map(({ id }) => id),
		).toEqual(["msg_user_1", "msg_assistant_1"]);
		engine.handles[0].settle({});
	});

	it("manages session metadata and lifecycle through typed wrappers", async () => {
		const { connect, defaultBotId } = await startServer();
		const client = await connect();
		const created = await client.createSession({
			botId: defaultBotId(),
			kind: "dedicated",
		});
		const updated = await client.updateSession({
			sessionId: created.sessionId,
			title: "My session",
			metadata: { pinned: true },
			expectedRevision: created.revision,
		});
		expect(updated).toMatchObject({
			title: "My session",
			metadata: { pinned: true },
			revision: created.revision + 1,
		});
		const closed = await client.closeSession({
			sessionId: created.sessionId,
		});
		expect(closed.state).toBe("closed");
		expect(
			await client.deleteSession({ sessionId: created.sessionId }),
		).toEqual({ deleted: true });
		await expect(
			client.getSession({ sessionId: created.sessionId }),
		).rejects.toMatchObject({ gatewayError: { code: "not_found" } });
	});

	it("updates and promotes queued runs through the typed protocol surface", async () => {
		const { server, engine, connect, defaultBotId } = await startServer();
		const client = await connect();
		const active = await client.startRun({
			botId: defaultBotId(),
			prompt: "active",
		});
		await waitFor(() => engine.handlesFor(active.runId).length === 1);
		const queued = await client.startRun({
			botId: defaultBotId(),
			prompt: "original queued input",
		});

		const updated = await client.updateQueuedRun({
			runId: queued.runId,
			input: "updated queued input",
		});
		expect(updated.run.input).toBe("updated queued input");
		expect(server.stores.runs.get(queued.runId)?.input).toBe(
			"updated queued input",
		);
		await expect(
			client.updateQueuedRun({
				runId: active.runId,
				input: "cannot update an active run",
			}),
		).rejects.toMatchObject({
			gatewayError: {
				code: "invalid_state_transition",
				retryable: false,
			},
		});

		const promoted = await client.promoteQueuedRun({ runId: queued.runId });
		expect(promoted).toEqual({
			queuedRunId: queued.runId,
			activeRunId: active.runId,
			sessionId: server.stores.runs.get(active.runId)?.sessionId,
			merged: true,
		});
		expect(engine.handlesFor(active.runId)[0].steers).toEqual([
			"updated queued input",
		]);
		expect(server.stores.runs.get(queued.runId)?.state).toBe("aborted");
		engine.handlesFor(active.runId)[0].settle({});
	});
});

describe("session.get hydration snapshot", () => {
	it("returns session, runs with attempts, messages, and a cursor basis", async () => {
		const { server, engine, connect, defaultBotId } = await startServer();
		const client = await connect();
		const accepted = await client.startRun({
			botId: defaultBotId(),
			prompt: "hydrate me",
		});
		await waitFor(() => engine.handles.length === 1);
		engine.handles[0].emit({
			type: "message-appended",
			message: {
				id: "msg_1",
				role: "assistant",
				content: [{ type: "text", text: "canonical message" }],
				createdAt: Date.now(),
			},
		});
		engine.handles[0].settle({ outputText: "hydrated" });
		await waitFor(
			() => server.stores.runs.get(accepted.runId)?.state === "completed",
		);

		const sessions = await client.listSessions();
		const snapshot = await client.getSession({
			sessionId: sessions.sessions[0].sessionId,
		});
		expect(snapshot.session.sessionId).toBe(sessions.sessions[0].sessionId);
		expect(snapshot.runs).toHaveLength(1);
		expect(snapshot.runs[0].runId).toBe(accepted.runId);
		expect(snapshot.runs[0].attempts).toHaveLength(1);
		expect(snapshot.runs[0].attempts[0].state).toBe("completed");
		expect(snapshot.messages).toHaveLength(1);
		expect(snapshot.messages[0].message.id).toBe("msg_1");
		expect(snapshot.lastEventSequence).toBe(
			server.stores.events.lastSequence(),
		);
	});

	it("rejects unknown sessions with not_found", async () => {
		const { connect } = await startServer();
		const client = await connect();
		await expect(
			client.getSession({ sessionId: "ses_does_not_exist" as never }),
		).rejects.toMatchObject({ gatewayError: { code: "not_found" } });
	});

	it("returns only the newest messages when a hydration limit is requested", async () => {
		const { server, connect, defaultBotId } = await startServer();
		const client = await connect();
		const session = await client.createSession({
			botId: defaultBotId(),
			workspaceRoot: "/tmp/paged-history",
		});
		for (let index = 1; index <= 25; index++) {
			server.stores.messages.append(session.sessionId, undefined, {
				id: `msg_${index}`,
				role: "assistant",
				content: [{ type: "text", text: `message ${index}` }],
				createdAt: index,
			});
		}

		const snapshot = await client.getSession({
			sessionId: session.sessionId,
			messageLimit: 20,
		});

		expect(snapshot.totalMessageCount).toBe(25);
		expect(snapshot.messages).toHaveLength(20);
		expect(snapshot.messages[0].message.id).toBe("msg_6");
		expect(snapshot.messages.at(-1)?.message.id).toBe("msg_25");
	});
});

describe("run.retry (same runId, new attempt)", () => {
	it("re-admits a failed run under the same runId as a new attempt", async () => {
		const engine = new ScriptedEnginePort();
		engine.autoOutcome = (_invocation, attemptIndex) =>
			attemptIndex === 0
				? {
						status: "failed",
						error: { name: "EngineError", message: "first try exploded" },
					}
				: { status: "completed", outputText: "second try worked" };
		const { server, connect, defaultBotId } = await startServer({ engine });
		const client = await connect();
		const seen = recordEvents(client);
		await client.subscribe({
			cursor: encodeEventCursor(createEventCursor(-1)),
		});

		const accepted = await client.startRun({
			botId: defaultBotId(),
			prompt: "flaky work",
		});
		await waitFor(
			() => server.stores.runs.get(accepted.runId)?.state === "failed",
		);

		const retried = await client.retryRun({ runId: accepted.runId });
		expect(retried.runId).toBe(accepted.runId);
		await waitFor(
			() => server.stores.runs.get(accepted.runId)?.state === "completed",
		);

		const attempts = server.stores.attempts.listByRun(accepted.runId);
		expect(attempts.map((attempt) => attempt.attempt)).toEqual([1, 2]);
		expect(attempts[0].state).toBe("failed");
		expect(attempts[1].state).toBe("completed");

		await waitFor(() => seen.some((event) => event.event === "run.completed"));
		const retriedEvent = seen.find((event) => event.event === "run.retried");
		expect(retriedEvent?.scope.runId).toBe(accepted.runId);
		expect(retriedEvent?.payload?.nextAttempt).toBe(2);
		expect(retriedEvent?.payload?.previousState).toBe("failed");
		// The full lifecycle repeated under the same runId.
		const lifecycle = seen
			.filter((event) => event.scope.runId === accepted.runId)
			.map((event) => event.event);
		expect(
			lifecycle.filter((name) => name === "run.queued").length,
		).toBeGreaterThanOrEqual(2);
		expect(lifecycle).toContain("run.failed");
		expect(lifecycle).toContain("run.completed");
	});

	it("re-admits an interrupted run on manual retry", async () => {
		const { server, engine, connect, defaultBotId } = await startServer();
		const client = await connect();
		const accepted = await client.startRun({
			botId: defaultBotId(),
			prompt: "interruptible",
		});
		await waitFor(() => engine.handles.length === 1);
		await client.interruptRun({ runId: accepted.runId, reason: "user stop" });
		await waitFor(
			() => server.stores.runs.get(accepted.runId)?.state === "interrupted",
		);

		const retried = await client.retryRun({ runId: accepted.runId });
		expect(retried.runId).toBe(accepted.runId);
		await waitFor(() => engine.handles.length === 2);
		engine.handles[1].settle({ outputText: "resumed" });
		await waitFor(
			() => server.stores.runs.get(accepted.runId)?.state === "completed",
		);
		expect(server.stores.attempts.listByRun(accepted.runId)).toHaveLength(2);
	});

	it("rejects retry of completed and aborted runs", async () => {
		const { server, engine, connect, defaultBotId } = await startServer();
		const client = await connect();
		const accepted = await client.startRun({
			botId: defaultBotId(),
			prompt: "finishes fine",
		});
		await waitFor(() => engine.handles.length === 1);
		engine.handles[0].settle({ outputText: "done" });
		await waitFor(
			() => server.stores.runs.get(accepted.runId)?.state === "completed",
		);
		await expect(
			client.retryRun({ runId: accepted.runId }),
		).rejects.toMatchObject({
			gatewayError: { code: "invalid_state_transition", retryable: false },
		});
	});

	it("replays an idempotent retry without admitting a third attempt", async () => {
		const engine = new ScriptedEnginePort();
		engine.autoOutcome = (_invocation, attemptIndex) =>
			attemptIndex === 0
				? { status: "failed", error: { name: "E", message: "boom" } }
				: undefined;
		const { server, connect, defaultBotId } = await startServer({ engine });
		const client = await connect();
		const accepted = await client.startRun({
			botId: defaultBotId(),
			prompt: "retry exactly once",
		});
		await waitFor(
			() => server.stores.runs.get(accepted.runId)?.state === "failed",
		);
		const idempotencyKey = "retry-key-000001";
		const first = await client.retryRun({
			runId: accepted.runId,
			idempotencyKey,
		});
		const replay = await client.retryRun({
			runId: accepted.runId,
			idempotencyKey,
		});
		expect(replay).toEqual(first);
		await waitFor(() => engine.handles.length === 2);
		expect(engine.handlesFor(accepted.runId)).toHaveLength(2);
		engine.handles[1].settle({ outputText: "made it" });
	});
});

describe("Phase 4-6 typed surface", () => {
	it("exposes execution health, plugin summary, and connector health in status", async () => {
		const { connect } = await startServer({
			executionHealth: () => ({
				isolation: "unsandboxed-development",
				development: true,
			}),
		});
		const client = await connect();
		const status = await client.getStatus();
		expect(status.execution?.isolation).toBe("unsandboxed-development");
		expect(status.execution?.development).toBe(true);
		expect(status.plugins?.generation).toBeGreaterThan(0);
		expect(status.plugins?.lastReloadOk).toBe(true);
		expect(status.connectorHealth?.running).toEqual([]);
		expect(status.counts.connectors).toBe(0);
		expect(status.counts.schedules).toBe(0);
	});

	it("registers and lists connectors through the typed surface", async () => {
		const { connect, defaultBotId } = await startServer({
			autoStartConnectors: false,
		});
		const client = await connect();
		const registered = await client.registerConnector({
			botId: defaultBotId(),
			kind: "telegram",
			name: "team-telegram",
			credentialRef: "telegram-token",
		});
		expect(registered.connectorId).toMatch(/^con_/);
		const listed = await client.listConnectors({ botId: defaultBotId() });
		expect(listed.connectors).toHaveLength(1);
		expect(listed.connectors[0].credentialRef).toBe("telegram-token");
	});

	it("lets the Gateway authority persist connector credentials", async () => {
		const { server, connect, defaultBotId } = await startServer({
			autoStartConnectors: false,
		});
		const client = await connect();
		const botId = defaultBotId();
		const configured = await client.configureConnector({
			botId,
			kind: "telegram",
			name: "desktop-telegram",
			credential: "test-token",
		});
		expect(configured.credentialRef).toBe(`connector-${botId}-telegram`);
		if (!configured.credentialRef) throw new Error("credential ref missing");
		const secretPath = server.paths.secretFile(configured.credentialRef);
		expect(readFileSync(secretPath, "utf8")).toBe("test-token");
		expect(statSync(secretPath).mode & 0o777).toBe(0o600);

		const replacement = await client.configureConnector({
			botId,
			kind: "telegram",
			name: "replacement-telegram",
			credential: "replacement-token",
		});
		expect(replacement.connectorId).not.toBe(configured.connectorId);
		expect((await client.listConnectors({ botId })).connectors).toHaveLength(1);
		expect(readFileSync(secretPath, "utf8")).toBe("replacement-token");
	});

	it("creates schedules and reports automation provenance in session.get", async () => {
		const engine = new ScriptedEnginePort();
		engine.autoOutcome = () => ({ outputText: "scheduled work done" });
		const { server, connect, defaultBotId } = await startServer({
			engine,
			schedulerTickMs: 25,
		});
		const client = await connect();
		const schedule = await client.createSchedule({
			botId: defaultBotId(),
			name: "surface-schedule",
			prompt: "run on a timer",
			intervalMs: 30,
		});
		expect(schedule.scheduleId).toMatch(/^sch_/);
		const listed = await client.listSchedules({ botId: defaultBotId() });
		expect(listed.schedules.map((entry) => entry.scheduleId)).toContain(
			schedule.scheduleId,
		);

		await waitFor(
			() =>
				server.stores.scheduleJobs
					.report(schedule.scheduleId)
					.some((job) => job.state === "completed"),
			{ timeoutMs: 10_000 },
		);
		const report = await client.scheduleReport({
			scheduleId: schedule.scheduleId,
		});
		const completed = report.jobs.find((job) => job.state === "completed");
		expect(completed?.runId).toMatch(/^run_/);

		// The automation run's provenance is visible on the snapshot.
		const sessions = await client.listSessions({ botId: defaultBotId() });
		const snapshot = await client.getSession({
			sessionId: sessions.sessions[0].sessionId,
		});
		const automationRun = snapshot.runs.find(
			(run) => run.runId === completed?.runId,
		);
		expect(automationRun?.provenance).toMatchObject({
			mode: "automation",
			scheduleId: schedule.scheduleId,
		});
	});

	it("manages schedules through typed mutation wrappers", async () => {
		const engine = new ScriptedEnginePort();
		engine.autoOutcome = () => ({ outputText: "manual schedule complete" });
		const { connect, defaultBotId } = await startServer({
			engine,
			schedulerTickMs: 0,
		});
		const client = await connect();
		const created = await client.createSchedule({
			botId: defaultBotId(),
			name: "routine",
			prompt: "first prompt",
			at: Date.now() + 60_000,
			mode: "yolo",
			maxParallel: 1,
		});
		const updated = await client.updateSchedule({
			scheduleId: created.scheduleId,
			expectedRevision: created.revision,
			name: "updated routine",
			prompt: "second prompt",
			cronPattern: "0 9 * * *",
			metadata: { source: "desktop" },
		});
		expect(updated).toMatchObject({
			name: "updated routine",
			cronPattern: "0 9 * * *",
			metadata: { source: "desktop" },
			revision: 1,
		});
		expect(
			(await client.disableSchedule({ scheduleId: created.scheduleId }))
				.enabled,
		).toBe(false);
		expect(
			(await client.enableSchedule({ scheduleId: created.scheduleId })).enabled,
		).toBe(true);

		const triggered = await client.triggerSchedule({
			scheduleId: created.scheduleId,
		});
		expect(triggered.job.runId).toMatch(/^run_/);
		await waitFor(() => engine.handles.length === 1);
		await waitFor(async () => {
			const report = await client.scheduleReport({
				scheduleId: created.scheduleId,
			});
			return report.jobs[0]?.runId === triggered.job.runId;
		});
		expect(
			await client.deleteSchedule({ scheduleId: created.scheduleId }),
		).toEqual({ deleted: true });
		expect(
			(await client.listSchedules()).schedules.some(
				(schedule) => schedule.scheduleId === created.scheduleId,
			),
		).toBe(false);
	});

	it("reports interactive provenance for ordinary client runs", async () => {
		const { server, engine, connect, defaultBotId } = await startServer();
		const client = await connect();
		const accepted = await client.startRun({
			botId: defaultBotId(),
			prompt: "plain interactive run",
		});
		await waitFor(() => engine.handles.length === 1);
		engine.handles[0].settle({ outputText: "done" });
		await waitFor(
			() => server.stores.runs.get(accepted.runId)?.state === "completed",
		);
		const sessions = await client.listSessions();
		const snapshot = await client.getSession({
			sessionId: sessions.sessions[0].sessionId,
		});
		expect(snapshot.runs[0].provenance?.mode).toBe("interactive");
	});
});

describe("approval.resolved broadcast", () => {
	it("first answer wins and every subscriber sees approval.resolved", async () => {
		const { server, engine, connect, defaultBotId } = await startServer();
		const clientA = await connect("approver-a");
		const clientB = await connect("approver-b");
		const seenA = recordEvents(clientA);
		const seenB = recordEvents(clientB);

		const accepted = await clientA.startRun({
			botId: defaultBotId(),
			prompt: "needs approval",
		});
		await waitFor(() => engine.handles.length === 1);
		const invocation = engine.handles[0].invocation;
		await clientA.subscribe({ runId: accepted.runId });
		await clientB.subscribe({ runId: accepted.runId });

		const requestsA: string[] = [];
		const requestsB: string[] = [];
		clientA.onServerRequest((request) => {
			requestsA.push(request.id);
			return { approved: true, reason: "A approves first" };
		});
		clientB.onServerRequest(async (request) => {
			requestsB.push(request.id);
			// B answers late: the broker has already settled on A's answer.
			await new Promise((resolve) => setTimeout(resolve, 50));
			return { approved: false, reason: "B is too late" };
		});

		const answer = (await server.runtime.approvals.request(
			"client.requestToolApproval",
			{
				botId: invocation.botId,
				sessionId: invocation.sessionId,
				runId: invocation.runId,
			},
			{ toolName: "write_file", toolCallId: "call_1" },
		)) as { approved: boolean };
		expect(answer.approved).toBe(true);
		expect(requestsA).toHaveLength(1);
		expect(requestsB).toHaveLength(1);
		expect(server.runtime.approvals.pendingCount).toBe(0);

		// Both clients observe the durable resolution broadcast.
		const resolved = (events: GatewayEvent[]) =>
			events.find((event) => event.event === "approval.resolved");
		await waitFor(() => Boolean(resolved(seenA) && resolved(seenB)));
		expect(resolved(seenA)?.payload?.approved).toBe(true);
		expect(resolved(seenA)?.payload?.requestId).toBe(requestsA[0]);
		expect(resolved(seenB)?.payload?.requestId).toBe(requestsA[0]);

		// B's late answer is dropped without breaking anything.
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(server.runtime.approvals.pendingCount).toBe(0);
		engine.handles[0].settle({});
	});
});
