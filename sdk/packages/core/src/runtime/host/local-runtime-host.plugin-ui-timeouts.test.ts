import { type AgentResult, PLUGIN_UI_LIMITS } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { getProcessPluginRegistry } from "../../extensions/plugin/plugin-registry";
import {
	createResult,
	pluginUiSlotHelpers,
	useIsolatedHome,
} from "./local-runtime-host.plugin-ui.fixtures";

describe("LocalRuntimeHost", () => {
	const homeDir = useIsolatedHome();

	describe("plugin UI slots", () => {
		const {
			SLOT,
			attach,
			use,
			createSlotHost,
			startFixtureSession,
			writeHangingSlotPlugin,
		} = pluginUiSlotHelpers(homeDir);

		it("serves a UI invoke while a plugin command and the agent run hang", async () => {
			const sessionId = "sess-plugin-ui-beside-slow-work";
			const pluginPath = writeHangingSlotPlugin();
			const { manager, agents } = createSlotHost();
			let finishRun!: (result: AgentResult) => void;
			const pendingRun = new Promise<AgentResult>((resolve) => {
				finishRun = resolve;
			});
			try {
				await startFixtureSession(manager, sessionId, [SLOT], pluginPath);
				const agent = agents[0];
				if (!agent) throw new Error("no session agent");
				agent.run.mockReturnValue(pendingRun);
				agent.continue.mockReturnValue(pendingRun);
				const turn = manager.runTurn({ sessionId, prompt: "hang" });
				await vi.waitFor(() =>
					expect(
						agent.run.mock.calls.length + agent.continue.mock.calls.length,
					).toBe(1),
				);
				await agent.initializeExtensions();
				const slowCommand = agent
					.getExtensionRegistry()
					.commands.find((command) => command.name === "slow");
				expect(slowCommand).toBeDefined();
				const commandCall = Promise.resolve().then(() =>
					slowCommand?.handler?.(""),
				);
				commandCall.catch(() => {});

				await expect(
					manager.pluginUi.invoke({ ...attach, sessionId }),
				).resolves.toEqual({ outcome: "ok", epoch: expect.any(Number) });

				finishRun(createResult());
				await turn;
			} finally {
				await manager.dispose();
			}
		});

		it("does not count an invoke that timed out in the queue as a plugin failure", async () => {
			const sessionId = "sess-plugin-ui-queued-timeout";
			const pluginPath = writeHangingSlotPlugin();
			const { manager } = createSlotHost();
			const registry = getProcessPluginRegistry();
			const failures = () => {
				const [status] = registry.get(pluginPath);
				return {
					errors: status?.errorCount ?? 0,
					timeouts: status?.timeoutCount ?? 0,
				};
			};
			try {
				await startFixtureSession(manager, sessionId, [SLOT], pluginPath);
				const attached = await manager.pluginUi.invoke({
					...attach,
					sessionId,
				});
				expect(attached).toMatchObject({ outcome: "ok" });
				const before = failures();
				vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

				const hanging = manager.pluginUi.invoke({
					sessionId,
					slot: SLOT,
					action: use,
				});
				const queued = manager.pluginUi.invoke({
					sessionId,
					slot: SLOT,
					action: use,
				});
				await vi.advanceTimersByTimeAsync(PLUGIN_UI_LIMITS.invokeTimeoutMs);
				await expect(queued).resolves.toEqual({
					outcome: "timeout",
					epoch: attached.epoch,
				});
				await expect(hanging).resolves.toEqual({
					outcome: "timeout",
					epoch: attached.epoch,
				});
				await vi.advanceTimersByTimeAsync(3 * PLUGIN_UI_LIMITS.invokeTimeoutMs);

				// Only the call that reached onAction counts; the queued one never ran.
				expect(failures()).toEqual({
					errors: before.errors + 1,
					timeouts: before.timeouts + 1,
				});
			} finally {
				vi.useRealTimers();
				await manager.dispose();
			}
		});

		it("lets stopSession wait at most closeWaitMs for a hanging slot handler", async () => {
			const sessionId = "sess-plugin-ui-stop-wait";
			const pluginPath = writeHangingSlotPlugin();
			const { manager, service, isResident } = createSlotHost();
			try {
				await startFixtureSession(manager, sessionId, [SLOT], pluginPath);
				await manager.pluginUi.invoke({ ...attach, sessionId });
				const hanging = manager.pluginUi.invoke({
					sessionId,
					slot: SLOT,
					action: use,
				});
				// Let `use` reach onAction; a close before that cancels it instead.
				await new Promise((resolve) => setImmediate(resolve));

				const stoppingAt = Date.now();
				await manager.stopSession(sessionId);
				const elapsed = Date.now() - stoppingAt;

				expect(elapsed).toBeGreaterThanOrEqual(
					PLUGIN_UI_LIMITS.closeWaitMs - 50,
				);
				expect(elapsed).toBeLessThan(PLUGIN_UI_LIMITS.invokeTimeoutMs);
				expect(isResident(sessionId)).toBe(false);
				expect(service.chains.has(sessionId)).toBe(false);
				await expect(hanging).resolves.toEqual({ outcome: "unavailable" });
			} finally {
				await manager.dispose();
			}
		}, 15_000);

		it("bounds a hanging onAction at 10 s in CLINE_PLUGIN_MODE=sandbox", async () => {
			const previousMode = process.env.CLINE_PLUGIN_MODE;
			process.env.CLINE_PLUGIN_MODE = "sandbox";
			const sessionId = "sess-plugin-ui-sandbox-timeout";
			const pluginPath = writeHangingSlotPlugin();
			const { manager } = createSlotHost();
			try {
				await startFixtureSession(manager, sessionId, [SLOT], pluginPath);
				const attached = await manager.pluginUi.invoke({
					...attach,
					sessionId,
				});
				expect(attached).toMatchObject({ outcome: "ok" });
				vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

				let settled: unknown;
				void manager.pluginUi
					.invoke({ sessionId, slot: SLOT, action: use })
					.then((result) => {
						settled = result;
					});
				await vi.advanceTimersByTimeAsync(PLUGIN_UI_LIMITS.invokeTimeoutMs - 1);
				expect(settled).toBeUndefined();
				await vi.advanceTimersByTimeAsync(1);
				expect(settled).toEqual({ outcome: "timeout", epoch: attached.epoch });
			} finally {
				vi.useRealTimers();
				if (previousMode === undefined) delete process.env.CLINE_PLUGIN_MODE;
				else process.env.CLINE_PLUGIN_MODE = previousMode;
				await manager.dispose();
			}
		}, 30_000);
	});
});
