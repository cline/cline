import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HubCommandEnvelope } from "@cline/shared";
import {
	type ConnectorConfigRecord,
	withConnectorStore,
} from "@cline/shared/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __test__, handleConnectorCommand } from "./connector-handlers";
import type { HubTransportContext } from "./context";

describe("connector hub handlers", () => {
	const previousDataDir = process.env.CLINE_DATA_DIR;
	const tempRoots: string[] = [];

	afterEach(() => {
		process.env.CLINE_DATA_DIR = previousDataDir;
		for (const root of tempRoots.splice(0)) {
			rmSync(root, { recursive: true, force: true });
		}
	});

	function useTempDataDir(): string {
		const root = mkdtempSync(join(tmpdir(), "hub-connectors-"));
		tempRoots.push(root);
		process.env.CLINE_DATA_DIR = root;
		return root;
	}

	function createHubContext(
		telemetry = { capture: vi.fn() },
	): HubTransportContext {
		return {
			clients: new Map(),
			sessionState: new Map(),
			pendingApprovals: new Map(),
			pendingCapabilityRequests: new Map(),
			suppressNextTerminalEventBySession: new Map(),
			telemetry: telemetry as never,
			sessionHost: {} as never,
			publish: vi.fn(),
			buildEvent: vi.fn() as never,
			requestCapability: vi.fn() as never,
		};
	}

	function connectorCommand(
		command: HubCommandEnvelope["command"],
		payload?: Record<string, unknown>,
	): HubCommandEnvelope {
		return {
			version: "v1",
			requestId: `req-${command}`,
			command,
			payload,
		};
	}

	function readPersistedConnector(
		channel: string,
	): ConnectorConfigRecord | undefined {
		return withConnectorStore((store) => store.get(channel));
	}

	function readPersistedConnectorValues(
		channel: string,
	): Record<string, string> {
		return readPersistedConnector(channel)?.values ?? {};
	}

	it("configures a connector through hub settings without starting it", () => {
		useTempDataDir();

		const response = __test__.configureConnector({
			channel: "telegram",
			values: { "-k": "123456:fake-token" },
			security: { enabled: true, values: { userId: "123456789" } },
		});

		expect(response.active).toEqual([]);
		expect(response.configured).toEqual([
			expect.objectContaining({ id: "telegram", type: "telegram" }),
		]);

		const persisted = readPersistedConnector("telegram");
		expect(persisted?.values["-k"]).toBe("123456:fake-token");
		expect(persisted?.security).toEqual({
			enabled: true,
			values: { userId: "123456789" },
		});
	});

	it("validates security fields before persisting connector settings", () => {
		useTempDataDir();

		expect(() =>
			__test__.configureConnector({
				channel: "telegram",
				values: { "-k": "123456:fake-token" },
				security: { enabled: true, values: { userId: "not-a-number" } },
			}),
		).toThrow("Telegram user ID must contain digits only");
		expect(__test__.connectorChannelsPayload().configured).toEqual([]);
	});

	it("deletes a connector config from the store", () => {
		useTempDataDir();

		__test__.configureConnector({
			channel: "telegram",
			values: { "-k": "123456:fake-token" },
		});
		__test__.configureConnector({
			channel: "slack",
			values: {
				"--bot-token": "xoxb-token",
				"--base-url": "",
				"--app-token": "xapp-token",
			},
		});

		const deleteTelegram = __test__.deleteConnectorConfig({
			channel: "telegram",
		});
		expect(deleteTelegram.configured).toEqual([
			expect.objectContaining({ id: "slack", type: "slack" }),
		]);

		expect(readPersistedConnector("telegram")).toBeUndefined();
		expect(readPersistedConnector("slack")).toBeDefined();

		const deleteSlack = __test__.deleteConnectorConfig({ channel: "slack" });
		expect(deleteSlack.configured).toEqual([]);
		expect(readPersistedConnector("slack")).toBeUndefined();
	});

	it("validates only included conditional connector fields", () => {
		useTempDataDir();

		expect(() =>
			__test__.configureConnector({
				channel: "slack",
				values: {
					"--bot-token": "xoxb-token",
					"--base-url": "",
					"--app-token": "xapp-token",
				},
			}),
		).not.toThrow();

		expect(() =>
			__test__.configureConnector({
				channel: "slack",
				values: {
					"--bot-token": "xoxb-token",
					"--base-url": "https://example.com",
				},
			}),
		).toThrow("Signing secret is required");
	});

	it("persists only active Slack fields for the selected mode", () => {
		useTempDataDir();

		__test__.configureConnector({
			channel: "slack",
			values: {
				"--bot-token": "xoxb-token",
				"--base-url": "",
				"--app-token": "xapp-token",
				"--signing-secret": "stale-signing-secret",
			},
		});
		expect(readPersistedConnectorValues("slack")).toEqual({
			"--bot-token": "xoxb-token",
			"--base-url": "",
			"--app-token": "xapp-token",
		});

		__test__.configureConnector({
			channel: "slack",
			values: {
				"--bot-token": "xoxb-token",
				"--base-url": "https://hooks.example.com",
				"--signing-secret": "signing-secret",
				"--app-token": "stale-app-token",
			},
		});
		expect(readPersistedConnectorValues("slack")).toEqual({
			"--bot-token": "xoxb-token",
			"--base-url": "https://hooks.example.com",
			"--signing-secret": "signing-secret",
		});
	});

	it("emits telemetry for state-mutating connector command outcomes", async () => {
		useTempDataDir();
		const telemetry = { capture: vi.fn() };
		const ctx = createHubContext(telemetry);

		await handleConnectorCommand(
			ctx,
			connectorCommand("connector.configure", {
				channel: "telegram",
				values: { "-k": "123456:fake-token" },
			}),
		);
		await handleConnectorCommand(
			ctx,
			connectorCommand("connector.delete_config", { channel: "telegram" }),
		);
		await handleConnectorCommand(
			ctx,
			connectorCommand("connector.configure", {
				channel: "telegram",
				values: {},
			}),
		);
		await handleConnectorCommand(ctx, connectorCommand("connector.channels"));

		expect(telemetry.capture).toHaveBeenCalledTimes(3);
		expect(telemetry.capture).toHaveBeenNthCalledWith(1, {
			event: "task.tool_used",
			properties: {
				ulid: "req-connector.configure",
				tool: "connector.configure",
				success: true,
			},
		});
		expect(telemetry.capture).toHaveBeenNthCalledWith(2, {
			event: "task.tool_used",
			properties: {
				ulid: "req-connector.delete_config",
				tool: "connector.delete_config",
				success: true,
			},
		});
		expect(telemetry.capture).toHaveBeenNthCalledWith(3, {
			event: "task.tool_used",
			properties: {
				ulid: "req-connector.configure",
				tool: "connector.configure",
				success: false,
			},
		});
	});
});
