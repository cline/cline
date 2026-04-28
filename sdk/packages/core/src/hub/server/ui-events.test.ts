import type { HubUINotifyPayload } from "@clinebot/shared";
import { afterEach, describe, expect, it } from "vitest";
import { HubUIClient } from "../client/ui-client";
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers";
import { startHubServer } from "../daemon/start-shared-server";

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
			clientType: "test-sender",
			displayName: "Test Sender",
		});
		const receiver = new HubUIClient({
			address: server.url,
			clientType: "test-receiver",
			displayName: "Test Receiver",
		});

		await sender.connect();
		await receiver.connect();

		// Subscribe the receiver to UI events
		const received: HubUINotifyPayload[] = [];
		const unsubscribe = receiver.subscribeUI({
			onNotify(payload) {
				received.push(payload);
			},
		});

		// Give subscription time to be established
		await new Promise((resolve) => setTimeout(resolve, 100));

		// Send a notification via the sender
		await sender.sendNotify({
			title: "Test Notification",
			body: "Hello from hub UI events test",
			severity: "info",
		});

		// Wait for the event to be delivered
		await new Promise((resolve) => setTimeout(resolve, 200));

		unsubscribe();
		sender.close();
		receiver.close();

		expect(received.length).toBeGreaterThan(0);
		expect(received[0].title).toBe("Test Notification");
		expect(received[0].body).toBe("Hello from hub UI events test");
		expect(received[0].severity).toBe("info");
	}, 10_000);

	it("broadcasts ui.show_window event to subscribed clients", async () => {
		const server = await startHubServer({
			port: 0,
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		});
		servers.push(server);

		const sender = new HubUIClient({
			address: server.url,
			clientType: "test-sender",
		});
		const receiver = new HubUIClient({
			address: server.url,
			clientType: "test-receiver",
		});

		await sender.connect();
		await receiver.connect();

		let showWindowReceived = false;
		const unsubscribe = receiver.subscribeUI({
			onShowWindow() {
				showWindowReceived = true;
			},
		});

		await new Promise((resolve) => setTimeout(resolve, 100));

		await sender.sendShowWindow({ focus: true });

		await new Promise((resolve) => setTimeout(resolve, 200));

		unsubscribe();
		sender.close();
		receiver.close();

		expect(showWindowReceived).toBe(true);
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
			clientType: "test-monitor",
			displayName: "Test Monitor",
		});
		await monitor.connect();

		const registeredClientIds: string[] = [];
		const unsubscribe = monitor.subscribeUI({
			onClientRegistered(payload) {
				if (typeof payload.clientId === "string") {
					registeredClientIds.push(payload.clientId);
				}
			},
		});

		await new Promise((resolve) => setTimeout(resolve, 100));

		// Second client connects — should trigger registration event
		const newClient = new HubUIClient({
			address: server.url,
			clientType: "test-newcomer",
			displayName: "New Client",
		});
		await newClient.connect();

		await new Promise((resolve) => setTimeout(resolve, 200));

		unsubscribe();
		monitor.close();
		newClient.close();

		expect(registeredClientIds.length).toBeGreaterThan(0);
	}, 10_000);

	it("lists connected clients and sessions for initial UI hydration", async () => {
		const server = await startHubServer({
			port: 0,
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		});
		servers.push(server);

		const ui = new HubUIClient({
			address: server.url,
			clientType: "test-ui",
			displayName: "Test UI",
		});
		const worker = new HubUIClient({
			address: server.url,
			clientType: "test-worker",
			displayName: "Worker",
		});

		await ui.connect();
		await worker.connect();

		await (
			worker as unknown as {
				client: {
					command: (
						command: string,
						payload?: Record<string, unknown>,
					) => Promise<{ payload?: Record<string, unknown> }>;
				};
			}
		).client.command("session.create", {
			workspaceRoot: "/tmp/project",
			cwd: "/tmp/project",
			sessionConfig: {
				providerId: "cline",
				modelId: "test-model",
				cwd: "/tmp/project",
				workspaceRoot: "/tmp/project",
				systemPrompt: "",
				mode: "act",
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
		});

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
