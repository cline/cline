import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildConnectableCatalog,
	cancelComposioConnect,
	connectComposioToolkit,
	disconnectComposioToolkit,
	getComposioStatus,
	initiateToolkitConnection,
	parseComposioToolkitSlug,
} from "./composio";

/**
 * The sidecar module loads `@composio/core` lazily and caches one client per
 * API key, so tests that exercise network-touching flows swap in a mock
 * client here and each use a unique API key to bypass that cache.
 */
let createMockComposioClient: (apiKey: string) => unknown = () => {
	throw new Error("createMockComposioClient is not configured for this test");
};
vi.mock("@composio/core", () => ({
	Composio: class {
		constructor(options: { apiKey: string }) {
			const client = createMockComposioClient(options.apiKey) as Record<
				string,
				// biome-ignore lint/suspicious/noExplicitAny: test double bridging two mock shapes.
				any
			>;
			// Tests declare a flat `connectedAccounts.delete` mock; the module
			// deletes through the raw client (getClient) so revoke_on_delete is
			// sent. Bridge the shapes here once instead of in every mock.
			if (client && !client.getClient) {
				client.getClient = () => ({
					connectedAccounts: {
						delete: (id: string, params: unknown) =>
							client.connectedAccounts?.delete?.(id, params),
					},
				});
			}
			// biome-ignore lint/correctness/noConstructorReturn: returning an object from the constructor is how the mock substitutes the per-test client for `this`.
			return client as object;
		}
	},
}));

const originalDataDir = process.env.CLINE_DATA_DIR;
const originalClineDir = process.env.CLINE_DIR;
const originalEnvApiKey = process.env.COMPOSIO_API_KEY;
const cleanupPaths: string[] = [];

// Sandboxes both the state file (CLINE_DATA_DIR) and the legacy plugin
// directory (CLINE_DIR), which reconciled reads clean up.
function useTempDataDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "composio-test-"));
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
	apiKey?: string;
	userId?: string;
	toolkits?: Record<string, { connectedAccountId?: string } | undefined>;
	cancelledAccountIds?: string[];
} {
	return JSON.parse(
		readFileSync(join(dataDir, "settings", "composio.json"), "utf8"),
	);
}

beforeEach(() => {
	// The host machine may export a real COMPOSIO_API_KEY; tests opt in
	// explicitly so env-fallback behavior stays deterministic.
	delete process.env.COMPOSIO_API_KEY;
});

afterEach(() => {
	restoreEnv("CLINE_DATA_DIR", originalDataDir);
	restoreEnv("CLINE_DIR", originalClineDir);
	restoreEnv("COMPOSIO_API_KEY", originalEnvApiKey);
	createMockComposioClient = () => {
		throw new Error("createMockComposioClient is not configured for this test");
	};
	vi.unstubAllGlobals();
	for (const path of cleanupPaths.splice(0)) {
		rmSync(path, { recursive: true, force: true });
	}
});

function restoreEnv(name: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name];
	} else {
		process.env[name] = value;
	}
}

describe("parseComposioToolkitSlug", () => {
	it("accepts well-formed toolkit slugs case-insensitively", () => {
		expect(parseComposioToolkitSlug("gmail")).toBe("gmail");
		expect(parseComposioToolkitSlug("GitHub ")).toBe("github");
		expect(parseComposioToolkitSlug("googlecalendar")).toBe("googlecalendar");
		expect(parseComposioToolkitSlug("slack")).toBe("slack");
		expect(parseComposioToolkitSlug("one_drive")).toBe("one_drive");
	});

	it("rejects malformed slugs", () => {
		expect(() => parseComposioToolkitSlug("")).toThrow(
			/Invalid Composio toolkit slug/,
		);
		expect(() => parseComposioToolkitSlug("bad slug!")).toThrow(
			/Invalid Composio toolkit slug/,
		);
		expect(() => parseComposioToolkitSlug("a".repeat(80))).toThrow(
			/Invalid Composio toolkit slug/,
		);
	});
});

describe("getComposioStatus", () => {
	it("reports unconfigured state with all integrations disconnected", async () => {
		useTempDataDir();
		const status = await getComposioStatus();
		expect(status.configured).toBe(false);
		expect(status.integrations.map((entry) => entry.toolkit)).toEqual([
			"gmail",
			"googlecalendar",
			"github",
		]);
		expect(
			status.integrations.every((entry) => entry.status === "not_connected"),
		).toBe(true);
	});

	it("reports connected toolkits from persisted state without hitting the network", async () => {
		const dataDir = useTempDataDir();
		process.env.COMPOSIO_API_KEY = "ck_test";
		writeState(dataDir, {
			apiKey: "ck_test",
			userId: "cline-desktop-test",
			toolkits: {
				github: {
					connectedAccountId: "ca_123",
					connectedAt: "2026-08-28T00:00:00.000Z",
					tools: [{ slug: "GITHUB_CREATE_AN_ISSUE", name: "Create issue" }],
				},
			},
		});
		const status = await getComposioStatus();
		expect(status.configured).toBe(true);
		const github = status.integrations.find(
			(entry) => entry.toolkit === "github",
		);
		expect(github?.status).toBe("connected");
		expect(github?.recommended).toBe(true);
		expect(github?.toolNames).toEqual(["Create issue"]);
		const gmail = status.integrations.find(
			(entry) => entry.toolkit === "gmail",
		);
		expect(gmail?.status).toBe("not_connected");
	});

	it("includes connected non-recommended toolkits alongside the recommended set", async () => {
		const dataDir = useTempDataDir();
		process.env.COMPOSIO_API_KEY = "ck_test";
		writeState(dataDir, {
			apiKey: "ck_test",
			userId: "cline-desktop-test",
			toolkits: {
				slack: {
					connectedAccountId: "ca_slack",
					connectedAt: "2026-08-28T00:00:00.000Z",
					name: "Slack",
					tools: [{ slug: "SLACK_SEND_MESSAGE" }],
				},
			},
		});
		const status = await getComposioStatus();
		const slack = status.integrations.find(
			(entry) => entry.toolkit === "slack",
		);
		expect(slack?.status).toBe("connected");
		expect(slack?.recommended).toBe(false);
		expect(slack?.name).toBe("Slack");
		// The recommended set is still always present.
		expect(
			status.integrations.filter((entry) => entry.recommended),
		).toHaveLength(3);
	});
});

