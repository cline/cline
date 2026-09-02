import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The sidecar reaches Composio only through the Cline API connectors proxy
 * (`./cline-connectors-api`). Tests mock that module and drive its behavior
 * per test, so no network — and no Composio key — is involved. `ConnectorsApiError`
 * is kept real so status-code handling (401/403/404) is exercised faithfully.
 */
const proxy = vi.hoisted(() => ({
	fetchConnectableToolkits: vi.fn(),
	initiateConnection: vi.fn(),
	listConnections: vi.fn(),
	deleteConnection: vi.fn(),
	listToolkitTools: vi.fn(),
	waitForConnectionActive: vi.fn(),
}));

vi.mock("./cline-connectors-api", async () => {
	const actual = await vi.importActual<typeof import("./cline-connectors-api")>(
		"./cline-connectors-api",
	);
	return {
		ConnectorsApiError: actual.ConnectorsApiError,
		fetchConnectableToolkits: proxy.fetchConnectableToolkits,
		initiateConnection: proxy.initiateConnection,
		listConnections: proxy.listConnections,
		deleteConnection: proxy.deleteConnection,
		listToolkitTools: proxy.listToolkitTools,
		waitForConnectionActive: proxy.waitForConnectionActive,
	};
});

import { ConnectorsApiError } from "./cline-connectors-api";
import {
	__resetComposioCachesForTesting,
	cancelComposioConnect,
	connectComposioToolkit,
	disconnectComposioToolkit,
	getComposioStatus,
	listComposioToolkits,
	parseComposioToolkitSlug,
} from "./composio";

const originalDataDir = process.env.CLINE_DATA_DIR;
const originalClineDir = process.env.CLINE_DIR;
const cleanupPaths: string[] = [];

function useTempDataDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "composio-proxy-test-"));
	cleanupPaths.push(dir);
	process.env.CLINE_DATA_DIR = dir;
	process.env.CLINE_DIR = dir;
	return dir;
}

function writeState(dataDir: string, state: unknown): void {
	const settingsDir = join(dataDir, "settings");
	mkdirSync(settingsDir, { recursive: true });
	writeFileSync(
		join(settingsDir, "composio.json"),
		JSON.stringify(state, null, "\t"),
	);
}

function readStateFile(dataDir: string): {
	toolkits?: Record<
		string,
		{ connectedAccountId?: string; tools?: unknown[] } | undefined
	>;
	cancelledAccountIds?: string[];
} {
	return JSON.parse(
		readFileSync(join(dataDir, "settings", "composio.json"), "utf8"),
	);
}

/** Signed-in and entitled: the availability probe (listConnections) succeeds. */
function makeAvailable(connections: unknown[] = []): void {
	proxy.listConnections.mockResolvedValue(connections);
}

beforeEach(() => {
	vi.clearAllMocks();
	__resetComposioCachesForTesting();
	// Sensible defaults; individual tests override.
	proxy.listConnections.mockResolvedValue([]);
	proxy.listToolkitTools.mockResolvedValue([]);
	proxy.deleteConnection.mockResolvedValue(undefined);
	proxy.fetchConnectableToolkits.mockResolvedValue([]);
	// waitForConnectionActive resolves immediately by default (connection active).
	proxy.waitForConnectionActive.mockResolvedValue(undefined);
});

afterEach(() => {
	if (originalDataDir === undefined) delete process.env.CLINE_DATA_DIR;
	else process.env.CLINE_DATA_DIR = originalDataDir;
	if (originalClineDir === undefined) delete process.env.CLINE_DIR;
	else process.env.CLINE_DIR = originalClineDir;
	for (const path of cleanupPaths.splice(0)) {
		rmSync(path, { recursive: true, force: true });
	}
});

describe("parseComposioToolkitSlug", () => {
	it("accepts well-formed slugs case-insensitively and rejects malformed ones", () => {
		expect(parseComposioToolkitSlug("Gmail ")).toBe("gmail");
		expect(parseComposioToolkitSlug("googlecalendar")).toBe("googlecalendar");
		expect(() => parseComposioToolkitSlug("bad slug!")).toThrow(
			/Invalid Composio toolkit slug/,
		);
	});
});

