/**
 * Wire-level proof of plugin UI over the hub: the composer-suggestions
 * fixture runs in a hub session started by a real hub-mode ClineCore, and a
 * second client on its own socket reads, drives and leaves the slot.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	HubEventEnvelope,
	HubReplyEnvelope,
	HubTransportFrame,
	PluginUiViewer,
} from "@cline/shared";
import { setClineDir, setHomeDir } from "@cline/shared/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { ClineCore } from "../../ClineCore";
import {
	PluginRegistry,
	resetProcessPluginRegistryForTests,
} from "../../extensions/plugin/plugin-registry";
import { LocalRuntimeHost } from "../../runtime/host/local-runtime-host";
import { FileSessionService } from "../../session/services/file-session-service";
import type { CoreSessionEvent } from "../../types/events";
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers";
import { createInMemoryHubOwnerContext } from "../discovery";
import type { HubWebSocketServer } from "./hub-server-options";
import { startHubWebSocketServer } from "./hub-websocket-server";

const SLOT = "composer.suggestions";
const FIXTURE = "composer-suggestions-demo";
const fixturePath = fileURLToPath(
	new URL(
		"../../../../../examples/plugins/composer-suggestions.ts",
		import.meta.url,
	),
);
const originalClineDir = process.env.CLINE_DIR;
const originalHome = process.env.HOME;

/** A raw hub socket that collects events and answers commands by request id. */
class WireClient {
	readonly events: HubEventEnvelope[] = [];
	private readonly replies = new Map<
		string,
		(reply: HubReplyEnvelope) => void
	>();
	private requests = 0;

	private constructor(
		readonly socket: WebSocket,
		readonly clientId: string,
	) {
		socket.on("message", (raw) => {
			const frame = JSON.parse(String(raw)) as HubTransportFrame;
			if (frame.kind === "event") this.events.push(frame.envelope);
			if (frame.kind === "reply" && frame.envelope.requestId) {
				this.replies.get(frame.envelope.requestId)?.(frame.envelope);
			}
		});
	}

	static async connect(
		server: HubWebSocketServer,
		clientId: string,
	): Promise<WireClient> {
		const socket = new WebSocket(
			server.url,
			`cline-hub-auth.${server.authToken}`,
		);
		await new Promise<void>((resolve, reject) => {
			socket.once("open", () => resolve());
			socket.once("error", reject);
		});
		return new WireClient(socket, clientId);
	}

	command(
		command: string,
		payload: Record<string, unknown>,
		sessionId?: string,
	): Promise<HubReplyEnvelope> {
		const requestId = `${this.clientId}-${++this.requests}`;
		const reply = new Promise<HubReplyEnvelope>((resolve) => {
			this.replies.set(requestId, resolve);
		});
		this.send({
			kind: "command",
			envelope: {
				version: "v1",
				command,
				requestId,
				clientId: this.clientId,
				...(sessionId ? { sessionId } : {}),
				payload,
			},
		} as HubTransportFrame);
		return reply;
	}

	send(frame: HubTransportFrame): void {
		this.socket.send(JSON.stringify(frame));
	}
}

