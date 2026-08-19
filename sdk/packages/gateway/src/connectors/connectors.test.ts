/**
 * Connector supervision over the SQLite authority (Gateway RFC, Phase 6):
 * bot-scoped config isolation, admission into the bot's canonical
 * session with connector provenance, crash-safe dedupe cursors committed
 * with the admission, one worker per connector instance (in-process and
 * across restarts), and crash-restart from the cursor without
 * duplicates.
 */

import type { NormalizedConnectorMessage } from "@cline/bot";
import {
	type ConnectorId,
	createGatewayInstanceId,
	createWorkerId,
} from "@cline/shared/gateway";
import { describe, expect, it } from "vitest";
import { openGatewayDatabase } from "../db";
import { ensureGatewayDataDir, resolveGatewayPaths } from "../paths";
import { GatewayRuntime } from "../runtime";
import { createGatewayStores } from "../stores";
import { ScriptedEnginePort, tempDataRoot, waitFor } from "../test-support";
import type { ConnectorAdapter, ConnectorAdapterContext } from "./adapter";
import { ConnectorManager } from "./manager";
import { ConnectorScopeViolationError } from "./store";

/**
 * A scriptable adapter: the test enqueues updates; the adapter drains
 * them through the crash-safe deliver/commit contract, and can be made
 * to crash between updates.
 */
class ScriptedAdapter implements ConnectorAdapter {
	readonly kind = "scripted";
	readonly queues = new Map<
		ConnectorId,
		{ id: string; text: string; account?: string; conversation?: string }[]
	>();
	readonly contexts: ConnectorAdapterContext[] = [];
	readonly replies: { conversation: string; text: string }[] = [];
	crashAfterDeliver = false;
	runs = 0;

	enqueue(
		connectorId: ConnectorId,
		update: {
			id: string;
			text: string;
			account?: string;
			conversation?: string;
		},
	): void {
		const queue = this.queues.get(connectorId) ?? [];
		queue.push(update);
		this.queues.set(connectorId, queue);
	}