describe("availability gating (proxy entitlement)", () => {
	it("reports unconfigured and hides connectors when the proxy denies access", async () => {
		useTempDataDir();
		proxy.listConnections.mockRejectedValue(
			new ConnectorsApiError("not entitled", 403),
		);
		const status = await getComposioStatus();
		expect(status.configured).toBe(false);
		const catalog = await listComposioToolkits();
		expect(catalog).toEqual({ configured: false, toolkits: [] });
	});

	it("refuses to start a connection when the proxy denies access", async () => {
		useTempDataDir();
		proxy.listConnections.mockRejectedValue(
			new ConnectorsApiError("sign in", 401),
		);
		await expect(connectComposioToolkit("gmail")).rejects.toThrow(
			/Sign in to your Cline account/,
		);
		expect(proxy.initiateConnection).not.toHaveBeenCalled();
	});

	it("drops materialized connectors from state when access is lost", async () => {
		const dir = useTempDataDir();
		writeState(dir, {
			toolkits: {
				github: {
					connectedAccountId: "ca_1",
					connectedAt: "2026-08-28T00:00:00.000Z",
					tools: [{ slug: "GITHUB_CREATE_AN_ISSUE" }],
				},
			},
		});
		proxy.listConnections.mockRejectedValue(
			new ConnectorsApiError("signed out", 401),
		);
		const status = await getComposioStatus();
		expect(status.configured).toBe(false);
		expect(readStateFile(dir).toolkits).toEqual({});
	});

	it("a transient (5xx/offline) probe failure does not flip the feature off", async () => {
		useTempDataDir();
		proxy.listConnections.mockRejectedValue(
			new ConnectorsApiError("upstream 502", 502),
		);
		const status = await getComposioStatus();
		// Assume still-available; the real operation would surface the error.
		expect(status.configured).toBe(true);
	});
});

describe("getComposioStatus", () => {
	it("reports the recommended set as disconnected when signed in with nothing connected", async () => {
		useTempDataDir();
		makeAvailable();
		const status = await getComposioStatus();
		expect(status.configured).toBe(true);
		expect(status.integrations.map((entry) => entry.toolkit)).toEqual([
			"gmail",
			"googlecalendar",
			"github",
		]);
		expect(
			status.integrations.every((entry) => entry.status === "not_connected"),
		).toBe(true);
	});

	it("reports connected toolkits from persisted state", async () => {
		const dir = useTempDataDir();
		makeAvailable();
		writeState(dir, {
			toolkits: {
				github: {
					connectedAccountId: "ca_123",
					connectedAt: "2026-08-28T00:00:00.000Z",
					tools: [{ slug: "GITHUB_CREATE_AN_ISSUE", name: "Create issue" }],
				},
			},
		});
		const status = await getComposioStatus();
		const github = status.integrations.find((e) => e.toolkit === "github");
		expect(github?.status).toBe("connected");
		expect(github?.toolNames).toEqual(["Create issue"]);
	});

	it("re-fetches schemas for a connected toolkit stored with zero tools", async () => {
		const dir = useTempDataDir();
		makeAvailable([
			{
				id: "ca_wedged",
				status: "ACTIVE",
				toolkit: { slug: "googlecalendar" },
			},
		]);
		proxy.listToolkitTools.mockResolvedValue([
			{ slug: "GOOGLECALENDAR_CREATE_EVENT" },
			{ slug: "GOOGLECALENDAR_LIST_EVENTS" },
		]);
		writeState(dir, {
			toolkits: {
				googlecalendar: {
					connectedAccountId: "ca_wedged",
					connectedAt: "2026-08-28T00:00:00.000Z",
					name: "Google Calendar",
					tools: [],
				},
			},
		});
		// The wedge is visible before a refresh.
		const before = await getComposioStatus();
		expect(
			before.integrations.find((e) => e.toolkit === "googlecalendar")?.error,
		).toMatch(/no tools were retrieved/);
		// A refresh self-heals it.
		const status = await getComposioStatus({ refresh: true });
		const healed = status.integrations.find(
			(e) => e.toolkit === "googlecalendar",
		);
		expect(healed?.toolNames).toHaveLength(2);
		expect(healed?.error).toBeUndefined();
		expect(readStateFile(dir).toolkits?.googlecalendar?.tools).toHaveLength(2);
	});

	it("removes a locally-stored toolkit the proxy no longer lists (revoked remotely)", async () => {
		const dir = useTempDataDir();
		makeAvailable([]); // proxy list is authoritative → absent means revoked
		writeState(dir, {
			toolkits: {
				github: {
					connectedAccountId: "ca_gone",
					connectedAt: "2026-08-28T00:00:00.000Z",
					tools: [{ slug: "GITHUB_CREATE_AN_ISSUE" }],
				},
			},
		});
		const status = await getComposioStatus({ refresh: true });
		expect(
			status.integrations.find((e) => e.toolkit === "github")?.status,
		).toBe("not_connected");
		expect(readStateFile(dir).toolkits).toEqual({});
	});
});

