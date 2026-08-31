import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildConnectableCatalog,
	COMPOSIO_PLUGIN_SOURCE,
	cancelComposioConnect,
	connectComposioToolkit,
	disconnectComposioToolkit,
	getComposioStatus,
	initiateToolkitConnection,
	parseComposioToolkitSlug,
} from "./composio";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
// The generated plugin imports @cline/core, so the copy under test must live
// inside the workspace tree where node module resolution can find it.
const PLUGIN_TMP_ROOT = join(MODULE_DIR, ".vitest-composio-tmp");

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
			// biome-ignore lint/correctness/noConstructorReturn: returning an object from the constructor is how the mock substitutes the per-test client for `this`.
			return createMockComposioClient(options.apiKey) as object;
		}
	},
}));

type RegisteredTool = {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	retryable?: boolean;
	execute: (input: unknown, context?: unknown) => Promise<unknown>;
};

const originalDataDir = process.env.CLINE_DATA_DIR;
const originalClineDir = process.env.CLINE_DIR;
const originalEnvApiKey = process.env.COMPOSIO_API_KEY;
const cleanupPaths: string[] = [];

// Sandboxes both the state file (CLINE_DATA_DIR) and the plugin directory
// (CLINE_DIR), since env-key reconciliation can write the plugin file.
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

async function loadGeneratedPlugin(): Promise<{
	setup: (api: unknown, ctx?: unknown) => void | Promise<void>;
	name: string;
	manifest: { capabilities: string[] };
}> {
	mkdirSync(PLUGIN_TMP_ROOT, { recursive: true });
	cleanupPaths.push(PLUGIN_TMP_ROOT);
	// Unique file name per import: module caches are keyed by path.
	const pluginPath = join(
		PLUGIN_TMP_ROOT,
		`composio-tools-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`,
	);
	writeFileSync(pluginPath, COMPOSIO_PLUGIN_SOURCE);
	const module = (await import(pluginPath)) as {
		default: {
			setup: (api: unknown, ctx?: unknown) => void | Promise<void>;
			name: string;
			manifest: { capabilities: string[] };
		};
	};
	return module.default;
}