describe("plugin UI over the hub wire", () => {
	let root: string;
	let server: HubWebSocketServer | undefined;
	let core: ClineCore | undefined;
	let wire: WireClient | undefined;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "cline-hub-plugin-ui-wire-"));
		setHomeDir(root);
		setClineDir(join(root, ".cline"));
		resetProcessPluginRegistryForTests(new PluginRegistry());
		const plugins = join(root, ".cline", "plugins");
		mkdirSync(plugins, { recursive: true });
		// Loads the in-repo fixture as a workspace plugin of the hub session.
		writeFileSync(
			join(plugins, "composer-suggestions.ts"),
			`export { default } from ${JSON.stringify(fixturePath)};\n`,
		);
	});

	afterEach(async () => {
		wire?.socket.close();
		wire = undefined;
		await core?.dispose();
		core = undefined;
		await server?.close().catch(() => undefined);
		server = undefined;
		resetProcessPluginRegistryForTests(undefined);
		setHomeDir(originalHome ?? "~");
		setClineDir(originalClineDir ?? join(originalHome ?? "~", ".cline"));
		rmSync(root, { recursive: true, force: true });
	});

	it("serves, replays, routes and releases the fixture's slot across two clients", async () => {
		const runtime = new LocalRuntimeHost({
			sessionService: new FileSessionService(join(root, "sessions")),
		});
		server = await startHubWebSocketServer({
			owner: createInMemoryHubOwnerContext("hub-plugin-ui-wire"),
			host: "127.0.0.1",
			port: 0,
			pathname: "/hub",
			workspaceRoot: root,
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			scheduleOptions: { dbPath: ":memory:" },
			taskOptions: {
				dbPath: join(root, "tasks.db"),
				globalSpecsDir: join(root, "specs"),
				watchFiles: false,
			},
			sessionSearchOptions: { dbPath: ":memory:" },
			eventLog: { dbPath: ":memory:" },
			runQueue: { dbPath: ":memory:" },
			sessionHost: runtime,
		});
		const viewers = (sessionId: string): PluginUiViewer[] =>
			(
				Reflect.get(runtime.pluginUi, "store") as {
					viewers(sessionId: string): PluginUiViewer[];
				}
			).viewers(sessionId);

		core = await ClineCore.create({
			clientName: "plugin-ui-wire",
			distinctId: "plugin-ui-wire",
			backendMode: "hub",
			hub: {
				endpoint: server.url,
				authToken: server.authToken,
				workspaceRoot: root,
				cwd: root,
				clientType: "wire-a",
			},
		});
		const seenByA: CoreSessionEvent[] = [];
		core.subscribe((event) => seenByA.push(event));
		const { sessionId } = await core.start({
			config: {
				providerId: "openai-native",
				modelId: "gpt-4o-mini",
				apiKey: "test",
				cwd: root,
				workspaceRoot: root,
				systemPrompt: "test",
				enableTools: false,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
			interactive: true,
			uiSlots: [SLOT],
		});

		const [setupState] = await core.pluginUi.get({ sessionId });
		expect(setupState).toMatchObject({
			sessionId,
			slot: SLOT,
			plugin: FIXTURE,
			seq: 1,
			state: { status: "ready", title: "Demo", revision: "r1" },
		});

		wire = await WireClient.connect(server, "wire-b");
		expect(
			await wire.command("client.register", {
				clientId: "wire-b",
				clientType: "wire-b",
				workspaceContext: { workspaceRoot: root, cwd: root },
			}),
		).toMatchObject({ ok: true });
		wire.send({ kind: "stream.subscribe", clientId: "wire-b", sessionId });
		await expect
			.poll(() =>
				wire?.events.find((event) => event.event === "plugins.ui.state"),
			)
			.toMatchObject({ sessionId, payload: setupState });
		const reissued = wire.events.find(
			(event) => event.event === "plugins.ui.state",
		);
		expect(reissued?.sequence).toBeUndefined();

		const attached = await wire.command(
			"plugins.ui.invoke",
			{ slot: SLOT, action: { verb: "attach", surface: "desktop" } },
			sessionId,
		);
		expect(attached).toMatchObject({
			ok: true,
			payload: { outcome: "ok", epoch: setupState?.epoch },
		});
		expect(viewers(sessionId)).toEqual([
			expect.objectContaining({ id: "wire-b", surface: "desktop" }),
		]);

		const refreshed = await wire.command(
			"plugins.ui.invoke",
			{
				slot: SLOT,
				action: {
					verb: "refresh",
					revision: "r1",
					input: "pointer",
					cause: "new_set",
				},
			},
			sessionId,
		);
		expect(refreshed).toMatchObject({
			ok: true,
			payload: { outcome: "ok", state: { seq: 2, state: { revision: "r2" } } },
		});
		await expect
			.poll(() =>
				seenByA.flatMap((event) =>
					event.type === "plugin_ui_state" &&
					event.payload.sessionId === sessionId
						? [event.payload.seq]
						: [],
				),
			)
			.toContain(2);

		wire.socket.close();
		await expect.poll(() => viewers(sessionId)).toEqual([]);
	});
});
