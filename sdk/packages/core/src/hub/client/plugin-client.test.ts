import { afterEach, expect, it, vi } from "vitest";
import type { NodeHubClient } from "./index";
import { HubPluginClient } from "./plugin-client";

// Model the transport deadline, so a client using the default 30s loses a
// valid 45s reply. Plugin runtime timeouts remain responsible for the handler.
function transport() {
	const command = vi.fn<NodeHubClient["command"]>(
		(name, _payload, _sessionId, options) =>
			new Promise((resolve, reject) => {
				const timer =
					options?.timeoutMs === null
						? undefined
						: setTimeout(
								() => reject(new Error("transport timed out")),
								options?.timeoutMs ?? 30_000,
							);
				setTimeout(() => {
					clearTimeout(timer);
					resolve({
						version: "v1",
						ok: true,
						payload:
							name === "plugins.commands.list"
								? { commands: [{ name: "slow" }] }
								: {
										handled: true,
										result: { reply: "finished", submitPrompt: "continue" },
									},
					});
				}, 45_000);
			}),
	);
	return new HubPluginClient({ command });
}

afterEach(() => vi.useRealTimers());
it("keeps a valid 45-second command reply and prompt", async () => {
	vi.useFakeTimers();
	const running = transport().runCommand("/workspace", "slow", "input");
	await vi.advanceTimersByTimeAsync(45_000);
	await expect(running).resolves.toEqual({
		reply: "finished",
		submitPrompt: "continue",
	});
});
it("allows cold command discovery to exceed the transport default", async () => {
	vi.useFakeTimers();
	const loading = transport().listCommands("/workspace");
	await vi.advanceTimersByTimeAsync(45_000);
	await expect(loading).resolves.toEqual([{ name: "slow" }]);
});