describe("listComposioToolkits", () => {
	it("maps the proxy catalog into browsable entries", async () => {
		useTempDataDir();
		makeAvailable();
		proxy.fetchConnectableToolkits.mockResolvedValue([
			{
				slug: "gmail",
				name: "Gmail",
				description: "Email",
				logo: "https://logos/gmail.png",
				categories: ["Email"],
				toolsCount: 20,
			},
			{ slug: "bad slug!", name: "Broken" }, // dropped: invalid slug
		]);
		const catalog = await listComposioToolkits();
		expect(catalog.configured).toBe(true);
		expect(catalog.toolkits.map((t) => t.slug)).toEqual(["gmail"]);
		expect(catalog.toolkits[0].recommended).toBe(true);
		expect(catalog.toolkits[0].toolsCount).toBe(20);
	});
});

describe("connectComposioToolkit", () => {
	it("initiates through the proxy, waits, and finalizes with fetched tools", async () => {
		const dir = useTempDataDir();
		makeAvailable();
		proxy.initiateConnection.mockResolvedValue({
			connectedAccountId: "ca_new",
			redirectUrl: "https://connect.example/ca_new",
		});
		proxy.listToolkitTools.mockResolvedValue([{ slug: "GMAIL_SEND_EMAIL" }]);
		const result = await connectComposioToolkit("gmail");
		expect(result.redirectUrl).toContain("ca_new");
		expect(proxy.initiateConnection).toHaveBeenCalledWith(
			"gmail",
			expect.anything(),
		);
		// The background waiter resolved immediately; the finalize wrote tools.
		await vi.waitFor(() => {
			expect(readStateFile(dir).toolkits?.gmail?.connectedAccountId).toBe(
				"ca_new",
			);
		});
		expect(readStateFile(dir).toolkits?.gmail?.tools).toHaveLength(1);
	});

	it("finalizes a redirect-less connection inline and reports alreadyConnected", async () => {
		const dir = useTempDataDir();
		makeAvailable();
		proxy.initiateConnection.mockResolvedValue({
			connectedAccountId: "ca_direct",
			// no redirectUrl → already authorized
		});
		proxy.listToolkitTools.mockResolvedValue([{ slug: "GITHUB_LIST_ISSUES" }]);
		const result = await connectComposioToolkit("github");
		expect(result.alreadyConnected).toBe(true);
		expect(readStateFile(dir).toolkits?.github?.connectedAccountId).toBe(
			"ca_direct",
		);
	});

	it("overlapping connects are single-flight: only one initiate call is made", async () => {
		useTempDataDir();
		makeAvailable();
		let releaseInitiate: (() => void) | undefined;
		proxy.initiateConnection.mockImplementation(
			() =>
				new Promise((resolve) => {
					releaseInitiate = () =>
						resolve({
							connectedAccountId: "ca_single",
							redirectUrl: "https://connect.example/ca_single",
						});
				}),
		);
		proxy.waitForConnectionActive.mockImplementation(
			() => new Promise(() => {}),
		);
		const first = connectComposioToolkit("gmail");
		await vi.waitFor(() => {
			expect(proxy.initiateConnection).toHaveBeenCalledTimes(1);
		});
		// A second connect lands mid-initiation, before any pending entry exists.
		const second = await connectComposioToolkit("gmail");
		expect(second.redirectUrl).toBeUndefined();
		expect(proxy.initiateConnection).toHaveBeenCalledTimes(1);
		releaseInitiate?.();
		const firstResult = await first;
		expect(firstResult.redirectUrl).toContain("ca_single");
		await cancelComposioConnect("gmail");
	});
});