	async run(context: ConnectorAdapterContext): Promise<void> {
		this.runs += 1;
		this.contexts.push(context);
		while (!context.signal.aborted) {
			const queue = this.queues.get(context.descriptor.connectorId) ?? [];
			// Deliver only updates past the dedupe cursor.
			const cursor = context.cursor();
			const next = queue.find(
				(update) => cursor === undefined || update.id > cursor,
			);
			if (next) {
				const message: NormalizedConnectorMessage = {
					connectorId: context.descriptor.connectorId,
					externalAccountId: next.account ?? "acct-1",
					externalConversationId: next.conversation ?? "conv-1",
					externalMessageId: next.id,
					text: next.text,
				};
				context.deliver(message, next.id);
				if (this.crashAfterDeliver) {
					this.crashAfterDeliver = false;
					throw new Error("adapter crashed after committing");
				}
				continue;
			}
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
	}

	createReplyPort() {
		return {
			reply: async (
				conversation: { externalConversationId: string },
				text: string,
			) => {
				this.replies.push({
					conversation: conversation.externalConversationId,
					text,
				});
			},
		};
	}
}

function createHarness(options: { instanceStaleMs?: number } = {}) {
	const dataRoot = tempDataRoot();
	const paths = resolveGatewayPaths({ dataRoot, namespace: "default" });
	ensureGatewayDataDir(paths);
	const database = openGatewayDatabase(paths.databaseFile);
	const instanceId = createGatewayInstanceId();
	const stores = createGatewayStores(database, instanceId);
	const engine = new ScriptedEnginePort();
	engine.autoOutcome = () => ({ outputText: "handled" });
	const runtime = new GatewayRuntime({
		database,
		stores,
		paths,
		instanceId,
		engine,
	});
	runtime.bootstrap();
	const adapter = new ScriptedAdapter();
	const manager = new ConnectorManager({
		database,
		stores,
		admission: {
			submit: (botId, prompt, context) =>
				runtime.startConnectorRun({
					botId,
					prompt,
					connectorId: context.connectorId,
					externalAccountId: context.externalAccountId,
					externalConversationId: context.externalConversationId,
					sessionId: context.sessionId,
				}),
		},
		adapters: { scripted: adapter },
		gatewayInstanceId: instanceId,
		restartBackoffMs: 5,
		instanceStaleMs: options.instanceStaleMs ?? 30_000,
		heartbeatIntervalMs: 0,
	});
	const botId = runtime.defaultBotId;
	if (!botId) {
		throw new Error("bootstrap failed");
	}
	const connector = runtime.registerConnector("test", {
		botId,
		kind: "scripted",
		name: "scripted-connector",
	});
	return {
		dataRoot,
		paths,
		database,
		stores,
		runtime,
		engine,
		adapter,
		manager,
		botId,
		connector,
		instanceId,
	};
}

describe("bot-scoped connector config", () => {
	it("refuses cross-bot config access loudly", () => {
		const { runtime, stores, connector } = createHarness();
		const otherBot = runtime.delegateBot("test", {
			parentBotId: connector.botId,
			name: "other",
			role: "worker",
		});
		expect(() =>
			stores.connectors.getForBot(
				otherBot.identity.botId,
				connector.connectorId,
			),
		).toThrow(ConnectorScopeViolationError);
		expect(
			stores.connectors.getForBot(connector.botId, connector.connectorId)
				.connectorId,
		).toBe(connector.connectorId);
	});

	it("never lets a connector move to another bot", () => {
		const { runtime, stores, connector } = createHarness();
		const otherBot = runtime.delegateBot("test", {
			parentBotId: connector.botId,
			name: "other",
			role: "worker",
		});
		expect(() =>
			stores.connectors.save({
				...stores.connectors.getForBot(connector.botId, connector.connectorId),
				botId: otherBot.identity.botId,
			}),
		).toThrow(ConnectorScopeViolationError);
	});

	it("scopes listing by bot", () => {
		const { runtime, connector, botId } = createHarness();
		const otherBot = runtime.delegateBot("test", {
			parentBotId: botId,
			name: "other",
			role: "worker",
		});
		runtime.registerConnector("test", {
			botId: otherBot.identity.botId,
			kind: "scripted",
			name: "other-connector",
		});
		expect(runtime.listConnectors(botId).map((c) => c.connectorId)).toEqual([
			connector.connectorId,
		]);
		expect(runtime.listConnectors()).toHaveLength(2);
	});
});

describe("admission and dedupe cursor", () => {
	it("admits into a dedicated per-conversation session with connector provenance", async () => {
		const { manager, adapter, connector, stores, runtime } = createHarness();
		adapter.enqueue(connector.connectorId, { id: "0001", text: "hi" });
		expect(manager.start(connector.connectorId)).toBe(true);
		await waitFor(
			() => stores.connectorCursors.get(connector.connectorId) === "0001",
		);
		const route = stores.connectorRoutes.get(
			connector.connectorId,
			"acct-1",
			"conv-1",
		);
		expect(route?.botId).toBe(connector.botId);
		const runs = stores.runs.listBySession(route?.sessionId as never);
		expect(runs).toHaveLength(1);
		expect(runs[0].input).toBe("[scripted:conv-1] hi");
		const provenance = runtime.runProvenance(runs[0].runId);
		expect(provenance?.mode).toBe("connector");
		expect(provenance?.connectorId).toBe(connector.connectorId);
		// The conversation's session is DEDICATED (not the canonical one).
		expect(stores.sessions.get(route?.sessionId as never)?.kind).toBe(
			"dedicated",
		);

		// A desktop/CLI prompt for the same bot lands in the bot's own
		// canonical session — external users never inherit desktop context
		// and vice versa.
		const interactive = runtime.startRun("cli_test", {
			botId: connector.botId,
			prompt: "from desktop",
		});
		const interactiveSession = stores.runs.get(interactive.runId)?.sessionId;
		expect(interactiveSession).not.toBe(route?.sessionId);
		expect(stores.sessions.get(interactiveSession as never)?.kind).toBe(
			"canonical",
		);

		// Desktop can still join the conversation INTENTIONALLY by naming
		// the dedicated session.
		const joined = runtime.startRun("cli_test", {
			botId: connector.botId,
			prompt: "desktop assist",
			sessionId: route?.sessionId,
		});
		expect(stores.runs.get(joined.runId)?.sessionId).toBe(route?.sessionId);
		await manager.stop();
	});

	it("keeps unrelated external conversations in separate sessions", async () => {
		const { manager, adapter, connector, stores } = createHarness();
		adapter.enqueue(connector.connectorId, {
			id: "0001",
			text: "chat one",
			conversation: "conv-1",
		});
		adapter.enqueue(connector.connectorId, {
			id: "0002",
			text: "chat two",
			conversation: "conv-2",
		});
		adapter.enqueue(connector.connectorId, {
			id: "0003",
			text: "chat one again",
			conversation: "conv-1",
		});
		manager.start(connector.connectorId);
		await waitFor(
			() => stores.connectorCursors.get(connector.connectorId) === "0003",
		);
		const routeOne = stores.connectorRoutes.get(
			connector.connectorId,
			"acct-1",
			"conv-1",
		);
		const routeTwo = stores.connectorRoutes.get(
			connector.connectorId,
			"acct-1",
			"conv-2",
		);
		// Separate conversations, separate dedicated sessions.
		expect(routeOne?.sessionId).not.toBe(routeTwo?.sessionId);
		// The follow-up message reused conversation one's session.
		expect(
			stores.runs
				.listBySession(routeOne?.sessionId as never)
				.map((run) => run.input),
		).toEqual([
			"[scripted:conv-1] chat one",
			"[scripted:conv-1] chat one again",
		]);
		expect(
			stores.runs
				.listBySession(routeTwo?.sessionId as never)
				.map((run) => run.input),
		).toEqual(["[scripted:conv-2] chat two"]);
		await manager.stop();
	});

	it("restarts a crashed worker from the cursor without duplicates", async () => {
		const { manager, adapter, connector, stores } = createHarness();
		adapter.enqueue(connector.connectorId, { id: "0001", text: "one" });
		adapter.enqueue(connector.connectorId, { id: "0002", text: "two" });
		adapter.crashAfterDeliver = true;
		manager.start(connector.connectorId);
		// The worker crashes after committing 0001, restarts with backoff,
		// resumes from the cursor, and delivers only 0002.
		await waitFor(
			() => stores.connectorCursors.get(connector.connectorId) === "0002",
			{ timeoutMs: 10_000 },
		);
		expect(adapter.runs).toBeGreaterThanOrEqual(2);
		const route = stores.connectorRoutes.get(
			connector.connectorId,
			"acct-1",
			"conv-1",
		);
		const runs = stores.runs.listBySession(route?.sessionId as never);
		expect(runs.map((run) => run.input)).toEqual([
			"[scripted:conv-1] one",
			"[scripted:conv-1] two",
		]);
		await manager.stop();
	});
});

describe("one worker per connector instance", () => {
	it("a second start in the same process is refused", () => {
		const { manager, connector } = createHarness();
		expect(manager.start(connector.connectorId)).toBe(true);
		expect(manager.start(connector.connectorId)).toBe(false);
	});

	it("a live foreign claim blocks a duplicate instance; a stale one is taken over", () => {
		const { stores, connector } = createHarness();
		const foreignInstance = createGatewayInstanceId();
		const now = 1_000_000;
		expect(
			stores.connectorInstances.claim(
				connector.connectorId,
				createWorkerId(),
				foreignInstance,
				now,
				30_000,
			),
		).toBe(true);
		// A live foreign claim wins: no duplicate instance.
		const ourInstance = createGatewayInstanceId();
		expect(
			stores.connectorInstances.claim(
				connector.connectorId,
				createWorkerId(),
				ourInstance,
				now + 1_000,
				30_000,
			),
		).toBe(false);
		// After the stale window the claim is recoverable.
		expect(
			stores.connectorInstances.claim(
				connector.connectorId,
				createWorkerId(),
				ourInstance,
				now + 60_000,
				30_000,
			),
		).toBe(true);
	});

	it("the manager refuses to start when a live foreign instance owns the connector", () => {
		const { manager, stores, connector } = createHarness();
		stores.connectorInstances.claim(
			connector.connectorId,
			createWorkerId(),
			createGatewayInstanceId(),
			Date.now(),
			30_000,
		);
		expect(manager.start(connector.connectorId)).toBe(false);
	});
});

describe("reply capability", () => {
	it("hands the bot an authorized reply port without adapter credentials", async () => {
		const { manager, adapter, connector } = createHarness();
		const replyPort = manager.replyPortFor(connector.connectorId);
		await replyPort.reply(
			{ externalAccountId: "acct-1", externalConversationId: "conv-1" },
			"done!",
		);
		expect(adapter.replies).toEqual([
			{ conversation: "conv-1", text: "done!" },
		]);
		// The port's surface carries no credential material.
		expect(JSON.stringify(Object.keys(replyPort))).not.toContain("credential");
	});
});