describe("buildConnectableCatalog", () => {
	it("keeps managed toolkits and drops unmanaged ones without an auth config", () => {
		const entries = buildConnectableCatalog(
			[
				{
					slug: "gmail",
					name: "Gmail",
					composio_managed_auth_schemes: ["OAUTH2"],
					meta: {
						description: "Email",
						logo: "https://logos/gmail.png",
						tools_count: 20,
						categories: [{ slug: "email", name: "Email" }],
					},
				},
				// No managed credentials and no project auth config — a Connect
				// click would fail, so it is hidden.
				{ slug: "canvas", name: "Canvas", composio_managed_auth_schemes: [] },
				// Unmanaged, but the project configured its own OAuth app.
				{ slug: "internaltool", name: "Internal Tool" },
			],
			new Set(["internaltool"]),
		);
		expect(entries.map((entry) => entry.slug)).toEqual([
			"gmail",
			"internaltool",
		]);
		const gmail = entries[0];
		expect(gmail.recommended).toBe(true);
		expect(gmail.toolsCount).toBe(20);
		expect(gmail.categories).toEqual(["Email"]);
	});

	it("dedupes and drops malformed slugs", () => {
		const entries = buildConnectableCatalog(
			[
				{
					slug: "GitHub",
					name: "GitHub",
					composio_managed_auth_schemes: ["OAUTH2"],
				},
				{
					slug: "github",
					name: "GitHub dup",
					composio_managed_auth_schemes: ["OAUTH2"],
				},
				{
					slug: "bad slug!",
					name: "Broken",
					composio_managed_auth_schemes: ["OAUTH2"],
				},
			],
			new Set(),
		);
		expect(entries.map((entry) => entry.slug)).toEqual(["github"]);
	});
});

describe("initiateToolkitConnection", () => {
	type FakeClient = Parameters<typeof initiateToolkitConnection>[0];
	const LEGACY_ERROR = new Error(
		'400 {"error":{"message":"Creating connections on this endpoint for Composio-managed OAuth auth configs is no longer supported. Use POST /api/v3/connected_accounts/link instead.","code":600}}',
	);
	const request = (id: string) => ({
		id,
		redirectUrl: `https://connect.example/${id}`,
		waitForConnection: async () => ({}),
	});

	it("prefers a custom (org-branded) auth config and links through it directly", async () => {
		const link = vi.fn(async () => request("ca_custom"));
		const client = {
			toolkits: { authorize: vi.fn() },
			authConfigs: {
				list: vi.fn(async () => ({
					items: [
						{ id: "ac_managed", isComposioManaged: true },
						{ id: "ac_custom", isComposioManaged: false },
					],
				})),
				create: vi.fn(),
			},
			connectedAccounts: { link },
		} as unknown as FakeClient;
		const result = await initiateToolkitConnection(client, "user", "github");
		expect(result.id).toBe("ca_custom");
		expect(link).toHaveBeenCalledWith("user", "ac_custom");
		expect(client.toolkits.authorize).not.toHaveBeenCalled();
	});

	it("returns the authorize result when the legacy endpoint still works", async () => {
		const client = {
			toolkits: { authorize: vi.fn(async () => request("ca_direct")) },
			authConfigs: { list: vi.fn(), create: vi.fn() },
			connectedAccounts: { link: vi.fn() },
		} as unknown as FakeClient;
		const result = await initiateToolkitConnection(client, "user", "gmail");
		expect(result.id).toBe("ca_direct");
		expect(client.connectedAccounts.link).not.toHaveBeenCalled();
	});

	it("falls back to the link flow with the existing auth config on the retired-endpoint error", async () => {
		const link = vi.fn(async () => request("ca_linked"));
		const client = {
			toolkits: {
				authorize: vi.fn(async () => {
					throw LEGACY_ERROR;
				}),
			},
			authConfigs: {
				list: vi.fn(async () => ({ items: [{ id: "ac_gmail" }] })),
				create: vi.fn(),
			},
			connectedAccounts: { link },
		} as unknown as FakeClient;
		const result = await initiateToolkitConnection(client, "user", "gmail");
		expect(result.id).toBe("ca_linked");
		expect(link).toHaveBeenCalledWith("user", "ac_gmail");
		expect(client.authConfigs.create).not.toHaveBeenCalled();
	});

	it("creates a managed auth config when none exists before linking", async () => {
		const create = vi.fn(async () => ({ id: "ac_created" }));
		const link = vi.fn(async () => request("ca_linked"));
		const client = {
			toolkits: {
				authorize: vi.fn(async () => {
					throw LEGACY_ERROR;
				}),
			},
			authConfigs: {
				list: vi.fn(async () => ({ items: [] })),
				create,
			},
			connectedAccounts: { link },
		} as unknown as FakeClient;
		await initiateToolkitConnection(client, "user", "github");
		expect(create).toHaveBeenCalledWith("github", {
			type: "use_composio_managed_auth",
		});
		expect(link).toHaveBeenCalledWith("user", "ac_created");
	});

	it("rethrows unrelated authorize errors without linking", async () => {
		const client = {
			toolkits: {
				authorize: vi.fn(async () => {
					throw new Error("401 invalid api key");
				}),
			},
			authConfigs: { list: vi.fn(), create: vi.fn() },
			connectedAccounts: { link: vi.fn() },
		} as unknown as FakeClient;
		await expect(
			initiateToolkitConnection(client, "user", "gmail"),
		).rejects.toThrow(/invalid api key/);
		expect(client.connectedAccounts.link).not.toHaveBeenCalled();
	});
});

describe("managed COMPOSIO_API_KEY", () => {
	it("adopts the managed key and persists it for the plugin", async () => {
		const dir = useTempDataDir();
		process.env.COMPOSIO_API_KEY = "ck_from_env";
		const status = await getComposioStatus();
		expect(status.configured).toBe(true);
		const persisted = readStateFile(dir);
		expect(persisted.apiKey).toBe("ck_from_env");
		expect(persisted.userId).toMatch(/^cline-desktop-/);
	});

	it("rotating the managed key drops the previous project's toolkits and plugin", async () => {
		const dir = useTempDataDir();
		process.env.COMPOSIO_API_KEY = "ck_first";
		writeState(dir, {
			apiKey: "ck_first",
			userId: "cline-desktop-rotate",
			toolkits: {
				github: {
					connectedAccountId: "ca_github",
					connectedAt: "2026-08-28T00:00:00.000Z",
					tools: [{ slug: "GITHUB_CREATE_AN_ISSUE" }],
				},
			},
		});
		// A leftover drop-in plugin from a pre–in-process-registration build.
		const legacyPluginPath = join(dir, "plugins", "composio-tools.ts");
		mkdirSync(join(dir, "plugins"), { recursive: true });
		writeFileSync(legacyPluginPath, "// legacy generated plugin");
		// The new key belongs to a different Composio project. Even with no
		// successful refresh afterwards, the old project's connectors must not
		// stay reported as installed under the new key — their tools would
		// execute against the wrong project.
		process.env.COMPOSIO_API_KEY = "ck_second";
		const rotated = await getComposioStatus();
		expect(rotated.configured).toBe(true);
		expect(
			rotated.integrations.find((entry) => entry.toolkit === "github")?.status,
		).toBe("not_connected");
		const persisted = readStateFile(dir);
		expect(persisted.apiKey).toBe("ck_second");
		expect(persisted.toolkits).toEqual({});
		// The legacy plugin file is cleaned up on any reconciled read.
		expect(existsSync(legacyPluginPath)).toBe(false);
	});

	it("dropping the managed key drops the stored key and materialized connections", async () => {
		const dir = useTempDataDir();
		writeState(dir, {
			apiKey: "ck_gone",
			userId: "cline-desktop-drop",
			toolkits: {
				github: {
					connectedAccountId: "ca_github",
					connectedAt: "2026-08-28T00:00:00.000Z",
					tools: [{ slug: "GITHUB_CREATE_AN_ISSUE" }],
				},
			},
		});
		// beforeEach cleared COMPOSIO_API_KEY, so no managed key is available.
		const dropped = await getComposioStatus();
		expect(dropped.configured).toBe(false);
		const persisted = readStateFile(dir);
		expect(persisted.apiKey).toBeUndefined();
		expect(persisted.toolkits).toEqual({});
	});

	it("status reads survive an unwritable plugins directory", async () => {
		const dir = useTempDataDir();
		writeState(dir, {
			userId: "cline-desktop-env",
			toolkits: {
				github: {
					connectedAccountId: "ca_github",
					connectedAt: "2026-08-28T00:00:00.000Z",
					tools: [{ slug: "GITHUB_CREATE_AN_ISSUE" }],
				},
			},
		});
		// A file where the plugins directory should be makes the plugin sync
		// throw; the passive status path must log-and-continue instead.
		writeFileSync(join(dir, "plugins"), "not a directory");
		process.env.COMPOSIO_API_KEY = "ck_from_env";
		const status = await getComposioStatus();
		expect(status.configured).toBe(true);
	});
});

