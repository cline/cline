import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	ComposerSuggestionsState,
	HubCommandEnvelope,
	HubEventEnvelope,
	ITelemetryService,
	PluginUiStateEnvelope,
} from "@cline/shared";
import { setClineDir, setHomeDir } from "@cline/shared/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	PluginRegistry,
	resetProcessPluginRegistryForTests,
} from "../../extensions/plugin/plugin-registry";
import { LocalRuntimeHost } from "../../runtime/host/local-runtime-host";
import { FileSessionService } from "../../session/services/file-session-service";
import { SessionVersioningService } from "../../session/session-versioning-service";
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers";
import type { HubConnectionAuthority } from "./command-transport";
import type { HubTransportContext } from "./handlers/context";
import { projectSessionEvent } from "./handlers/session-event-projector";
import { HubServerTransport } from "./hub-server-transport";

const SLOT = "composer.suggestions";
const PLUGIN = "slot-recorder";
const SECRET = "secret prompt text";
const STATE: ComposerSuggestionsState = {
	status: "ready",
	title: "Demo",
	revision: "r1",
	items: [
		{
			id: "verify",
			label: "Verify",
			tone: "check",
			prompt: "Run the whole test suite",
			sendable: true,
		},
	],
	canRefresh: true,
};

interface RecordedSetup {
	setup: string;
	slotApi: boolean;
	slots: string[] | null;
}

interface RecordedAction {
	verb: string;
	viewer: { id: string; clientType?: string; surface?: string };
	viewers: number;
}

let root: string;
let runtime: LocalRuntimeHost;
let transport: HubServerTransport;
const capture = vi.fn();
const captureRequired = vi.fn();
const telemetry = {
	capture,
	captureRequired,
	setDistinctId: vi.fn(),
	updateCommonProperties: vi.fn(),
} as unknown as ITelemetryService;
const originalClineDir = process.env.CLINE_DIR;
const originalHome = process.env.HOME;

function logPath(): string {
	return join(root, "slot-recorder.log");
}

/** Records every setup and action to a file, since the plugin runs in a worker. */
function recorderPluginSource(): string {
	return `import { appendFileSync } from "node:fs";
const LOG = ${JSON.stringify(logPath())};
const STATE = ${JSON.stringify(STATE)};
const record = (entry) => appendFileSync(LOG, JSON.stringify(entry) + "\\n");
export default {
	name: ${JSON.stringify(PLUGIN)},
	manifest: { capabilities: ["commands"] },
	setup(api, ctx) {
		record({ setup: ctx.session?.sessionId, slotApi: typeof api.registerUiSlot === "function", slots: ctx.ui?.slots ?? null });
		if (!api.registerUiSlot || !ctx.ui?.slots.includes(${JSON.stringify(SLOT)})) return;
		const ui = ctx.ui;
		let revision = 1;
		api.registerUiSlot({
			slot: ${JSON.stringify(SLOT)},
			onAction(action, context) {
				record({ verb: action.verb, viewer: context.viewer, viewers: context.viewers });
				if (action.verb === "use") throw new Error(${JSON.stringify(SECRET)});
				if (action.verb === "refresh") {
					revision += 1;
					ui.update(${JSON.stringify(SLOT)}, { ...STATE, revision: "r" + revision });
				}
				return { outcome: "ok" };
			},
		});
		ui.update(${JSON.stringify(SLOT)}, STATE);
	},
};
`;
}

