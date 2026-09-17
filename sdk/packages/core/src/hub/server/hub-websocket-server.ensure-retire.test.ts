/**
 * ensureHubWebSocketServer replacement rules for a live-but-unusable
 * discovered hub. They must agree with the detached-daemon ensure path:
 * a hub serving sessions is attached to (never ambushed), and retirement
 * goes through the shared retireDiscoveredHub (drain first, discovery
 * cleared only when the hub actually went away).
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-sdk/provider-utils", () => ({
	createProviderDefinedToolFactory: vi.fn(() => vi.fn()),
}));

const {
	hubHasLiveSessions,
	retireDiscoveredHub,
	verifyHubConnection,
	probeHubServer,
	readHubDiscovery,
	clearHubDiscovery,
	isManagedHubReusable,
} = vi.hoisted(() => ({
	hubHasLiveSessions: vi.fn(),
	retireDiscoveredHub: vi.fn(),
	verifyHubConnection: vi.fn(),
	probeHubServer: vi.fn(),
	readHubDiscovery: vi.fn(),
	clearHubDiscovery: vi.fn(async () => undefined),
	isManagedHubReusable: vi.fn(() => false),
}));

vi.mock("../daemon", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	hubHasLiveSessions,
	retireDiscoveredHub,
}));

vi.mock("../client", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	verifyHubConnection,
}));

vi.mock("../discovery", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	probeHubServer,
	readHubDiscovery,
	clearHubDiscovery,
	isManagedHubReusable,
}));

import type { HubWebSocketServer } from "./hub-server-options";
import { ensureHubWebSocketServer } from "./hub-websocket-server";

const STALE_URL = "ws://127.0.0.1:39999/hub";

function createOwner() {
	const root = mkdtempSync(join(tmpdir(), "cline-hub-ensure-retire-"));
	return {
		ownerId: "hub-ensure-retire-test",
		discoveryPath: join(root, "discovery.json"),
	};
}

function stubSessionHost() {
	return {
		subscribe: vi.fn(() => () => {}),
		startSession: vi.fn(),
		runTurn: vi.fn(),
		stopSession: vi.fn(async () => {}),
		abort: vi.fn(async () => {}),
		dispose: vi.fn(async () => {}),
		getSession: vi.fn(async () => undefined),
		getAccumulatedUsage: vi.fn(async () => undefined),
		listSessions: vi.fn(async () => []),
		deleteSession: vi.fn(async () => false),
		updateSession: vi.fn(async () => ({ updated: false })),
		updateSessionCompactionState: vi.fn(async () => ({ updated: false })),
		readSessionCompactionState: vi.fn(async () => undefined),
		readSessionMessages: vi.fn(async () => []),
		dispatchHookEvent: vi.fn(async () => {}),
		restoreSession: vi.fn(),
	} as never;
}

function ensureOptions(owner: ReturnType<typeof createOwner>) {
	const root = mkdtempSync(join(tmpdir(), "cline-hub-ensure-ws-"));
	return {
		owner,
		host: "127.0.0.1",
		port: 0,
		pathname: "/hub",
		workspaceRoot: root,
		runtimeHandlers: {
			startSession: vi.fn(),
			sendSession: vi.fn(),
			abortSession: vi.fn(),
			stopSession: vi.fn(),
		},
		scheduleOptions: { dbPath: ":memory:" },
		taskOptions: {
			dbPath: join(root, "tasks.db"),
			globalSpecsDir: join(root, "specs"),
			watchFiles: false,
		},
		eventLog: { dbPath: ":memory:" },
		runQueue: { dbPath: ":memory:" },
		sessionHost: stubSessionHost(),
	} as never;
}

describe("ensureHubWebSocketServer retire path", () => {
	const servers = new Set<HubWebSocketServer>();

	afterEach(async () => {
		for (const server of servers) {
			await server.close().catch(() => undefined);
		}
		servers.clear();
		vi.clearAllMocks();
		clearHubDiscovery.mockResolvedValue(undefined);
		isManagedHubReusable.mockReturnValue(false);
	});

	it("attaches to a busy unusable hub instead of retiring it", async () => {
		const owner = createOwner();
		readHubDiscovery.mockResolvedValue({
			url: STALE_URL,
			authToken: "busy-token",
			pid: 4242,
		});
		probeHubServer.mockResolvedValue({
			url: STALE_URL,
			protocolVersion: "v1",
			buildId: "old-build",
			pid: 4242,
		});
		hubHasLiveSessions.mockResolvedValue(true);
		verifyHubConnection.mockResolvedValue(true);

		const result = await ensureHubWebSocketServer(ensureOptions(owner));

		expect(result).toMatchObject({
			url: STALE_URL,
			authToken: "busy-token",
			action: "reuse",
		});
		expect(hubHasLiveSessions).toHaveBeenCalledWith({
			url: STALE_URL,
			authToken: "busy-token",
			pid: 4242,
		});
		expect(retireDiscoveredHub).not.toHaveBeenCalled();
		expect(clearHubDiscovery).not.toHaveBeenCalled();
	});

	it("retires an idle unusable hub through the shared drain-first retirement", async () => {
		const owner = createOwner();
		readHubDiscovery.mockResolvedValue({
			url: STALE_URL,
			authToken: "old-token",
			pid: 4242,
		});
		probeHubServer.mockResolvedValue({
			url: STALE_URL,
			protocolVersion: "v1",
			buildId: "old-build",
			pid: 4242,
		});
		hubHasLiveSessions.mockResolvedValue(false);
		retireDiscoveredHub.mockResolvedValue(true);

		const result = await ensureHubWebSocketServer(ensureOptions(owner));
		if (result.server) {
			servers.add(result.server);
		}

		expect(retireDiscoveredHub).toHaveBeenCalledWith(
			{ url: STALE_URL, authToken: "old-token", pid: 4242 },
			owner.discoveryPath,
		);
		// Discovery is retireDiscoveredHub's responsibility (cleared only when
		// the hub actually retired); the ensure path must not clear it itself.
		expect(clearHubDiscovery).not.toHaveBeenCalled();
		expect(result.action).toBe("started");
		expect(result.url).not.toBe(STALE_URL);
	});

	it("clears discovery for a stale record whose endpoint is gone", async () => {
		const owner = createOwner();
		readHubDiscovery.mockResolvedValue({
			url: STALE_URL,
			authToken: "gone-token",
		});
		probeHubServer.mockResolvedValue(undefined);

		const result = await ensureHubWebSocketServer(ensureOptions(owner));
		if (result.server) {
			servers.add(result.server);
		}

		expect(clearHubDiscovery).toHaveBeenCalledWith(owner.discoveryPath);
		expect(retireDiscoveredHub).not.toHaveBeenCalled();
		expect(result.action).toBe("started");
	});
});
