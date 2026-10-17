import type { AgentExtensionUiSlot, SessionPluginIssue } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { createClineCorePluginUiApi } from "../../cline-core/runtime-services";
import {
	getProcessPluginRegistry,
	type PluginUiStatePush,
} from "../../extensions/plugin/plugin-registry";
import { CORE_TELEMETRY_EVENTS } from "../../services/telemetry/core-events";
import { TelemetryService } from "../../services/telemetry/TelemetryService";
import { SessionVersioningService } from "../../session/session-versioning-service";
import type { CoreSessionEvent } from "../../types/events";
import {
	createConfig,
	normalizeStartInput,
	pluginUiSlotHelpers,
	useIsolatedHome,
} from "./local-runtime-host.plugin-ui.fixtures";
import type { StartSessionResult } from "./runtime-host";

describe("LocalRuntimeHost", () => {
	const homeDir = useIsolatedHome();

	describe("plugin UI slots", () => {
		const {
			SLOT,
			FIXTURE,
			fixturePath,
			attach,
			createSlotHost,
			startFixtureSession,
			uiStates,
		} = pluginUiSlotHelpers(homeDir);

		it.each([
			["declares no slots", undefined],
			["declares only slots this core does not know", ["bogus"]],
		])("offers the fixture no slot API when the session %s", async (_, uiSlots) => {
			const sessionId = "sess-composer-suggestions-no-slots";
			const { manager, agents } = createSlotHost();
			try {
				await startFixtureSession(manager, sessionId, uiSlots);
				const agent = agents[0];
				const fixture = agent?.extensions.find(
					(extension) => extension.name === FIXTURE,
				);
				expect(fixture).toBeDefined();
				const registered: AgentExtensionUiSlot[] = [];
				await fixture?.setup?.(
					{
						registerTool: vi.fn(),
						registerCommand: vi.fn(),
						registerRule: vi.fn(),
						registerMessageBuilder: vi.fn(),
						registerProvider: vi.fn(),
						registerAutomationEventType: vi.fn(),
						registerMcpServer: vi.fn(),
						registerUiSlot: (uiSlot) => registered.push(uiSlot),
					},
					{},
				);
				// No catalog, so the plugin was offered no slot API and set itself up without one.
				expect(registered).toEqual([]);
				await expect(manager.pluginUi.get({ sessionId })).resolves.toEqual([]);
				await expect(
					manager.pluginUi.invoke({ ...attach, sessionId }),
				).resolves.toEqual({
					outcome: "unavailable",
					epoch: expect.any(Number),
				});
				expect(agent?.initializeExtensions).not.toHaveBeenCalled();
			} finally {
				await manager.dispose();
			}
		});

		it("serves the fixture's state through pluginUi when the session declares composer.suggestions", async () => {
			const sessionId = "sess-composer-suggestions-fixture";
			const { manager, agents, isResident } = createSlotHost();
			const events: CoreSessionEvent[] = [];
			const residentAtEmit: boolean[] = [];
			const attachedFromListener: Array<Promise<unknown>> = [];
			manager.subscribe((event) => {
				events.push(event);
				if (event.type !== "plugin_ui_state") return;
				residentAtEmit.push(isResident(sessionId));
				attachedFromListener.push(
					manager.pluginUi.invoke({ ...attach, sessionId }),
				);
			});
			try {
				await startFixtureSession(manager, sessionId, [SLOT]);

				// The setup-time push is emitted once, only after the session is resident.
				expect(uiStates(events)).toHaveLength(1);
				expect(residentAtEmit).toEqual([true]);
				const [setupState] = await manager.pluginUi.get({ sessionId });
				expect(setupState).toMatchObject({
					sessionId,
					slot: SLOT,
					plugin: FIXTURE,
					seq: 1,
					state: { status: "ready", revision: "r1", title: "Demo" },
				});
				const epoch = setupState?.epoch;
				await expect(
					createClineCorePluginUiApi(manager).get({ sessionId }),
				).resolves.toEqual([setupState]);

				// An attach sent by a listener of that first event reaches a live session.
				await expect(Promise.all(attachedFromListener)).resolves.toEqual([
					{ outcome: "ok", epoch, state: setupState },
				]);
				const agent = agents[0];
				expect(agent?.initializeExtensions).toHaveBeenCalledTimes(1);
				expect(agent?.getExtensionRegistry().uiSlots).toEqual([
					expect.objectContaining({ slot: SLOT, plugin: FIXTURE }),
				]);

				const skipped = await manager.pluginUi.invoke({
					sessionId,
					slot: SLOT,
					action: {
						verb: "skip",
						input: "key",
						revision: "r1",
						itemId: "verify",
					},
				});
				expect(skipped).toMatchObject({
					outcome: "ok",
					epoch,
					state: {
						seq: 2,
						state: { revision: "r2", items: [{ id: "commit" }] },
					},
				});
				await expect(
					manager.pluginUi.invoke({
						sessionId,
						slot: SLOT,
						action: {
							verb: "skip",
							input: "key",
							revision: "r1",
							itemId: "commit",
						},
					}),
				).resolves.toMatchObject({
					outcome: "refused",
					reason: "stale",
					epoch,
				});
			} finally {
				await manager.dispose();
			}
		});

		it("keeps delivering plugin UI state when another subscriber throws", async () => {
			const sessionId = "sess-composer-suggestions-throwing-listener";
			const { manager } = createSlotHost();
			const events: CoreSessionEvent[] = [];
			manager.subscribe(() => {
				throw new Error("listener failed");
			});
			manager.subscribe((event) => events.push(event));
			try {
				await startFixtureSession(manager, sessionId, [SLOT]);
				expect(uiStates(events)).toHaveLength(1);
			} finally {
				await manager.dispose();
			}
		});

		it("re-attaches against a same-id restart and ignores the old epoch's late push and close", async () => {
			const sessionId = "sess-composer-suggestions-restart";
			const { manager, service, isResident } = createSlotHost();
			const seen: Array<{ epoch: number; resident: boolean }> = [];
			const reattached: Array<Promise<unknown>> = [];
			let boundEpoch: number | undefined;
			manager.subscribe(
				(event) => {
					if (event.type !== "plugin_ui_state") return;
					seen.push({
						epoch: event.payload.epoch,
						resident: isResident(sessionId),
					});
					if (boundEpoch !== undefined && event.payload.epoch > boundEpoch) {
						reattached.push(manager.pluginUi.invoke({ ...attach, sessionId }));
					}
					boundEpoch = event.payload.epoch;
				},
				{ sessionId },
			);
			try {
				await startFixtureSession(manager, sessionId, [SLOT]);
				const oldEpoch = service.store.epoch(sessionId) ?? 0;
				await manager.stopSession(sessionId);
				expect(service.chains.has(sessionId)).toBe(false);

				await startFixtureSession(manager, sessionId, [SLOT]);
				const epoch = service.store.epoch(sessionId) ?? 0;
				expect(epoch).toBeGreaterThan(oldEpoch);
				expect(seen).toEqual([
					{ epoch: oldEpoch, resident: true },
					{ epoch, resident: true },
				]);
				await expect(Promise.all(reattached)).resolves.toEqual([
					expect.objectContaining({ outcome: "ok", epoch }),
				]);

				service.record(sessionId, oldEpoch, {
					plugin: FIXTURE,
					slot: SLOT,
					state: { status: "hidden", title: "Old", revision: "old", items: [] },
				});
				await service.closeSession(sessionId, oldEpoch);
				const [current] = await manager.pluginUi.get({ sessionId });
				expect(current).toMatchObject({
					epoch,
					seq: 1,
					state: { revision: "r1" },
				});
				await expect(
					manager.pluginUi.invoke({ ...attach, sessionId }),
				).resolves.toMatchObject({ outcome: "ok", epoch });
			} finally {
				await manager.dispose();
			}
		});

		it.each([
			[
				"prepareLocalRuntimeBootstrap",
				{
					providerSettingsManager: {
						getProviderSettings: () => {
							throw new Error("provider settings unreadable");
						},
					} as never,
				},
				"provider settings unreadable",
			],
			[
				"the runtime build",
				{
					runtimeBuilder: {
						build: vi.fn().mockRejectedValue(new Error("runtime build failed")),
					} as never,
				},
				"runtime build failed",
			],
		])("emits nothing for a start that fails in %s after its epoch began, and ends that epoch", async (_, hostOptions, message) => {
			const sessionId = "sess-composer-suggestions-failed-start";
			const { manager, service } = createSlotHost(hostOptions);
			const begin = vi.spyOn(service, "begin");
			const record = vi.spyOn(service, "record");
			const events: CoreSessionEvent[] = [];
			manager.subscribe((event) => events.push(event));
			try {
				await expect(
					startFixtureSession(manager, sessionId, [SLOT]),
				).rejects.toThrow(message);
				expect(begin).toHaveBeenCalledTimes(1);
				// The fixture's setup state reached the store, yet nothing was emitted.
				expect(record).toHaveBeenCalled();
				expect(uiStates(events)).toEqual([]);
				expect(service.store.epoch(sessionId)).toBeUndefined();
				expect(service.chains.has(sessionId)).toBe(false);
			} finally {
				await manager.dispose();
			}
		});

		it("begins no epoch for a start that fails before it", async () => {
			const sessionId = "sess-composer-suggestions-no-sessions-dir";
			const { manager, service } = createSlotHost({
				sessionService: {
					ensureSessionsDir: vi.fn().mockReturnValue(""),
				} as never,
			});
			const begin = vi.spyOn(service, "begin");
			try {
				await expect(
					startFixtureSession(manager, sessionId, [SLOT]),
				).rejects.toThrow("ensureSessionsDir");
				expect(begin).not.toHaveBeenCalled();
				expect(service.store.epoch(sessionId)).toBeUndefined();
				expect(service.chains.has(sessionId)).toBe(false);
			} finally {
				await manager.dispose();
			}
		});

		it.each([
			["while the bootstrap is still unset", true],
			["after the session started", false],
		])("tombstones a failed plugin's slot %s", async (_, duringBootstrap) => {
			const sessionId = `sess-composer-suggestions-failed-${duringBootstrap}`;
			const { manager } = createSlotHost();
			const registry = getProcessPluginRegistry();
			const loadForSession = registry.loadForSession.bind(registry);
			let reportIssue: ((issue: SessionPluginIssue) => void) | undefined;
			const failed: SessionPluginIssue = {
				name: FIXTURE,
				pluginPath: fixturePath,
				state: "failed",
				reason: "error",
			};
			const spy = vi
				.spyOn(registry, "loadForSession")
				.mockImplementationOnce(async (input) => {
					const loaded = await loadForSession(input);
					reportIssue = input.onIssue;
					if (duringBootstrap) reportIssue?.(failed);
					return loaded;
				});
			const events: CoreSessionEvent[] = [];
			manager.subscribe((event) => events.push(event));
			try {
				await startFixtureSession(manager, sessionId, [SLOT]);
				if (!duringBootstrap) reportIssue?.(failed);

				await expect(manager.pluginUi.get({ sessionId })).resolves.toEqual([
					expect.objectContaining({ plugin: FIXTURE, seq: 2, state: null }),
				]);
				expect(uiStates(events).map((envelope) => envelope.state)).toEqual(
					duringBootstrap
						? [null]
						: [expect.objectContaining({ revision: "r1" }), null],
				);
			} finally {
				spy.mockRestore();
				await manager.dispose();
			}
		});

		it("drops an unserializable state with a drop count and no unhandled rejection", async () => {
			const sessionId = "sess-composer-suggestions-bigint";
			const telemetry = new TelemetryService();
			const capture = vi.spyOn(telemetry, "capture");
			const { manager } = createSlotHost({ telemetry });
			const registry = getProcessPluginRegistry();
			const loadForSession = registry.loadForSession.bind(registry);
			let onUiState: ((push: PluginUiStatePush) => void) | undefined;
			const spy = vi
				.spyOn(registry, "loadForSession")
				.mockImplementationOnce(async (input) => {
					onUiState = input.onUiState;
					return loadForSession(input);
				});
			const unhandled = vi.fn();
			process.on("unhandledRejection", unhandled);
			try {
				await startFixtureSession(manager, sessionId, [SLOT]);
				onUiState?.({ plugin: FIXTURE, slot: SLOT, state: { n: BigInt(1) } });
				await new Promise((resolve) => setTimeout(resolve, 10));

				expect(unhandled).not.toHaveBeenCalled();
				expect(capture).toHaveBeenCalledWith({
					event: CORE_TELEMETRY_EVENTS.PLUGIN_UI.STATE_DROPPED,
					properties: expect.objectContaining({
						plugin_name: FIXTURE,
						slot: SLOT,
						reason: "unserializable",
					}),
				});
				const [current] = await manager.pluginUi.get({ sessionId });
				expect(current).toMatchObject({ seq: 1, state: { revision: "r1" } });
			} finally {
				process.off("unhandledRejection", unhandled);
				spy.mockRestore();
				await manager.dispose();
			}
		});

		it("keeps the caller's catalog on a session restored from a checkpoint", async () => {
			const { manager } = createSlotHost();
			const restoreCheckpoint = vi
				.spyOn(SessionVersioningService.prototype, "restoreCheckpoint")
				.mockImplementation(async (input) => {
					const start = await input.buildStartInput?.(
						{ initialMessages: [] } as never,
						input.start as never,
					);
					const startResult = await input.startSession?.(start as never);
					return {
						sessionId: (startResult as StartSessionResult).sessionId,
						startResult,
						checkpoint: {} as never,
					} as never;
				});
			const restore = (sessionId: string, uiSlots?: string[]) =>
				manager.restoreSession({
					sessionId: "sess-restore-source",
					checkpointRunCount: 1,
					restore: { messages: true, workspace: false },
					start: {
						...normalizeStartInput({
							config: createConfig({
								sessionId,
								cwd: homeDir(),
								enableSpawnAgent: false,
								enableAgentTeams: false,
							}),
							interactive: true,
						}),
						localRuntime: { pluginPaths: [fixturePath] } as never,
						...(uiSlots ? { uiSlots } : {}),
					},
				});
			try {
				const withSlots = await restore("sess-restored-with-slots", [SLOT]);
				const without = await restore("sess-restored-without-slots");

				await expect(
					manager.pluginUi.invoke({
						...attach,
						sessionId: withSlots.sessionId ?? "",
					}),
				).resolves.toMatchObject({ outcome: "ok" });
				await expect(
					manager.pluginUi.invoke({
						...attach,
						sessionId: without.sessionId ?? "",
					}),
				).resolves.toEqual({
					outcome: "unavailable",
					epoch: expect.any(Number),
				});
			} finally {
				restoreCheckpoint.mockRestore();
				await manager.dispose();
			}
		});
	});
});
