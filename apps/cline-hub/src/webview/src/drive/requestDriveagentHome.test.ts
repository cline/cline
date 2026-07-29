import { afterEach, describe, expect, it, vi } from "vitest";
import { requestDriveagentHome } from "./requestDriveagentHome";

function stubWindowMessageBus() {
	const listeners = new Set<(event: MessageEvent) => void>();
	vi.stubGlobal("window", {
		addEventListener: (
			_type: string,
			listener: EventListenerOrEventListenerObject,
		) => {
			if (typeof listener === "function") {
				listeners.add(listener as (event: MessageEvent) => void);
			}
		},
		removeEventListener: (
			_type: string,
			listener: EventListenerOrEventListenerObject,
		) => {
			listeners.delete(listener as (event: MessageEvent) => void);
		},
	});
	return {
		dispatch(data: unknown) {
			const event = { data } as MessageEvent;
			for (const listener of [...listeners]) {
				listener(event);
			}
		},
	};
}

describe("requestDriveagentHome", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("rejects when workspaceRoot or slug is empty", async () => {
		await expect(requestDriveagentHome("", "pair-partner")).rejects.toThrow(
			/workspaceRoot/,
		);
		await expect(requestDriveagentHome("/tmp/ws", "  ")).rejects.toThrow(
			/slug/,
		);
	});

	it("resolves with home projection when drive_agent_home arrives", async () => {
		const bus = stubWindowMessageBus();
		const postSpy = vi
			.spyOn(await import("../vscode"), "postToHost")
			.mockImplementation((message) => {
				const requestId =
					typeof message === "object" &&
					message &&
					"requestId" in message &&
					typeof message.requestId === "string"
						? message.requestId
						: undefined;
				queueMicrotask(() => {
					bus.dispatch({
						type: "drive_agent_home",
						requestId,
						home: {
							slug: "pair-partner",
							agent: {
								name: "pair-partner",
								description: "Pair partner",
								tools: ["read_file"],
							},
							permissions: {
								presetIntent: "standard",
								approvalHooks: [],
							},
						},
						compiled: {
							name: "pair-partner",
							slug: "pair-partner",
							description: "Pair partner",
							tools: ["read_file"],
							skills: ["drive-persona"],
						},
					});
				});
			});

		const home = await requestDriveagentHome("/tmp/ws", "pair-partner");
		expect(home.compiled.skills).toEqual(["drive-persona"]);
		expect(home.permissions.presetIntent).toBe("standard");
		expect(postSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "drive_agent_home_get",
				workspaceRoot: "/tmp/ws",
				slug: "pair-partner",
			}),
		);
	});

	it("rejects on drive_agent_home_error", async () => {
		const bus = stubWindowMessageBus();
		vi.spyOn(await import("../vscode"), "postToHost").mockImplementation(
			(message) => {
				const requestId =
					typeof message === "object" &&
					message &&
					"requestId" in message &&
					typeof message.requestId === "string"
						? message.requestId
						: undefined;
				queueMicrotask(() => {
					bus.dispatch({
						type: "drive_agent_home_error",
						requestId,
						text: "unknown_agent",
					});
				});
			},
		);

		await expect(
			requestDriveagentHome("/tmp/ws", "pair-partner"),
		).rejects.toThrow(/unknown_agent/);
	});
});
