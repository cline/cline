import type { PluginUiInvokeInput } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { handleCommand } from "./commands";
import { createSidecarContext } from "./context";
import {
	desktopUiSlots,
	invokePluginUi,
	releasePluginUiViewer,
} from "./plugin-ui";
import type { SidecarContext, SidecarWebSocketClient } from "./types";

const SESSION_ID = "session-tray";

function trustedSocket(): SidecarWebSocketClient {
	return { data: { canApproveTools: true }, send: vi.fn() };
}

function createContext() {
	let epoch = 100;
	const invoke = vi.fn(async (input: PluginUiInvokeInput) => ({
		outcome: "ok" as const,
		epoch: input.action.verb === "attach" ? epoch++ : epoch,
	}));
	const get = vi.fn(async () => [
		{
			sessionId: SESSION_ID,
			slot: "composer.suggestions" as const,
			plugin: "demo",
			epoch: 1,
			seq: 1,
			state: null,
		},
	]);
	const sshInvoke = vi.fn(async (_input: PluginUiInvokeInput) => ({
		outcome: "ok" as const,
	}));
	const ctx = createSidecarContext("/workspace/project");
	ctx.runtimeBindings.set("local", {
		environmentId: "local",
		kind: "local",
		workspaceRoot: "/workspace/project",
		sessionManager: { pluginUi: { get, invoke } },
		hubClient: { updateCapabilities: vi.fn(async () => undefined) },
		unsubscribeSessionEvents: () => {},
	} as never);
	ctx.runtimeBindings.set("ssh-devbox", {
		environmentId: "ssh-devbox",
		kind: "ssh",
		workspaceRoot: "/home/me",
		sessionManager: { pluginUi: { get: vi.fn(), invoke: sshInvoke } },
		hubClient: { updateCapabilities: vi.fn(async () => undefined) },
		unsubscribeSessionEvents: () => {},
	} as never);
	return { ctx, get, invoke, sshInvoke };
}

function presence(verb: "attach" | "detach") {
	return {
		environmentId: "local",
		sessionId: SESSION_ID,
		slot: "composer.suggestions",
		action: verb === "attach" ? { verb, surface: "desktop" } : { verb },
	};
}

function forwardedVerbs(invoke: ReturnType<typeof vi.fn>): unknown[] {
	return invoke.mock.calls.map(
		([input]) => (input as PluginUiInvokeInput).action.verb,
	);
}

describe("desktopUiSlots", () => {
	it("declares the suggestion tray for local sessions only", () => {
		expect(desktopUiSlots({ kind: "local" })).toEqual(["composer.suggestions"]);
		expect(desktopUiSlots({ kind: "ssh" })).toBeUndefined();
	});
});