describe("connectComposioToolkit", () => {
	it("overlapping connects are single-flight: only one remote account is ever created", async () => {
		const dir = useTempDataDir();
		process.env.COMPOSIO_API_KEY = "ck_overlap";
		writeState(dir, {
			apiKey: "ck_overlap",
			userId: "u_overlap",
			toolkits: {},
		});
		let releaseAuthorize: (() => void) | undefined;
		const authorize = vi.fn(
			() =>
				new Promise<{
					id: string;
					redirectUrl: string;
					waitForConnection: () => Promise<unknown>;
				}>((resolve) => {
					releaseAuthorize = () =>
						resolve({
							id: "ca_single",
							redirectUrl: "https://connect.example/ca_single",
							waitForConnection: () => new Promise(() => {}),
						});
				}),
		);
		const remoteDelete = vi.fn(async () => ({}));
		const client = {
			toolkits: { authorize },
			authConfigs: {
				list: vi.fn(async () => ({ items: [] })),
				create: vi.fn(),
			},
			tools: { getRawComposioTools: vi.fn(async () => []) },
			connectedAccounts: {
				list: vi.fn(async () => ({ items: [] })),
				link: vi.fn(),
				delete: remoteDelete,
			},
		};
		createMockComposioClient = () => client;

		const first = connectComposioToolkit("github");
		await vi.waitFor(() => {
			expect(authorize).toHaveBeenCalledTimes(1);
		});
		// A second connect lands while the first is still inside the
		// initiation round trip — before any pending entry exists. It must
		// not start a second attempt (whose account nothing would ever
		// revoke) or overwrite the first attempt's pending entry.
		const second = await connectComposioToolkit("github");
		expect(second.redirectUrl).toBeUndefined();
		expect(authorize).toHaveBeenCalledTimes(1);

		releaseAuthorize?.();
		const firstResult = await first;
		expect(firstResult.redirectUrl).toContain("ca_single");
		// The surviving pending attempt is the first one; a third call now
		// reports it instead of starting over.
		const third = await connectComposioToolkit("github");
		expect(third.redirectUrl).toContain("ca_single");
		expect(authorize).toHaveBeenCalledTimes(1);
		// Clean up the pending attempt so it cannot leak into other tests.
		await cancelComposioConnect("github");
	});

	it("a refresh racing a redirect-less attempt cannot leave a failed connection installed", async () => {
		const dir = useTempDataDir();
		process.env.COMPOSIO_API_KEY = "ck_refresh_race";
		writeState(dir, {
			apiKey: "ck_refresh_race",
			userId: "u_refresh_race",
			toolkits: {},
		});
		let rejectConnectFetch: ((error: Error) => void) | undefined;
		const getRawComposioTools = vi.fn(() =>
			// First call is the connect's finalize: suspended, then failed.
			// Any later call (a refresh import) resolves immediately.
			getRawComposioTools.mock.calls.length <= 1
				? new Promise<{ slug: string }[]>((_resolve, reject) => {
						rejectConnectFetch = reject;
					})
				: Promise.resolve([{ slug: "GITHUB_LIST_ISSUES" }]),
		);
		const remoteDelete = vi.fn(async () => ({}));
		const client = {
			toolkits: {
				// Redirect-less: the account is ACTIVE remotely from creation,
				// which is what lets a concurrent refresh see it.
				authorize: vi.fn(async () => ({
					id: "ca_race_import",
					redirectUrl: null,
					waitForConnection: async () => ({}),
				})),
			},
			authConfigs: {
				list: vi.fn(async () => ({ items: [] })),
				create: vi.fn(),
			},
			tools: { getRawComposioTools },
			connectedAccounts: {
				list: vi.fn(async () => ({
					items: [
						{
							id: "ca_race_import",
							status: "ACTIVE",
							toolkit: { slug: "github" },
						},
					],
					nextCursor: null,
				})),
				link: vi.fn(),
				delete: remoteDelete,
			},
		};
		createMockComposioClient = () => client;

		const connectPromise = connectComposioToolkit("github");
		await vi.waitFor(() => {
			expect(getRawComposioTools).toHaveBeenCalledTimes(1);
		});
		// A refresh runs while the attempt is mid-finalize and sees the
		// account as ACTIVE. The in-flight guard must keep it from importing
		// the connector out from under the attempt.
		const refreshed = await getComposioStatus({ refresh: true });
		expect(
			refreshed.integrations.find((entry) => entry.toolkit === "github")
				?.status,
		).toBe("not_connected");
		expect(readStateFile(dir).toolkits ?? {}).toEqual({});
		// The attempt's tool fetch then fails; the account is abandoned.
		rejectConnectFetch?.(new Error("500 tools endpoint exploded"));
		await expect(connectPromise).rejects.toThrow(/tools endpoint exploded/);
		expect(remoteDelete).toHaveBeenCalledWith("ca_race_import", {
			revoke_on_delete: true,
		});
		// Nothing may report the failed connection as installed afterwards.
		expect(readStateFile(dir).toolkits ?? {}).toEqual({});
		const after = await getComposioStatus();
		expect(
			after.integrations.find((entry) => entry.toolkit === "github")?.status,
		).toBe("not_connected");
	});

	it("a connect overlapping a redirect-less finalize is also single-flight", async () => {
		const dir = useTempDataDir();
		process.env.COMPOSIO_API_KEY = "ck_overlap_rl";
		writeState(dir, {
			apiKey: "ck_overlap_rl",
			userId: "u_overlap_rl",
			toolkits: {},
		});
		let releaseToolFetch: (() => void) | undefined;
		const authorize = vi.fn(async () => ({
			id: "ca_rl_single",
			redirectUrl: null,
			waitForConnection: async () => ({}),
		}));
		const client = {
			toolkits: { authorize },
			authConfigs: {
				list: vi.fn(async () => ({ items: [] })),
				create: vi.fn(),
			},
			tools: {
				getRawComposioTools: vi.fn(
					() =>
						new Promise<{ slug: string }[]>((resolve) => {
							releaseToolFetch = () =>
								resolve([{ slug: "GITHUB_LIST_ISSUES" }]);
						}),
				),
			},
			connectedAccounts: {
				list: vi.fn(async () => ({ items: [] })),
				link: vi.fn(),
				delete: vi.fn(async () => ({})),
			},
		};
		createMockComposioClient = () => client;

		const first = connectComposioToolkit("github");
		await vi.waitFor(() => {
			expect(client.tools.getRawComposioTools).toHaveBeenCalledTimes(1);
		});
		// The redirect-less path never has a pending entry, so the in-flight
		// guard is the only thing preventing a duplicate attempt here.
		const second = await connectComposioToolkit("github");
		expect(second.alreadyConnected).toBeUndefined();
		expect(authorize).toHaveBeenCalledTimes(1);

		releaseToolFetch?.();
		const firstResult = await first;
		expect(firstResult.alreadyConnected).toBe(true);
		expect(readStateFile(dir).toolkits?.github?.connectedAccountId).toBe(
			"ca_rl_single",
		);
	});
});