describe("cancelComposioConnect", () => {
	it("revokes the cancelled attempt via the proxy and refuses to import it later", async () => {
		const dir = useTempDataDir();
		makeAvailable();
		proxy.initiateConnection.mockResolvedValue({
			connectedAccountId: "ca_cancelled",
			redirectUrl: "https://connect.example/ca_cancelled",
		});
		// The waiter never resolves (user still in the browser) until cancel.
		proxy.waitForConnectionActive.mockImplementation(
			() => new Promise(() => {}),
		);
		// The cancel's revocation fails, so only the tombstone protects.
		proxy.deleteConnection.mockRejectedValue(
			new ConnectorsApiError("500 internal", 500),
		);
		await connectComposioToolkit("github");
		await cancelComposioConnect("github");
		expect(proxy.deleteConnection).toHaveBeenCalledWith(
			"ca_cancelled",
			expect.anything(),
		);
		expect(readStateFile(dir).cancelledAccountIds).toContain("ca_cancelled");

		// The browser flow completes afterwards; a refresh sees it ACTIVE but
		// must retry revocation, not import it.
		proxy.listConnections.mockResolvedValue([
			{ id: "ca_cancelled", status: "ACTIVE", toolkit: { slug: "github" } },
		]);
		const status = await getComposioStatus({ refresh: true });
		expect(
			status.integrations.find((e) => e.toolkit === "github")?.status,
		).toBe("not_connected");
		expect(readStateFile(dir).toolkits ?? {}).toEqual({});
	});

	it("prunes the tombstone once the revocation is confirmed", async () => {
		const dir = useTempDataDir();
		makeAvailable();
		proxy.initiateConnection.mockResolvedValue({
			connectedAccountId: "ca_pruned",
			redirectUrl: "https://connect.example/ca_pruned",
		});
		proxy.waitForConnectionActive.mockImplementation(
			() => new Promise(() => {}),
		);
		proxy.deleteConnection.mockResolvedValue(undefined); // confirmed gone
		await connectComposioToolkit("github");
		await cancelComposioConnect("github");
		expect(readStateFile(dir).cancelledAccountIds).toBeUndefined();
	});
});

describe("disconnectComposioToolkit", () => {
	const storedGithub = {
		toolkits: {
			github: {
				connectedAccountId: "ca_github",
				connectedAt: "2026-08-28T00:00:00.000Z",
				tools: [{ slug: "GITHUB_CREATE_AN_ISSUE" }],
			},
		},
	};

	it("deletes the connection through the proxy (revoke_on_delete server-side)", async () => {
		const dir = useTempDataDir();
		makeAvailable();
		writeState(dir, storedGithub);
		const status = await disconnectComposioToolkit("github");
		expect(proxy.deleteConnection).toHaveBeenCalledWith(
			"ca_github",
			expect.anything(),
		);
		expect(
			status.integrations.find((e) => e.toolkit === "github")?.status,
		).toBe("not_connected");
		expect(readStateFile(dir).toolkits).toEqual({});
	});

	it("keeps the connector installed and surfaces the error when revocation fails", async () => {
		const dir = useTempDataDir();
		makeAvailable();
		writeState(dir, storedGithub);
		proxy.deleteConnection.mockRejectedValue(
			new ConnectorsApiError("500 internal", 500),
		);
		await expect(disconnectComposioToolkit("github")).rejects.toThrow(
			/still connected/,
		);
		expect(readStateFile(dir).toolkits?.github).toBeTruthy();
	});

	it("treats a 404 as already-gone and removes local state", async () => {
		const dir = useTempDataDir();
		makeAvailable();
		writeState(dir, storedGithub);
		proxy.deleteConnection.mockRejectedValue(
			new ConnectorsApiError("not found", 404),
		);
		const status = await disconnectComposioToolkit("github");
		expect(
			status.integrations.find((e) => e.toolkit === "github")?.status,
		).toBe("not_connected");
		expect(readStateFile(dir).toolkits).toEqual({});
	});
});
