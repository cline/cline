import type { HubUINotifyPayload } from "@cline/shared";
import { afterEach, describe, expect, it } from "vitest";
import { SessionSource } from "../../types/common";
import { HubUIClient } from "../client/ui-client";
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers";
import { startHubServer } from "../daemon/start-shared-server";

function waitForEvent<T>(
	subscribe: (resolve: (payload: T) => void) => () => void,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timeout = setTimeout(() => {
			unsubscribe();
			reject(new Error("Timed out waiting for hub UI event"));
		}, 1_000);
		const unsubscribe = subscribe((payload) => {
			clearTimeout(timeout);
			unsubscribe();
			resolve(payload);
		});
	});
}

describe("hub UI events", () => {
	const servers: Array<{ close(): Promise<void> }> = [];

	afterEach(async () => {
		for (const server of servers.splice(0)) {
			await server.close().catch(() => {});
		}
	});

	it("broadcasts ui.notify event to subscribed clients", async () => {
		// Start a real hub server
		const server = await startHubServer({
			port: 0,
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		});
		servers.push(server);

		// Connect two UI clients - one will send, one will receive
		const sender = new HubUIClient({
			address: server.url,
			authToken: server.authToken,
			clientType: "test-sender",
			displayName: "Test Sender",
		});
		const receiver = new HubUIClient({
			address: server.url,
			authToken: server.authToken,
			clientType: "test-receiver",
			displayName: "Test Receiver",
		});

		await sender.connect();
		await receiver.connect();

		const received = waitForEvent<HubUINotifyPayload>((resolve) =>
			receiver.subscribeUI({ onNotify: resolve }),
		);

		// Send a notification via the sender
		await sender.sendNotify({
			title: "Test Notification",
			body: "Hello from hub UI events test",
			severity: "info",
		});

		const payload = await received;
		sender.close();
		receiver.close();

		expect(payload.title).toBe("Test Notification");
		expect(payload.body).toBe("Hello from hub UI events test");
		expect(payload.severity).toBe("info");
	}, 10_000);

	it("broadcasts ui.show_window event to subscribed clients", async () => {
		const server = await startHubServer({
			port: 0,
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		});
		servers.push(server);

		const sender = new HubUIClient({
			address: server.url,
			authToken: server.authToken,
			clientType: "test-sender",
		});
		const receiver = new HubUIClient({
			address: server.url,
			authToken: server.authToken,
			clientType: "test-receiver",
		});

		await sender.connect();
		await receiver.connect();

		const received = waitForEvent<unknown>((resolve) =>
			receiver.subscribeUI({ onShowWindow: resolve }),
		);

		await sender.sendShowWindow({ focus: true });

		await expect(received).resolves.toEqual({ focus: true });
		sender.close();
		receiver.close();
	}, 10_000);

	it("receives hub.client.registered events when clients connect", async () => {
		const server = await startHubServer({
			port: 0,
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		});
		servers.push(server);

		// First client connects and subscribes to registration events
		const monitor = new HubUIClient({
			address: server.url,
			authToken: server.authToken,
			clientType: "test-monitor",
			displayName: "Test Monitor",
		});
		await monitor.connect();

		const registered = waitForEvent<Record<string, unknown>>((resolve) =>
			monitor.subscribeUI({ onClientRegistered: resolve }),
		);

		// Second client connects — should trigger registration event
		const newClient = new HubUIClient({
			address: server.url,
			authToken: server.authToken,
			clientType: "test-newcomer",
			displayName: "New Client",
		});
		await newClient.connect();

		const payload = await registered;
		monitor.close();
		newClient.close();

		expect(typeof payload.clientId).toBe("string");
	}, 10_000);

	it("lists connected clients and sessions for initial UI hydration", async () => {
		const sessionRecord = {
			sessionId: "session-ui-hydration",
			source: SessionSource.CORE,
			startedAt: new Date(0).toISOString(),
			updatedAt: new Date(0).toISOString(),
			status: "running" as const,
			interactive: true,
			provider: "cline",
			model: "test-model",
			cwd: "/tmp/project",
			workspaceRoot: "/tmp/project",
			enableTools: true,
			enableSpawn: false,
			enableTeams: false,
			isSubagent: false,
		};
		const server = await startHubServer({
			port: 0,
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			sessionHost: {
				subscribe: () => () => {},
				startSession: async () => {
					throw new Error("not used in this test");
				},
				runTurn: async () => undefined,
				restoreSession: async () => {
					throw new Error("not used in this test");
				},
				pendingPrompts: {
					list: async () => [],
					update: async () => ({
						sessionId: sessionRecord.sessionId,
						prompts: [],
						updated: false,
					}),
					delete: async () => ({
						sessionId: sessionRecord.sessionId,
						prompts: [],
						removed: false,
					}),
				},
				getAccumulatedUsage: async () => undefined,
				abort: async () => {},
				stopSession: async () => {},
				dispose: async () => {},
				getSession: async (sessionId: string) =>
					sessionId === sessionRecord.sessionId ? sessionRecord : undefined,
				listSessions: async () => [sessionRecord],
				deleteSession: async () => false,
				updateSession: async () => ({ updated: false }),
				readSessionMessages: async () => [],
				dispatchHookEvent: async () => {},
			} as never,
		});
		servers.push(server);

		const ui = new HubUIClient({
			address: server.url,
			authToken: server.authToken,
			clientType: "test-ui",
			displayName: "Test UI",
		});
		const worker = new HubUIClient({
			address: server.url,
			authToken: server.authToken,
			clientType: "test-worker",
			displayName: "Worker",
		});

		await ui.connect();
		await worker.connect();

		const clients = await ui.listClients();
		const sessions = await ui.listSessions();

		worker.close();
		ui.close();

		expect(clients.some((client) => client.clientType === "test-worker")).toBe(
			true,
		);
		expect(
			sessions.some((session) => session.workspaceRoot === "/tmp/project"),
		).toBe(true);
	}, 10_000);
});