describe("cancelComposioConnect", () => {
	it("revokes the cancelled attempt and never imports it, even when the browser flow completes later", async () => {
		const dir = useTempDataDir();
		process.env.COMPOSIO_API_KEY = "ck_cancel";
		writeState(dir, { apiKey: "ck_cancel", userId: "u_cancel", toolkits: {} });
		let resolveWait: ((value: unknown) => void) | undefined;
		const remoteDelete = vi.fn(async () => {
			// Even a failed revocation must not let the account back in.
			throw new Error("500 internal error");
		});
		const client = {
			toolkits: {
				authorize: vi.fn(async () => ({
					id: "ca_cancelled",
					redirectUrl: "https://connect.example/ca_cancelled",
					waitForConnection: () =>
						new Promise((resolve) => {
							resolveWait = resolve;
						}),
				})),
			},
			authConfigs: {
				list: vi.fn(async () => ({ items: [] })),
				create: vi.fn(),
			},
			tools: { getRawComposioTools: vi.fn(async () => []) },
			connectedAccounts: {
				list: vi.fn(async () => ({
					items: [
						{
							id: "ca_cancelled",
							status: "ACTIVE",
							toolkit: { slug: "github" },
						},
					],
				})),
				link: vi.fn(),
				delete: remoteDelete,
			},
		};
		createMockComposioClient = () => client;

		const connect = await connectComposioToolkit("github");
		expect(connect.redirectUrl).toContain("ca_cancelled");
		await cancelComposioConnect("github");
		// Cancel revokes the pending account remotely…
		expect(remoteDelete).toHaveBeenCalledWith("ca_cancelled", {
			revoke_on_delete: true,
		});
		// …and tombstones it so no later snapshot can bring it back.
		expect(readStateFile(dir).cancelledAccountIds).toContain("ca_cancelled");

		// The user completes the still-open browser tab afterwards…
		resolveWait?.({});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(client.tools.getRawComposioTools).not.toHaveBeenCalled();

		// …and a dashboard reconciliation sees the account as ACTIVE. It must
		// retry the revocation instead of importing the connector.
		const status = await getComposioStatus({ refresh: true });
		expect(
			status.integrations.find((entry) => entry.toolkit === "github")?.status,
		).toBe("not_connected");
		expect(remoteDelete).toHaveBeenCalledTimes(2);
		expect(readStateFile(dir).toolkits).toEqual({});
		// The deletion is still unconfirmed, so the tombstone must survive.
		expect(readStateFile(dir).cancelledAccountIds).toContain("ca_cancelled");
	});

	it("prunes the tombstone once the revocation is confirmed", async () => {
		const dir = useTempDataDir();
		process.env.COMPOSIO_API_KEY = "ck_prune";
		writeState(dir, { apiKey: "ck_prune", userId: "u_prune", toolkits: {} });
		const client = {
			toolkits: {
				authorize: vi.fn(async () => ({
					id: "ca_pruned",
					redirectUrl: "https://connect.example/ca_pruned",
					waitForConnection: () => new Promise(() => {}),
				})),
			},
			authConfigs: {
				list: vi.fn(async () => ({ items: [] })),
				create: vi.fn(),
			},
			tools: { getRawComposioTools: vi.fn(async () => []) },
			connectedAccounts: {
				list: vi.fn(async () => ({ items: [] })),
				link: vi.fn(),
				delete: vi.fn(async () => ({})),
			},
		};
		createMockComposioClient = () => client;
		await connectComposioToolkit("github");
		await cancelComposioConnect("github");
		// The delete succeeded, so the account can never turn ACTIVE and the
		// tombstone has nothing left to guard.
		expect(readStateFile(dir).cancelledAccountIds).toBeUndefined();
	});

	it("retains every unconfirmed tombstone with no count bound, so an old cancelled flow that completes late is still refused", async () => {
		const dir = useTempDataDir();
		process.env.COMPOSIO_API_KEY = "ck_no_evict";
		writeState(dir, {
			apiKey: "ck_no_evict",
			userId: "u_no_evict",
			toolkits: {},
		});
		const CANCELLED_ATTEMPTS = 55;
		let attempt = 0;
		const remoteDelete = vi.fn(async () => {
			// Every revocation fails, so no tombstone is ever confirmed gone.
			throw new Error("500 internal error");
		});
		const client = {
			toolkits: {
				authorize: vi.fn(async () => {
					const id = `ca_evict_${attempt++}`;
					return {
						id,
						redirectUrl: `https://connect.example/${id}`,
						waitForConnection: () => new Promise(() => {}),
					};
				}),
			},
			authConfigs: {
				list: vi.fn(async () => ({ items: [] })),
				create: vi.fn(),
			},
			tools: { getRawComposioTools: vi.fn(async () => []) },
			connectedAccounts: {
				list: vi.fn(async () => ({
					// The OLDEST cancelled attempt completes long after the
					// others were cancelled.
					items: [
						{
							id: "ca_evict_0",
							status: "ACTIVE",
							toolkit: { slug: "github" },
						},
					],
				})),
				link: vi.fn(),
				delete: remoteDelete,
			},
		};
		createMockComposioClient = () => client;
		for (let i = 0; i < CANCELLED_ATTEMPTS; i++) {
			await connectComposioToolkit("github");
			await cancelComposioConnect("github");
		}
		expect(readStateFile(dir).cancelledAccountIds).toHaveLength(
			CANCELLED_ATTEMPTS,
		);
		const status = await getComposioStatus({ refresh: true });
		expect(
			status.integrations.find((entry) => entry.toolkit === "github")?.status,
		).toBe("not_connected");
		expect(readStateFile(dir).toolkits).toEqual({});
		expect(readStateFile(dir).cancelledAccountIds).toContain("ca_evict_0");
	});

	it("a connection finalized mid-refresh survives the reconciliation write", async () => {
		const dir = useTempDataDir();
		process.env.COMPOSIO_API_KEY = "ck_mid_refresh";
		writeState(dir, {
			apiKey: "ck_mid_refresh",
			userId: "u_mid_refresh",
			toolkits: {
				// Revoked on Composio's side: the refresh should remove it.
				gmail: {
					connectedAccountId: "ca_gmail_revoked",
					connectedAt: "2026-08-28T00:00:00.000Z",
					tools: [{ slug: "GMAIL_SEND_EMAIL" }],
				},
			},
		});
		let releaseList: ((value: { items: unknown[] }) => void) | undefined;
		const list = vi.fn(
			() =>
				new Promise<{ items: unknown[] }>((resolve) => {
					releaseList = resolve;
				}),
		);
		const client = {
			toolkits: {
				// No redirect URL: the connect finalizes inline.
				authorize: vi.fn(async () => ({
					id: "ca_github_new",
					redirectUrl: null,
					waitForConnection: async () => ({}),
				})),
			},
			authConfigs: {
				list: vi.fn(async () => ({ items: [] })),
				create: vi.fn(),
			},
			tools: {
				getRawComposioTools: vi.fn(async () => [
					{ slug: "GITHUB_CREATE_AN_ISSUE" },
				]),
			},
			connectedAccounts: { list, link: vi.fn(), delete: vi.fn() },
		};
		createMockComposioClient = () => client;
		const statusPromise = getComposioStatus({ refresh: true });
		await vi.waitFor(() => {
			expect(list).toHaveBeenCalled();
		});
		// While the refresh is suspended on the account list, a connect for a
		// different toolkit completes and persists its connection.
		const connectResult = await connectComposioToolkit("github");
		expect(connectResult.alreadyConnected).toBe(true);
		expect(readStateFile(dir).toolkits?.github).toBeTruthy();
		releaseList?.({ items: [] });
		const status = await statusPromise;
		// The refresh removes the genuinely revoked toolkit…
		expect(readStateFile(dir).toolkits?.gmail).toBeUndefined();
		// …but must not discard the connection that landed mid-refresh.
		expect(readStateFile(dir).toolkits?.github).toBeTruthy();
		expect(
			status.integrations.find((entry) => entry.toolkit === "github")?.status,
		).toBe("connected");
	});

	it("re-fetches schemas for a connected toolkit stored with zero tools", async () => {
		const dir = useTempDataDir();
		process.env.COMPOSIO_API_KEY = "ck_self_heal";
		// A wedged connector: connected, same account still ACTIVE remotely,
		// but the schema fetch came back empty at connect time.
		writeState(dir, {
			apiKey: "ck_self_heal",
			userId: "u_self_heal",
			toolkits: {
				googlecalendar: {
					connectedAccountId: "ca_wedged",
					connectedAt: "2026-08-28T00:00:00.000Z",
					name: "Google Calendar",
					tools: [],
				},
			},
		});
		const client = {
			toolkits: { authorize: vi.fn() },
			authConfigs: {
				list: vi.fn(async () => ({ items: [] })),
				create: vi.fn(),
			},
			tools: {
				getRawComposioTools: vi.fn(async () => [
					{ slug: "GOOGLECALENDAR_CREATE_EVENT" },
					{ slug: "GOOGLECALENDAR_LIST_EVENTS" },
				]),
			},
			connectedAccounts: {
				list: vi.fn(async () => ({
					items: [
						{
							id: "ca_wedged",
							status: "ACTIVE",
							toolkit: { slug: "googlecalendar" },
						},
					],
				})),
				link: vi.fn(),
				delete: vi.fn(),
			},
		};
		createMockComposioClient = () => client;

		// Without a refresh, the wedge is at least visible on the card.
		const before = await getComposioStatus();
		expect(
			before.integrations.find((entry) => entry.toolkit === "googlecalendar")
				?.error,
		).toMatch(/no tools were retrieved/);

		const status = await getComposioStatus({ refresh: true });
		const healed = status.integrations.find(
			(entry) => entry.toolkit === "googlecalendar",
		);
		expect(healed?.status).toBe("connected");
		expect(healed?.toolNames).toEqual([
			"GOOGLECALENDAR_CREATE_EVENT",
			"GOOGLECALENDAR_LIST_EVENTS",
		]);
		expect(healed?.error).toBeUndefined();
		const persisted = readStateFile(dir).toolkits?.googlecalendar as {
			connectedAccountId?: string;
			connectedAt?: string;
			tools?: unknown[];
		};
		expect(persisted?.tools).toHaveLength(2);
		// The account did not change, so the connection metadata is kept.
		expect(persisted?.connectedAccountId).toBe("ca_wedged");
		expect(persisted?.connectedAt).toBe("2026-08-28T00:00:00.000Z");
	});

	it("follows account-list pagination so accounts on later pages are not treated as revoked", async () => {
		const dir = useTempDataDir();
		process.env.COMPOSIO_API_KEY = "ck_paginated";
		writeState(dir, {
			apiKey: "ck_paginated",
			userId: "u_paginated",
			toolkits: {
				github: {
					connectedAccountId: "ca_page1",
					connectedAt: "2026-08-28T00:00:00.000Z",
					tools: [{ slug: "GITHUB_CREATE_AN_ISSUE" }],
				},
				slack: {
					connectedAccountId: "ca_page2",
					connectedAt: "2026-08-28T00:00:00.000Z",
					tools: [{ slug: "SLACK_SEND_MESSAGE" }],
				},
			},
		});
		const list = vi.fn(async (query?: { cursor?: string }) =>
			query?.cursor === "page2"
				? {
						items: [
							{ id: "ca_page2", status: "ACTIVE", toolkit: { slug: "slack" } },
						],
						nextCursor: null,
					}
				: {
						items: [
							{ id: "ca_page1", status: "ACTIVE", toolkit: { slug: "github" } },
						],
						nextCursor: "page2",
					},
		);
		const client = {
			toolkits: { authorize: vi.fn() },
			authConfigs: {
				list: vi.fn(async () => ({ items: [] })),
				create: vi.fn(),
			},
			tools: { getRawComposioTools: vi.fn(async () => []) },
			connectedAccounts: { list, link: vi.fn(), delete: vi.fn() },
		};
		createMockComposioClient = () => client;
		const status = await getComposioStatus({ refresh: true });
		// The slack account lives on page 2; a first-page-only listing would
		// have removed it locally as "revoked remotely".
		expect(
			status.integrations.find((entry) => entry.toolkit === "slack")?.status,
		).toBe("connected");
		expect(
			status.integrations.find((entry) => entry.toolkit === "github")?.status,
		).toBe("connected");
		expect(list).toHaveBeenCalledTimes(2);
		expect(list.mock.calls[1]?.[0]).toMatchObject({ cursor: "page2" });
		expect(readStateFile(dir).toolkits?.slack?.connectedAccountId).toBe(
			"ca_page2",
		);
	});

	it("reconciliation prunes a tombstone after a confirmed retry revocation", async () => {
		const dir = useTempDataDir();
		process.env.COMPOSIO_API_KEY = "ck_refresh_prune";
		writeState(dir, {
			apiKey: "ck_refresh_prune",
			userId: "u_refresh_prune",
			toolkits: {},
			cancelledAccountIds: ["ca_zombie"],
		});
		const remoteDelete = vi.fn(async () => ({}));
		const client = {
			toolkits: { authorize: vi.fn() },
			authConfigs: {
				list: vi.fn(async () => ({ items: [] })),
				create: vi.fn(),
			},
			tools: { getRawComposioTools: vi.fn(async () => []) },
			connectedAccounts: {
				list: vi.fn(async () => ({
					items: [
						{ id: "ca_zombie", status: "ACTIVE", toolkit: { slug: "gmail" } },
					],
				})),
				link: vi.fn(),
				delete: remoteDelete,
			},
		};
		createMockComposioClient = () => client;
		const status = await getComposioStatus({ refresh: true });
		expect(
			status.integrations.find((entry) => entry.toolkit === "gmail")?.status,
		).toBe("not_connected");
		expect(remoteDelete).toHaveBeenCalledWith("ca_zombie", {
			revoke_on_delete: true,
		});
		expect(readStateFile(dir).cancelledAccountIds).toBeUndefined();
	});

	it("a rejected OAuth wait abandons the attempt so a late browser completion is never imported", async () => {
		const dir = useTempDataDir();
		process.env.COMPOSIO_API_KEY = "ck_wait_fail";
		writeState(dir, {
			apiKey: "ck_wait_fail",
			userId: "u_wait_fail",
			toolkits: {},
		});
		let rejectWait: ((error: Error) => void) | undefined;
		const remoteDelete = vi.fn(async () => {
			// Revocation fails too, so only the tombstone protects.
			throw new Error("500 internal error");
		});
		const client = {
			toolkits: {
				authorize: vi.fn(async () => ({
					id: "ca_timed_out",
					redirectUrl: "https://connect.example/ca_timed_out",
					waitForConnection: () =>
						new Promise((_resolve, reject) => {
							rejectWait = reject;
						}),
				})),
			},
			authConfigs: {
				list: vi.fn(async () => ({ items: [] })),
				create: vi.fn(),
			},
			tools: { getRawComposioTools: vi.fn(async () => []) },
			connectedAccounts: {
				list: vi.fn(async () => ({
					items: [
						{
							id: "ca_timed_out",
							status: "ACTIVE",
							toolkit: { slug: "github" },
						},
					],
				})),
				link: vi.fn(),
				delete: remoteDelete,
			},
		};
		createMockComposioClient = () => client;
		await connectComposioToolkit("github");
		// The wait times out / errors before the browser flow completes.
		rejectWait?.(new Error("wait timed out"));
		await vi.waitFor(() => {
			expect(remoteDelete).toHaveBeenCalledWith("ca_timed_out", {
				revoke_on_delete: true,
			});
		});
		expect(readStateFile(dir).cancelledAccountIds).toContain("ca_timed_out");
		// The user completes the still-open browser tab afterwards; a refresh
		// sees the account ACTIVE but must not import it.
		const status = await getComposioStatus({ refresh: true });
		expect(
			status.integrations.find((entry) => entry.toolkit === "github")?.status,
		).toBe("not_connected");
		expect(readStateFile(dir).toolkits).toEqual({});
	});

	it("a failed redirect-less finalize abandons its freshly authorized account", async () => {
		const dir = useTempDataDir();
		process.env.COMPOSIO_API_KEY = "ck_finalize_fail";
		writeState(dir, {
			apiKey: "ck_finalize_fail",
			userId: "u_finalize_fail",
			toolkits: {},
		});
		const remoteDelete = vi.fn(async () => ({}));
		const client = {
			toolkits: {
				authorize: vi.fn(async () => ({
					id: "ca_fetch_broke",
					redirectUrl: null,
					waitForConnection: async () => ({}),
				})),
			},
			authConfigs: {
				list: vi.fn(async () => ({ items: [] })),
				create: vi.fn(),
			},
			tools: {
				getRawComposioTools: vi.fn(async () => {
					throw new Error("500 tools endpoint exploded");
				}),
			},
			connectedAccounts: {
				list: vi.fn(async () => ({ items: [] })),
				link: vi.fn(),
				delete: remoteDelete,
			},
		};
		createMockComposioClient = () => client;
		await expect(connectComposioToolkit("github")).rejects.toThrow(
			/tools endpoint exploded/,
		);
		// The account was authorized remotely; it must be revoked rather than
		// left for reconciliation to import as an installed connector.
		expect(remoteDelete).toHaveBeenCalledWith("ca_fetch_broke", {
			revoke_on_delete: true,
		});
		// Revocation succeeded, so the tombstone was pruned again.
		expect(readStateFile(dir).cancelledAccountIds).toBeUndefined();
		expect(readStateFile(dir).toolkits ?? {}).toEqual({});
	});

	it("a cancelled toolkit can still be reconnected under a fresh account", async () => {
		const dir = useTempDataDir();
		process.env.COMPOSIO_API_KEY = "ck_reconnect";
		writeState(dir, {
			apiKey: "ck_reconnect",
			userId: "u_reconnect",
			toolkits: {},
			// A previously cancelled attempt; it must not block new attempts.
			cancelledAccountIds: ["ca_old_attempt"],
		});
		const client = {
			toolkits: {
				authorize: vi.fn(async () => ({
					id: "ca_fresh",
					redirectUrl: "https://connect.example/ca_fresh",
					waitForConnection: async () => ({}),
				})),
			},
			authConfigs: {
				list: vi.fn(async () => ({ items: [] })),
				create: vi.fn(),
			},
			tools: {
				getRawComposioTools: vi.fn(async () => [{ slug: "GMAIL_SEND_EMAIL" }]),
			},
			connectedAccounts: {
				list: vi.fn(async () => ({ items: [] })),
				link: vi.fn(),
				delete: vi.fn(async () => ({})),
			},
		};
		createMockComposioClient = () => client;
		await connectComposioToolkit("gmail");
		await vi.waitFor(() => {
			expect(readStateFile(dir).toolkits?.gmail).toBeTruthy();
		});
		const status = await getComposioStatus();
		expect(
			status.integrations.find((entry) => entry.toolkit === "gmail")?.status,
		).toBe("connected");
	});
});