async function setupPluginTools(): Promise<RegisteredTool[]> {
	const plugin = await loadGeneratedPlugin();
	const tools: RegisteredTool[] = [];
	await plugin.setup({
		registerTool: (tool: RegisteredTool) => tools.push(tool),
	});
	return tools;
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
		// The plugin file as a connect would have materialized it.
		const pluginPath = join(dir, "plugins", "composio-tools.ts");
		mkdirSync(join(dir, "plugins"), { recursive: true });
		writeFileSync(pluginPath, COMPOSIO_PLUGIN_SOURCE);
		// The new key belongs to a different Composio project. Even with no
		// successful refresh afterwards, the old project's connectors must not
		// stay reported as installed under the new key — the plugin would
		// execute their tools against the wrong project.
		process.env.COMPOSIO_API_KEY = "ck_second";
		const rotated = await getComposioStatus();
		expect(rotated.configured).toBe(true);
		expect(
			rotated.integrations.find((entry) => entry.toolkit === "github")?.status,
		).toBe("not_connected");
		const persisted = readStateFile(dir);
		expect(persisted.apiKey).toBe("ck_second");
		expect(persisted.toolkits).toEqual({});
		expect(existsSync(pluginPath)).toBe(false);
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
		expect(existsSync(join(dir, "plugins", "composio-tools.ts"))).toBe(false);
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

	it("plugin execute falls back to the Hub process env when the state file has no key", async () => {
		const dir = useTempDataDir();
		writeState(dir, {
			userId: "cline-desktop-env",
			toolkits: {
				github: {
					connectedAccountId: "ca_github",
					tools: [{ slug: "GITHUB_CREATE_AN_ISSUE" }],
				},
			},
		});
		process.env.COMPOSIO_API_KEY = "ck_hub_env";
		const fetchMock = vi.fn(
			async () =>
				new Response(JSON.stringify({ successful: true, data: {} }), {
					status: 200,
				}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const tools = await setupPluginTools();
		expect(tools).toHaveLength(1);
		await tools[0].execute({ title: "bug" });
		const [, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			{ headers: Record<string, string> },
		];
		expect(init.headers["x-api-key"]).toBe("ck_hub_env");
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
		expect(remoteDelete).toHaveBeenCalledWith("ca_cancelled");
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
		expect(remoteDelete).toHaveBeenCalledWith("ca_zombie");
		expect(readStateFile(dir).cancelledAccountIds).toBeUndefined();
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
			expect(remoteDelete).toHaveBeenCalledWith("ca_slack");
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

describe("generated composio plugin", () => {
	it("declares the tools capability and registers nothing when unconfigured", async () => {
		useTempDataDir();
		const plugin = await loadGeneratedPlugin();
		expect(plugin.name).toBe("composio-tools");
		expect(plugin.manifest.capabilities).toEqual(["tools"]);
		const tools: RegisteredTool[] = [];
		await plugin.setup({
			registerTool: (tool: RegisteredTool) => tools.push(tool),
		});
		expect(tools).toHaveLength(0);
	});

	it("registers one snake_case tool per stored tool schema", async () => {
		const dataDir = useTempDataDir();
		writeState(dataDir, {
			apiKey: "ck_test",
			userId: "cline-desktop-test",
			toolkits: {
				gmail: {
					connectedAccountId: "ca_gmail",
					tools: [
						{
							slug: "GMAIL_SEND_EMAIL",
							description: "Send an email.",
							version: "20250101_00",
							inputParameters: {
								type: "object",
								properties: { to: { type: "string" } },
								required: ["to"],
							},
						},
						{ slug: "GMAIL_FETCH_EMAILS" },
					],
				},
				github: {
					connectedAccountId: "ca_github",
					tools: [{ slug: "GITHUB_CREATE_AN_ISSUE" }],
				},
			},
		});
		const tools = await setupPluginTools();
		expect(tools.map((tool) => tool.name).sort()).toEqual([
			"github_create_an_issue",
			"gmail_fetch_emails",
			"gmail_send_email",
		]);
		const sendEmail = tools.find((tool) => tool.name === "gmail_send_email");
		expect(sendEmail?.description).toContain("Send an email.");
		expect(sendEmail?.inputSchema).toMatchObject({
			type: "object",
			required: ["to"],
		});
		expect(sendEmail?.retryable).toBe(false);
	});

	it("executes tools against the Composio REST API with the pinned version", async () => {
		const dataDir = useTempDataDir();
		writeState(dataDir, {
			apiKey: "ck_test",
			userId: "cline-desktop-test",
			toolkits: {
				gmail: {
					connectedAccountId: "ca_gmail",
					tools: [{ slug: "GMAIL_SEND_EMAIL", version: "20250101_00" }],
				},
			},
		});
		const fetchMock = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						successful: true,
						data: { messageId: "msg_1" },
						error: null,
					}),
					{ status: 200 },
				),
		);
		vi.stubGlobal("fetch", fetchMock);

		const tools = await setupPluginTools();
		const result = await tools[0].execute({
			to: "someone@example.com",
			subject: "hi",
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			{ method: string; headers: Record<string, string>; body: string },
		];
		expect(url).toBe(
			"https://backend.composio.dev/api/v3.1/tools/execute/GMAIL_SEND_EMAIL",
		);
		expect(init.method).toBe("POST");
		expect(init.headers["x-api-key"]).toBe("ck_test");
		expect(JSON.parse(init.body)).toEqual({
			user_id: "cline-desktop-test",
			arguments: { to: "someone@example.com", subject: "hi" },
			version: "20250101_00",
		});
		expect(result).toEqual({
			successful: true,
			data: { messageId: "msg_1" },
			error: null,
		});
	});

	it("returns structured errors instead of throwing on HTTP failures", async () => {
		const dataDir = useTempDataDir();
		writeState(dataDir, {
			apiKey: "ck_test",
			userId: "cline-desktop-test",
			toolkits: {
				github: {
					connectedAccountId: "ca_github",
					tools: [{ slug: "GITHUB_CREATE_AN_ISSUE" }],
				},
			},
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ error: "connection expired" }), {
						status: 401,
					}),
			),
		);

		const tools = await setupPluginTools();
		const result = (await tools[0].execute({ title: "bug" })) as {
			successful: boolean;
			error: string;
		};
		expect(result.successful).toBe(false);
		expect(result.error).toContain("HTTP 401");
		expect(result.error).toContain("GITHUB_CREATE_AN_ISSUE");
	});

	it("returns structured errors when the network is unreachable", async () => {
		const dataDir = useTempDataDir();
		writeState(dataDir, {
			apiKey: "ck_test",
			userId: "cline-desktop-test",
			toolkits: {
				gmail: {
					connectedAccountId: "ca_gmail",
					tools: [{ slug: "GMAIL_FETCH_EMAILS" }],
				},
			},
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("network down");
			}),
		);

		const tools = await setupPluginTools();
		const result = (await tools[0].execute({})) as {
			successful: boolean;
			error: string;
		};
		expect(result.successful).toBe(false);
		expect(result.error).toContain("network down");
	});
});