async function readRecorded(): Promise<Array<RecordedSetup | RecordedAction>> {
	const text = await readFile(logPath(), "utf8").catch(() => "");
	return text
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

async function recordedSetups(): Promise<RecordedSetup[]> {
	return (await readRecorded()).filter(
		(entry): entry is RecordedSetup => "setup" in entry,
	);
}

async function recordedActions(): Promise<RecordedAction[]> {
	return (await readRecorded()).filter(
		(entry): entry is RecordedAction => "verb" in entry,
	);
}

function command(
	name: HubCommandEnvelope["command"],
	options: {
		payload?: Record<string, unknown>;
		sessionId?: string;
		clientId?: string;
	} = {},
	authority?: HubConnectionAuthority | null,
) {
	return transport.handleCommand(
		{
			version: "v1",
			requestId: Math.random().toString(),
			clientId: options.clientId ?? "creator",
			command: name,
			payload: options.payload,
			sessionId: options.sessionId,
		},
		authority,
	);
}

function sessionConfig(sessionId: string) {
	return {
		sessionId,
		providerId: "openai-native",
		modelId: "gpt-4o-mini",
		apiKey: "test",
		systemPrompt: "test",
		enableTools: false,
		enableSpawnAgent: false,
		enableAgentTeams: false,
	};
}

async function createSession(
	sessionId: string,
	extra: Record<string, unknown> = { uiSlots: [SLOT] },
): Promise<void> {
	const reply = await command("session.create", {
		payload: {
			workspaceRoot: root,
			cwd: root,
			sessionConfig: sessionConfig(sessionId),
			...extra,
		},
	});
	expect(reply).toMatchObject({ ok: true });
}

/** Restores through the real handler, with the checkpoint lookup and workspace restore stubbed out. */
async function restoreSession(
	sessionId: string,
	extra: Record<string, unknown>,
): Promise<void> {
	const restoreCheckpoint = vi
		.spyOn(SessionVersioningService.prototype, "restoreCheckpoint")
		.mockImplementationOnce(async (input) => {
			const context = {
				sourceSession: { workspaceRoot: root, cwd: root },
				plan: { cwd: root },
				initialMessages: [],
			};
			const startInput = await input.buildStartInput?.(
				context as never,
				input.start,
			);
			const startResult = await input.startSession?.(startInput as never);
			return { startResult, messages: [], checkpoint: {} } as never;
		});
	try {
		const reply = await command("session.restore", {
			payload: {
				sessionId: "source-session",
				checkpointRunCount: 1,
				workspaceRoot: root,
				cwd: root,
				sessionConfig: sessionConfig(sessionId),
				...extra,
			},
		});
		expect(reply).toMatchObject({ ok: true });
	} finally {
		restoreCheckpoint.mockRestore();
	}
}

async function registerViewer(
	clientId: string,
	clientType = "desktop-test",
): Promise<void> {
	const reply = await command("client.register", {
		clientId,
		payload: { clientId, clientType },
	});
	expect(reply).toMatchObject({ ok: true });
}

function invoke(
	sessionId: string,
	action: Record<string, unknown>,
	authority: HubConnectionAuthority | null,
	extra: Record<string, unknown> = {},
) {
	return command(
		"plugins.ui.invoke",
		{
			clientId: authority?.clientId ?? "viewer-1",
			sessionId,
			payload: { slot: SLOT, action, ...extra },
		},
		authority,
	);
}

const attach = { verb: "attach", surface: "desktop" };
/** Any ordinary verb runs behind every detach already queued on the session's chain. */
const exposed = { verb: "exposed", revision: "r1", itemIds: ["verify"] };

beforeEach(async () => {
	capture.mockClear();
	captureRequired.mockClear();
	root = await mkdtemp(join(tmpdir(), "hub-plugin-ui-test-"));
	setHomeDir(root);
	setClineDir(join(root, ".cline"));
	resetProcessPluginRegistryForTests(new PluginRegistry());
	const directory = join(root, ".cline", "plugins");
	await mkdir(directory, { recursive: true });
	await writeFile(join(directory, `${PLUGIN}.js`), recorderPluginSource());
	runtime = new LocalRuntimeHost({
		sessionService: new FileSessionService(join(root, "sessions")),
		telemetry,
	});
	transport = new HubServerTransport({
		sessionHost: runtime,
		workspaceRoot: root,
		eventLog: false,
		runQueue: false,
		telemetry,
		sessionSearchOptions: { dbPath: ":memory:" },
		runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
	});
});

afterEach(async () => {
	await transport?.stop();
	resetProcessPluginRegistryForTests(undefined);
	setHomeDir(originalHome ?? "~");
	setClineDir(originalClineDir ?? join(originalHome ?? "~", ".cline"));
	await rm(root, { recursive: true, force: true });
});

describe("plugins.ui hub commands", () => {
	it("stamps the viewer from the registered connection, not the envelope clientId or a payload viewerId", async () => {
		const sessionId = "sess-ui-viewer";
		await createSession(sessionId);
		await registerViewer("viewer-1");
		const authority = { clientId: "viewer-1", connectionId: "conn-1" };

		const got = await command(
			"plugins.ui.get",
			{ clientId: "viewer-1", sessionId },
			authority,
		);
		expect(got).toMatchObject({
			ok: true,
			payload: {
				states: [
					{ sessionId, slot: SLOT, plugin: PLUGIN, seq: 1, state: STATE },
				],
			},
		});

		await registerViewer("other-client", "other-test");
		const attached = await command(
			"plugins.ui.invoke",
			{
				clientId: "other-client",
				sessionId,
				payload: { slot: SLOT, action: attach, viewerId: "spoofed" },
			},
			authority,
		);
		expect(attached).toMatchObject({
			ok: true,
			payload: {
				outcome: "ok",
				epoch: expect.any(Number),
				state: { sessionId, seq: 1, state: STATE },
			},
		});
		expect(await recordedActions()).toEqual([
			{
				verb: "attach",
				viewer: {
					id: "viewer-1",
					clientType: "desktop-test",
					surface: "desktop",
				},
				viewers: 1,
			},
		]);

		expect(
			await command("plugins.ui.get", { clientId: "viewer-1" }, authority),
		).toMatchObject({ ok: true, payload: { states: [] } });
		expect(await invoke("", attach, authority)).toMatchObject({
			ok: true,
			payload: { outcome: "unavailable" },
		});
	});

	it("answers unavailable to a socket that has not registered, whatever clientId it claims", async () => {
		const sessionId = "sess-ui-unregistered";
		await createSession(sessionId);
		await registerViewer("viewer-1");

		const reply = await command(
			"plugins.ui.invoke",
			{
				clientId: "viewer-1",
				sessionId,
				payload: { slot: SLOT, action: attach },
			},
			null,
		);

		expect(reply).toEqual({
			version: "v1",
			requestId: expect.any(String),
			ok: true,
			payload: { outcome: "unavailable" },
		});
		expect(await recordedActions()).toEqual([]);
	});

	it("publishes state live without logging it, and re-issues it on a session-scoped subscribe", async () => {
		await transport.stop();
		transport = new HubServerTransport({
			sessionHost: runtime,
			workspaceRoot: root,
			eventLog: { dbPath: ":memory:" },
			runQueue: false,
			sessionSearchOptions: { dbPath: ":memory:" },
			scheduleOptions: { dbPath: ":memory:" },
			taskOptions: { dbPath: ":memory:", watchFiles: false },
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		});
		await transport.start();
		const sessionId = "sess-ui-replay";
		const live: HubEventEnvelope[] = [];
		transport.subscribe("observer", (event) => live.push(event));
		await createSession(sessionId);
		await registerViewer("viewer-1");
		const authority = { clientId: "viewer-1", connectionId: "conn-1" };
		await invoke(sessionId, attach, authority);
		await invoke(
			sessionId,
			{ verb: "refresh", revision: "r1", input: "pointer", cause: "new_set" },
			authority,
		);

		const liveStates = live.filter(
			(event) => event.event === "plugins.ui.state",
		);
		expect(liveStates.map((event) => event.payload?.seq)).toEqual([1, 2]);
		for (const event of liveStates) {
			expect(event.sessionId).toBe(sessionId);
			expect(event.sequence).toBeUndefined();
		}
		const logged = transport.replayEventsAfter(0, { limit: 10_000 });
		expect(logged.some((event) => event.event === "session.created")).toBe(
			true,
		);
		expect(logged.some((event) => event.event === "plugins.ui.state")).toBe(
			false,
		);

		const scoped: HubEventEnvelope[] = [];
		const global: HubEventEnvelope[] = [];
		transport.subscribe("late", (event) => scoped.push(event), { sessionId });
		transport.subscribe("late-global", (event) => global.push(event));
		await vi.waitFor(() => expect(scoped).toHaveLength(1));
		expect(scoped[0]).toMatchObject({
			event: "plugins.ui.state",
			sessionId,
			payload: {
				sessionId,
				slot: SLOT,
				plugin: PLUGIN,
				seq: 2,
				state: { ...STATE, revision: "r2" },
			},
		});
		expect(scoped[0]?.sequence).toBeUndefined();
		expect(global).toEqual([]);
	});

	it("detaches a viewer when its connection unregisters, so the plugin sees viewers reach 0", async () => {
		const sessionId = "sess-ui-unregister";
		await createSession(sessionId);
		await registerViewer("viewer-1");
		const authority = { clientId: "viewer-1", connectionId: "conn-1" };
		await invoke(sessionId, attach, authority);

		await command("client.unregister", { clientId: "viewer-1" }, authority);

		await vi.waitFor(async () =>
			expect(await recordedActions()).toEqual([
				expect.objectContaining({ verb: "attach", viewers: 1 }),
				expect.objectContaining({
					verb: "detach",
					viewer: expect.objectContaining({ id: "viewer-1" }),
					viewers: 0,
				}),
			]),
		);
	});

	it("keeps a lease that re-attached on a new connection when the old connection unregisters late", async () => {
		const sessionId = "sess-ui-late-unregister";
		await createSession(sessionId);
		await registerViewer("viewer-1");
		const oldConnection = { clientId: "viewer-1", connectionId: "conn-old" };
		const newConnection = { clientId: "viewer-1", connectionId: "conn-new" };
		await invoke(sessionId, attach, oldConnection);
		await invoke(sessionId, attach, newConnection);

		await command("client.unregister", { clientId: "viewer-1" }, oldConnection);
		await invoke(sessionId, exposed, newConnection);
		expect((await recordedActions()).map((action) => action.verb)).toEqual([
			"attach",
			"attach",
			"exposed",
		]);
		expect((await recordedActions()).at(-1)?.viewers).toBe(1);

		await command("client.unregister", { clientId: "viewer-1" }, newConnection);
		await vi.waitFor(async () =>
			expect((await recordedActions()).at(-1)).toMatchObject({
				verb: "detach",
				viewers: 0,
			}),
		);
	});

	it("never ends leases for an unregister from a socket that has not registered", async () => {
		const sessionId = "sess-ui-unregistered-unregister";
		await createSession(sessionId);
		await registerViewer("viewer-1");
		const authority = { clientId: "viewer-1", connectionId: "conn-1" };
		await invoke(sessionId, attach, authority);
		const detachViewer = vi.spyOn(runtime.pluginUi, "detachViewer");

		await command(
			"client.unregister",
			{ clientId: "viewer-1", payload: { connectionId: "conn-1" } },
			null,
		);
		await registerViewer("viewer-1");
		await invoke(sessionId, exposed, authority);
		expect(detachViewer).not.toHaveBeenCalled();
		expect((await recordedActions()).at(-1)).toMatchObject({
			verb: "exposed",
			viewers: 1,
		});

		// The adapter's own close command carries no authority, only its connection.
		await command("client.unregister", {
			clientId: "viewer-1",
			payload: { connectionId: "conn-1" },
		});
		expect(detachViewer).toHaveBeenCalledExactlyOnceWith("viewer-1", "conn-1");
		await vi.waitFor(async () =>
			expect((await recordedActions()).at(-1)).toMatchObject({
				verb: "detach",
				viewers: 0,
			}),
		);
	});

	it.each([
		["session.create", createSession],
		["session.restore", restoreSession],
	])("%s keeps only the known slots of the declared catalog", async (_, start) => {
		await start("sess-ui-declared", { uiSlots: [SLOT, "bogus"] });
		await start("sess-ui-undeclared", {});

		const setups = await recordedSetups();
		expect(setups).toEqual(
			expect.arrayContaining([
				{ setup: "sess-ui-declared", slotApi: true, slots: [SLOT] },
				{ setup: "sess-ui-undeclared", slotApi: false, slots: null },
			]),
		);
		expect(
			await command("plugins.ui.get", { sessionId: "sess-ui-undeclared" }),
		).toMatchObject({ ok: true, payload: { states: [] } });
	});

	it("rejects a throwing handler without capturing its message", async () => {
		const sessionId = "sess-ui-throwing";
		await createSession(sessionId);
		await registerViewer("viewer-1");
		const authority = { clientId: "viewer-1", connectionId: "conn-1" };
		await invoke(sessionId, attach, authority);

		const reply = await invoke(
			sessionId,
			{ verb: "use", input: "key", revision: "r1", itemId: "verify" },
			authority,
		);

		expect(reply).toMatchObject({
			ok: true,
			payload: { outcome: "rejected", epoch: expect.any(Number) },
		});
		expect(JSON.stringify(reply)).not.toContain(SECRET);
		expect(JSON.stringify(capture.mock.calls)).not.toContain(SECRET);
		expect(JSON.stringify(captureRequired.mock.calls)).not.toContain(SECRET);
	});
});

describe("plugins.ui without a plugin UI runtime", () => {
	it("replies plugin_ui_unavailable without capturing an error", async () => {
		await transport.stop();
		transport = new HubServerTransport({
			sessionHost: {
				subscribe: vi.fn(() => () => {}),
				dispose: vi.fn(),
			} as never,
			workspaceRoot: root,
			eventLog: false,
			runQueue: false,
			telemetry,
			sessionSearchOptions: { dbPath: ":memory:" },
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		});
		capture.mockClear();

		for (const name of ["plugins.ui.get", "plugins.ui.invoke"] as const) {
			expect(
				await command(name, {
					sessionId: "sess-any",
					payload: { slot: SLOT, action: attach },
				}),
			).toMatchObject({
				ok: false,
				error: {
					code: "plugin_ui_unavailable",
					message: "This runtime does not support plugin UI",
				},
			});
		}
		expect(capture).not.toHaveBeenCalled();
	});

	it("skips plugin UI state on a context without publishEphemeral", async () => {
		const envelope: PluginUiStateEnvelope = {
			sessionId: "sess-any",
			slot: SLOT,
			plugin: PLUGIN,
			epoch: 1,
			seq: 1,
			state: STATE,
		};
		const ctx = {
			publish: vi.fn(),
			buildEvent: vi.fn(),
		} as unknown as HubTransportContext;

		await expect(
			projectSessionEvent(ctx, { type: "plugin_ui_state", payload: envelope }),
		).resolves.toBeUndefined();
		expect(ctx.publish).not.toHaveBeenCalled();
	});
});