describe("plugin UI sidecar commands", () => {
	it("routes get and invoke through the session's local ClineCore", async () => {
		const { ctx, get, invoke } = createContext();
		const socket = trustedSocket();

		await expect(
			handleCommand(
				ctx,
				"plugin_ui_get",
				{ environmentId: "local", sessionId: SESSION_ID },
				{ connection: socket },
			),
		).resolves.toEqual([expect.objectContaining({ sessionId: SESSION_ID })]);
		await handleCommand(
			ctx,
			"plugin_ui_invoke",
			{
				environmentId: "local",
				sessionId: SESSION_ID,
				slot: "composer.suggestions",
				action: { verb: "skip", revision: "r1", itemId: "a", input: "key" },
			},
			{ connection: socket },
		);

		expect(get).toHaveBeenCalledWith({ sessionId: SESSION_ID });
		expect(invoke).toHaveBeenCalledWith({
			sessionId: SESSION_ID,
			slot: "composer.suggestions",
			action: { verb: "skip", revision: "r1", itemId: "a", input: "key" },
		});
	});

	it("refuses actions from a socket that cannot approve tools", async () => {
		const { ctx, invoke } = createContext();

		await expect(
			handleCommand(ctx, "plugin_ui_invoke", presence("attach"), {
				connection: { send: vi.fn() },
			}),
		).rejects.toThrow("trusted desktop connection");
		expect(invoke).not.toHaveBeenCalled();
		expect(ctx.pluginUiViews?.size).toBe(0);
	});

	it("forwards every attach and returns each reply, epoch included, to its socket", async () => {
		const { ctx, invoke } = createContext();
		const first = trustedSocket();
		const second = trustedSocket();

		const replies = [
			await invokePluginUi(ctx, presence("attach"), first),
			await invokePluginUi(ctx, presence("attach"), first),
			await invokePluginUi(ctx, presence("attach"), second),
		];

		expect(forwardedVerbs(invoke)).toEqual(["attach", "attach", "attach"]);
		expect(replies).toEqual([
			{ outcome: "ok", epoch: 100 },
			{ outcome: "ok", epoch: 101 },
			{ outcome: "ok", epoch: 102 },
		]);
		expect(ctx.pluginUiViews?.get(SESSION_ID)).toEqual({
			environmentId: "local",
			sockets: new Set([first, second]),
		});
	});

	it("detaches from the hub only when the last socket leaves", async () => {
		const { ctx, invoke } = createContext();
		const first = trustedSocket();
		const second = trustedSocket();
		await invokePluginUi(ctx, presence("attach"), first);
		await invokePluginUi(ctx, presence("attach"), second);
		invoke.mockClear();

		await expect(
			invokePluginUi(ctx, presence("detach"), first),
		).resolves.toEqual({ outcome: "ok" });
		expect(invoke).not.toHaveBeenCalled();

		await invokePluginUi(ctx, presence("detach"), second);
		expect(forwardedVerbs(invoke)).toEqual(["detach"]);
		expect(ctx.pluginUiViews?.has(SESSION_ID)).toBe(false);
	});

	it("answers a detach from a socket that never attached without reaching the hub", async () => {
		const { ctx, invoke } = createContext();

		await expect(
			invokePluginUi(ctx, presence("detach"), trustedSocket()),
		).resolves.toEqual({ outcome: "ok" });
		expect(invoke).not.toHaveBeenCalled();
	});

	it("detaches from the hub when the last viewing socket closes", async () => {
		const { ctx, invoke } = createContext();
		const first = trustedSocket();
		const second = trustedSocket();
		await invokePluginUi(ctx, presence("attach"), first);
		await invokePluginUi(ctx, presence("attach"), second);
		invoke.mockClear();

		releasePluginUiViewer(ctx, first);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(invoke).not.toHaveBeenCalled();

		releasePluginUiViewer(ctx, second);
		await vi.waitFor(() => expect(forwardedVerbs(invoke)).toEqual(["detach"]));
		expect(invoke).toHaveBeenCalledWith({
			sessionId: SESSION_ID,
			slot: "composer.suggestions",
			action: { verb: "detach" },
		});
	});

	it("ends a closed socket's lease on the environment it attached through, whatever environment is active", async () => {
		const { ctx, invoke, sshInvoke } = createContext();
		const socket = trustedSocket();
		await invokePluginUi(ctx, presence("attach"), socket);
		invoke.mockClear();
		ctx.activeEnvironmentId = "ssh-devbox";

		releasePluginUiViewer(ctx, socket);

		await vi.waitFor(() => expect(forwardedVerbs(invoke)).toEqual(["detach"]));
		expect(sshInvoke).not.toHaveBeenCalled();
	});

	it("tolerates a hand-built context without the viewer map", async () => {
		const { ctx, invoke } = createContext();
		const bare = { ...ctx, pluginUiViews: undefined } as SidecarContext;
		const socket = trustedSocket();

		await invokePluginUi(bare, presence("attach"), socket);
		await expect(
			invokePluginUi(bare, presence("detach"), socket),
		).resolves.toEqual({ outcome: "ok" });
		releasePluginUiViewer(bare, socket);

		expect(forwardedVerbs(invoke)).toEqual(["attach"]);
	});
});
