import { describe, expect, it, vi } from "vitest";
import { handleCommand } from "./commands";
import { HubStartup } from "./hub-startup";
import type { SidecarContext, SidecarWebSocketClient } from "./types";

function contextWith(hubStartup: HubStartup): SidecarContext {
	return {
		localWorkspaceRoot: "/workspace",
		wsClients: new Set(),
		runtimeBindings: new Map(),
		hubBuildMismatch: null,
		hubStartup,
		logger: { debug: vi.fn(), log: vi.fn(), error: vi.fn() },
	} as unknown as SidecarContext;
}

describe("commands during Hub startup", () => {
	it("answers retry without waiting for the Hub", async () => {
		const startup = new HubStartup(
			() => new Promise(() => {}),
			vi.fn(),
			vi.fn(),
		);
		startup.start();
		const ctx = contextWith(startup);
		await expect(handleCommand(ctx, "retry_hub")).resolves.toEqual({
			state: "starting",
		});
	});

	it("holds Hub-backed commands until startup settles", async () => {
		let finishSetup!: () => void;
		const startup = new HubStartup(
			() =>
				new Promise<void>((resolve) => {
					finishSetup = resolve;
				}),
			vi.fn(),
			vi.fn(),
		);
		startup.start();
		let settled = false;
		const pending = handleCommand(
			contextWith(startup),
			"no_such_command",
		).finally(() => {
			settled = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(settled).toBe(false);
		finishSetup();
		await expect(pending).rejects.toThrow();
		expect(settled).toBe(true);
	});

	it("drops a waiting command whose connection closed during startup", async () => {
		let finishSetup!: () => void;
		const startup = new HubStartup(
			() =>
				new Promise<void>((resolve) => {
					finishSetup = resolve;
				}),
			vi.fn(),
			vi.fn(),
		);
		startup.start();
		const ctx = contextWith(startup);
		const connection = {} as SidecarWebSocketClient;
		ctx.wsClients.add(connection);
		const pending = handleCommand(
			ctx,
			"run_provider_oauth_login",
			{ providerId: "cline" },
			{ connection },
		);
		ctx.wsClients.delete(connection);
		finishSetup();
		await expect(pending).rejects.toThrow(
			"The connection closed while Cline Hub was starting.",
		);
	});
});