describe("disconnectComposioToolkit", () => {
	const storedGithubState = (apiKey: string) => ({
		apiKey,
		userId: "u_disconnect",
		toolkits: {
			github: {
				connectedAccountId: "ca_github",
				connectedAt: "2026-08-28T00:00:00.000Z",
				tools: [{ slug: "GITHUB_CREATE_AN_ISSUE" }],
			},
		},
	});

	function clientWithDelete(remoteDelete: ReturnType<typeof vi.fn>) {
		return {
			toolkits: { authorize: vi.fn() },
			authConfigs: {
				list: vi.fn(async () => ({ items: [] })),
				create: vi.fn(),
			},
			tools: { getRawComposioTools: vi.fn(async () => []) },
			connectedAccounts: {
				list: vi.fn(async () => ({ items: [] })),
				link: vi.fn(),
				delete: remoteDelete,
			},
		};
	}

	it("keeps the connector installed and surfaces the failure when remote revocation fails", async () => {
		const dir = useTempDataDir();
		process.env.COMPOSIO_API_KEY = "ck_revoke_fail";
		writeState(dir, storedGithubState("ck_revoke_fail"));
		const remoteDelete = vi.fn(async () => {
			throw new Error('500 {"error":{"message":"internal error"}}');
		});
		createMockComposioClient = () => clientWithDelete(remoteDelete);
		await expect(disconnectComposioToolkit("github")).rejects.toThrow(
			/still connected/,
		);
		// The account is still authorized on Composio's side (and running Hub
		// sessions keep executing against it), so the local state must keep
		// reporting it as installed instead of claiming a clean uninstall.
		expect(readStateFile(dir).toolkits?.github).toBeTruthy();
		const status = await getComposioStatus();
		expect(
			status.integrations.find((entry) => entry.toolkit === "github")?.status,
		).toBe("connected");
	});

	it("does not treat a non-404 failure mentioning 'not found' as a successful revocation", async () => {
		const dir = useTempDataDir();
		process.env.COMPOSIO_API_KEY = "ck_misclassify";
		writeState(dir, storedGithubState("ck_misclassify"));
		const remoteDelete = vi.fn(async () => {
			// A 500 whose body happens to contain "not found" must NOT count
			// as the account being gone.
			throw new Error(
				'500 {"error":{"message":"backend dependency not found"}}',
			);
		});
		createMockComposioClient = () => clientWithDelete(remoteDelete);
		await expect(disconnectComposioToolkit("github")).rejects.toThrow(
			/still connected/,
		);
		expect(readStateFile(dir).toolkits?.github).toBeTruthy();
	});

	it("a disconnect in flight does not clobber a tombstone written by a concurrent cancel", async () => {
		const dir = useTempDataDir();
		process.env.COMPOSIO_API_KEY = "ck_write_race";
		writeState(dir, {
			apiKey: "ck_write_race",
			userId: "u_write_race",
			toolkits: {
				slack: {
					connectedAccountId: "ca_slack",
					connectedAt: "2026-08-28T00:00:00.000Z",
					tools: [{ slug: "SLACK_SEND_MESSAGE" }],
				},
			},
		});
		let releaseSlackDelete: (() => void) | undefined;
		const remoteDelete = vi.fn((accountId: string) => {
			if (accountId === "ca_slack") {
				return new Promise((resolve) => {
					releaseSlackDelete = () => resolve({});
				});
			}
			// The cancelled attempt's revocation fails, so its tombstone must
			// stay unconfirmed (and persisted).
			return Promise.reject(new Error("500 internal error"));
		});
		const client = {
			toolkits: {
				authorize: vi.fn(async () => ({
					id: "ca_github_pending",
					redirectUrl: "https://connect.example/ca_github_pending",
					waitForConnection: () => new Promise(() => {}),
				})),
			},
			authConfigs: {
				list: vi.fn(async () => ({ items: [] })),
				create: vi.fn(),
			},
			tools: { getRawComposioTools: vi.fn(async () => []) },
			connectedAccounts: {
				list: vi.fn(async () => ({ items: [] })),
				link: vi.fn(),
				delete: remoteDelete,
			},
		};
		createMockComposioClient = () => client;
		const disconnectPromise = disconnectComposioToolkit("slack");
		await vi.waitFor(() => {
			expect(remoteDelete).toHaveBeenCalledWith("ca_slack", {
				revoke_on_delete: true,
			});
		});
		// While the disconnect is suspended on the remote delete, a cancel for
		// a different toolkit persists a tombstone.
		await connectComposioToolkit("github");
		await cancelComposioConnect("github");
		expect(readStateFile(dir).cancelledAccountIds).toContain(
			"ca_github_pending",
		);
		releaseSlackDelete?.();
		await disconnectPromise;
		// The disconnect's completion must not erase the concurrent tombstone.
		expect(readStateFile(dir).cancelledAccountIds).toContain(
			"ca_github_pending",
		);
		expect(readStateFile(dir).toolkits?.slack).toBeUndefined();
	});

	it("a disconnect during a redirect-less connect wins: the finalize result is dropped and its account revoked", async () => {
		const dir = useTempDataDir();
		process.env.COMPOSIO_API_KEY = "ck_relink_race";
		writeState(dir, {
			apiKey: "ck_relink_race",
			userId: "u_relink_race",
			toolkits: {
				github: {
					connectedAccountId: "ca_old",
					connectedAt: "2026-08-28T00:00:00.000Z",
					tools: [{ slug: "GITHUB_CREATE_AN_ISSUE" }],
				},
			},
		});
		let releaseToolFetch: (() => void) | undefined;
		const remoteDelete = vi.fn(async () => ({}));
		const client = {
			toolkits: {
				// Redirect-less: Composio reports the account as already
				// authorized, so finalize starts immediately with no pending
				// entry for a disconnect to clear.
				authorize: vi.fn(async () => ({
					id: "ca_relink",
					redirectUrl: null,
					waitForConnection: async () => ({}),
				})),
			},
			authConfigs: {
				list: vi.fn(async () => ({ items: [] })),
				create: vi.fn(),
			},
			tools: {
				getRawComposioTools: vi.fn(
					() =>
						new Promise<{ slug: string }[]>((resolve) => {
							releaseToolFetch = () =>
								resolve([{ slug: "GITHUB_CREATE_AN_ISSUE" }]);
						}),
				),
			},
			connectedAccounts: {
				list: vi.fn(async () => ({ items: [] })),
				link: vi.fn(),
				delete: remoteDelete,
			},
		};
		createMockComposioClient = () => client;
		const connectPromise = connectComposioToolkit("github");
		await vi.waitFor(() => {
			expect(client.tools.getRawComposioTools).toHaveBeenCalled();
		});
		// While finalize is suspended on the tool fetch, the user disconnects —
		// and is told the disconnect succeeded.
		const disconnected = await disconnectComposioToolkit("github");
		expect(
			disconnected.integrations.find((entry) => entry.toolkit === "github")
				?.status,
		).toBe("not_connected");
		releaseToolFetch?.();
		const connectResult = await connectPromise;
		// A dropped result must not claim success on the wire either.
		expect(connectResult.alreadyConnected).toBeUndefined();
		expect(
			connectResult.status.integrations.find(
				(entry) => entry.toolkit === "github",
			)?.status,
		).toBe("not_connected");
		// The finalize result must not resurrect the connector…
		expect(readStateFile(dir).toolkits?.github).toBeUndefined();
		const status = await getComposioStatus();
		expect(
			status.integrations.find((entry) => entry.toolkit === "github")?.status,
		).toBe("not_connected");
		// …and the orphaned account is revoked (old account by the disconnect,
		// new account by the dropped finalize), with its tombstone pruned once
		// the revocation is confirmed.
		expect(remoteDelete).toHaveBeenCalledWith("ca_old", {
			revoke_on_delete: true,
		});
		expect(remoteDelete).toHaveBeenCalledWith("ca_relink", {
			revoke_on_delete: true,
		});
		expect(readStateFile(dir).cancelledAccountIds).toBeUndefined();
	});

	it("a disconnect completing during connection initiation also wins over redirect-less finalization", async () => {
		const dir = useTempDataDir();
		process.env.COMPOSIO_API_KEY = "ck_init_race";
		writeState(dir, {
			apiKey: "ck_init_race",
			userId: "u_init_race",
			toolkits: {
				github: {
					connectedAccountId: "ca_old_init",
					connectedAt: "2026-08-28T00:00:00.000Z",
					tools: [{ slug: "GITHUB_CREATE_AN_ISSUE" }],
				},
			},
		});
		let releaseAuthorize: (() => void) | undefined;
		const remoteDelete = vi.fn(async () => ({}));
		const client = {
			toolkits: {
				// The disconnect runs entirely inside this authorize round trip,
				// so its marker lands BEFORE the initiation completes.
				authorize: vi.fn(
					() =>
						new Promise<{
							id: string;
							redirectUrl: null;
							waitForConnection: () => Promise<unknown>;
						}>((resolve) => {
							releaseAuthorize = () =>
								resolve({
									id: "ca_new_init",
									redirectUrl: null,
									waitForConnection: async () => ({}),
								});
						}),
				),
			},
			authConfigs: {
				list: vi.fn(async () => ({ items: [] })),
				create: vi.fn(),
			},
			tools: {
				getRawComposioTools: vi.fn(async () => [
					{ slug: "GITHUB_CREATE_AN_ISSUE" },
				]),
			},
			connectedAccounts: {
				list: vi.fn(async () => ({ items: [] })),
				link: vi.fn(),
				delete: remoteDelete,
			},
		};
		createMockComposioClient = () => client;
		const connectPromise = connectComposioToolkit("github");
		await vi.waitFor(() => {
			expect(client.toolkits.authorize).toHaveBeenCalled();
		});
		const disconnected = await disconnectComposioToolkit("github");
		expect(
			disconnected.integrations.find((entry) => entry.toolkit === "github")
				?.status,
		).toBe("not_connected");
		releaseAuthorize?.();
		const connectResult = await connectPromise;
		expect(connectResult.alreadyConnected).toBeUndefined();
		expect(readStateFile(dir).toolkits?.github).toBeUndefined();
		expect(remoteDelete).toHaveBeenCalledWith("ca_new_init", {
			revoke_on_delete: true,
		});
	});

	it("a reconnect that finalizes during the disconnect's remote revocation survives", async () => {
		const dir = useTempDataDir();
		process.env.COMPOSIO_API_KEY = "ck_reconnect_race";
		writeState(dir, {
			apiKey: "ck_reconnect_race",
			userId: "u_reconnect_race",
			toolkits: {
				github: {
					connectedAccountId: "ca_old_acct",
					connectedAt: "2026-08-28T00:00:00.000Z",
					tools: [{ slug: "GITHUB_CREATE_AN_ISSUE" }],
				},
			},
		});
		let releaseOldDelete: (() => void) | undefined;
		const remoteDelete = vi.fn((accountId: string) => {
			if (accountId === "ca_old_acct") {
				return new Promise((resolve) => {
					releaseOldDelete = () => resolve({});
				});
			}
			return Promise.resolve({});
		});
		const client = {
			toolkits: {
				// Redirect-less reconnect: finalizes without a pending entry.
				authorize: vi.fn(async () => ({
					id: "ca_new_acct",
					redirectUrl: null,
					waitForConnection: async () => ({}),
				})),
			},
			authConfigs: {
				list: vi.fn(async () => ({ items: [] })),
				create: vi.fn(),
			},
			tools: {
				getRawComposioTools: vi.fn(async () => [
					{ slug: "GITHUB_CREATE_AN_ISSUE" },
				]),
			},
			connectedAccounts: {
				list: vi.fn(async () => ({
					items: [
						{
							id: "ca_new_acct",
							status: "ACTIVE",
							toolkit: { slug: "github" },
						},
					],
					nextCursor: null,
				})),
				link: vi.fn(),
				delete: remoteDelete,
			},
		};
		createMockComposioClient = () => client;
		const disconnectPromise = disconnectComposioToolkit("github");
		await vi.waitFor(() => {
			expect(remoteDelete).toHaveBeenCalledWith("ca_old_acct", {
				revoke_on_delete: true,
			});
		});
		// While the disconnect awaits the old account's revocation, the user
		// reconnects and the redirect-less finalize completes.
		const reconnect = await connectComposioToolkit("github");
		expect(reconnect.alreadyConnected).toBe(true);
		expect(readStateFile(dir).toolkits?.github?.connectedAccountId).toBe(
			"ca_new_acct",
		);
		releaseOldDelete?.();
		const disconnected = await disconnectPromise;
		// The disconnect only revoked ca_old_acct; blindly deleting the slot
		// would orphan ca_new_acct (authorized remotely, no local record) for
		// the next refresh to import as a resurrection. The newer reconnect
		// must survive instead.
		expect(readStateFile(dir).toolkits?.github?.connectedAccountId).toBe(
			"ca_new_acct",
		);
		expect(
			disconnected.integrations.find((entry) => entry.toolkit === "github")
				?.status,
		).toBe("connected");
		expect(remoteDelete).toHaveBeenCalledTimes(1);
		// And a later refresh keeps it, rather than re-importing an orphan.
		const refreshed = await getComposioStatus({ refresh: true });
		expect(
			refreshed.integrations.find((entry) => entry.toolkit === "github")
				?.status,
		).toBe("connected");
		expect(readStateFile(dir).toolkits?.github?.connectedAccountId).toBe(
			"ca_new_acct",
		);
	});

	it("treats an account that is already gone remotely as revoked", async () => {
		const dir = useTempDataDir();
		process.env.COMPOSIO_API_KEY = "ck_gone_404";
		writeState(dir, storedGithubState("ck_gone_404"));
		const remoteDelete = vi.fn(async () => {
			throw new Error(
				'404 {"error":{"message":"Connected account not found"}}',
			);
		});
		createMockComposioClient = () => clientWithDelete(remoteDelete);
		const status = await disconnectComposioToolkit("github");
		expect(
			status.integrations.find((entry) => entry.toolkit === "github")?.status,
		).toBe("not_connected");
		expect(readStateFile(dir).toolkits).toEqual({});
	});
});
