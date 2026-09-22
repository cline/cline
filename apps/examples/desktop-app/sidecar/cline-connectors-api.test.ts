import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Exercises `requestConnectorsApi`'s own parsing against the real backend's
 * observed envelope shapes: success as `{"data": ..., "success": true}`,
 * errors as `{"error": "..."}`. Mocks auth resolution and `fetch` directly —
 * one level below `composio.test.ts`, which mocks this module instead.
 */
const identity = vi.hoisted(() => ({
	accountId: "account-a" as string | undefined,
}));
const beta = vi.hoisted(() => ({ enabled: true }));
vi.mock("@cline/core", async () => ({
	...(await vi.importActual<typeof import("@cline/core")>("@cline/core")),
	isClineAccountFeatureEnabled: async () => beta.enabled,
}));

vi.mock("./cline-auth", () => ({
	getClineAccountId: () => identity.accountId,
	resolveConnectorsApiAuth: vi.fn(async () => ({
		accountId: identity.accountId,
		baseUrl: "https://core-api.staging.int.cline.bot",
		token: "test-token",
	})),
}));

import {
	type ConnectorsApiError,
	deleteConnection,
	fetchConnectableToolkits,
	initiateConnection,
	listConnections,
	listToolkitTools,
	waitForConnectionActive,
} from "./cline-connectors-api";

const originalFetch = global.fetch;

function mockFetchOnce(status: number, body: string | null) {
	global.fetch = vi.fn(
		async () => new Response(body, { status }),
	) as unknown as typeof fetch;
}

beforeEach(() => {
	identity.accountId = "account-a";
	beta.enabled = true;
	vi.clearAllMocks();
});

afterEach(() => {
	global.fetch = originalFetch;
});

describe("requestConnectorsApi envelope handling", () => {
	it("unwraps a successful {data, success} envelope", async () => {
		mockFetchOnce(
			200,
			JSON.stringify({
				data: {
					items: [{ id: "c1", toolkit: { slug: "gmail" }, status: "ACTIVE" }],
					nextToken: "",
					total: 1,
				},
				success: true,
			}),
		);
		const connections = await listConnections();
		expect(connections).toEqual([
			{ id: "c1", toolkit: { slug: "gmail" }, status: "ACTIVE" },
		]);
	});

	it("unwraps an empty data payload", async () => {
		mockFetchOnce(
			200,
			JSON.stringify({
				data: { items: [], nextToken: "", total: 0 },
				success: true,
			}),
		);
		const toolkits = await fetchConnectableToolkits();
		expect(toolkits).toEqual([]);
	});

	it("treats a response with no body as an empty success (e.g. DELETE)", async () => {
		mockFetchOnce(204, null);
		await expect(deleteConnection("acct-1")).resolves.toBeUndefined();
	});

	it("surfaces the {error} envelope's message and status on failure", async () => {
		mockFetchOnce(
			401,
			JSON.stringify({
				error:
					"Unauthorized: Please make sure you're using the latest version of Cline and re-authenticate your Cline account.",
			}),
		);
		await expect(listConnections()).rejects.toMatchObject({
			message:
				"Unauthorized: Please make sure you're using the latest version of Cline and re-authenticate your Cline account.",
			status: 401,
		} satisfies Partial<ConnectorsApiError>);
	});
});

describe("Composio beta request gate", () => {
	it("blocks requests without the beta flag", async () => {
		beta.enabled = false;
		mockFetchOnce(200, "{}");
		await expect(listConnections()).rejects.toMatchObject({ status: 403 });
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it("allows revoking existing connections after beta access is removed", async () => {
		beta.enabled = false;
		mockFetchOnce(204, null);
		await expect(deleteConnection("acct-1")).resolves.toBeUndefined();
		expect(global.fetch).toHaveBeenCalledOnce();
	});
});

describe("connector router contract", () => {
	it("refuses to revoke an old account's connection with a newly signed-in account", async () => {
		identity.accountId = "account-b";
		mockFetchOnce(204, null);
		await expect(
			deleteConnection("a-connection", { accountId: "account-a" }),
		).rejects.toMatchObject({ status: 401 });
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it("does not combine connection pages from different accounts", async () => {
		global.fetch = vi.fn(async () => {
			identity.accountId = "account-b";
			return Response.json({
				success: true,
				data: { items: [], nextToken: "next", total: 0 },
			});
		}) as unknown as typeof fetch;
		await expect(listConnections()).rejects.toMatchObject({ status: 401 });
		expect(global.fetch).toHaveBeenCalledOnce();
	});
	const account = {
		id: "c1",
		toolkit: { slug: "gmail" },
		status: "ACTIVE",
		is_disabled: false,
	};

	function page(items: unknown[], nextToken = "") {
		return Response.json({
			success: true,
			data: { items, nextToken, total: items.length },
		});
	}

	it("loads every connection page using encoded cursors and bearer authentication", async () => {
		const second = { ...account, id: "c2" };
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(page([account], "next/+="))
			.mockResolvedValueOnce(page([second]));
		global.fetch = fetchMock as unknown as typeof fetch;
		expect(await listConnections()).toEqual([account, second]);
		expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
			"https://core-api.staging.int.cline.bot/api/v1/connectors/connections?limit=200",
			"https://core-api.staging.int.cline.bot/api/v1/connectors/connections?limit=200&cursor=next%2F%2B%3D",
		]);
		expect(fetchMock.mock.calls[0][1]).toMatchObject({
			method: "GET",
			headers: { authorization: "Bearer test-token" },
		});
	});

	it("rejects a failed later page instead of returning partial connection state", async () => {
		global.fetch = vi
			.fn()
			.mockResolvedValueOnce(page([account], "next"))
			.mockResolvedValueOnce(
				Response.json(
					{ success: false, error: "upstream failed" },
					{ status: 502 },
				),
			) as unknown as typeof fetch;
		await expect(listConnections()).rejects.toMatchObject({
			status: 502,
			message: "upstream failed",
		});
	});

	it.each([
		{ success: true, data: {} },
		{ success: true, data: { items: [], nextToken: null } },
		{ success: false, data: { items: [], nextToken: "" } },
		{ items: [], nextToken: "" },
	])("rejects malformed pages rather than interpreting them as revoked accounts: %j", async (body) => {
		mockFetchOnce(200, JSON.stringify(body));
		await expect(listConnections()).rejects.toThrow(/Invalid connectors/);
	});

	it("rejects cyclic pagination", async () => {
		global.fetch = vi.fn(async () =>
			page([account], "same"),
		) as unknown as typeof fetch;
		await expect(listConnections()).rejects.toThrow(/repeated cursor/);
		expect(global.fetch).toHaveBeenCalledTimes(2);
	});

	it("reads the catalog from a paginated response", async () => {
		const catalog = [{ slug: "gmail", name: "Gmail", toolsCount: 50 }];
		mockFetchOnce(
			200,
			JSON.stringify({
				success: true,
				data: { items: catalog, nextToken: "", total: 1 },
			}),
		);
		expect(await fetchConnectableToolkits()).toEqual(catalog);
		expect(global.fetch).toHaveBeenCalledWith(
			"https://core-api.staging.int.cline.bot/api/v1/connectors/toolkits?limit=200",
			expect.objectContaining({ method: "GET" }),
		);
	});

	it("loads uninstalled apps across all catalog pages, including empty filtered pages", async () => {
		const first = Array.from({ length: 200 }, (_, i) => ({
			slug: `app_${i}`,
			name: `App ${i}`,
		}));
		const last = [{ slug: "notion", name: "Notion" }];
		global.fetch = vi
			.fn()
			.mockResolvedValueOnce(page(first, "next"))
			.mockResolvedValueOnce(page([], "last"))
			.mockResolvedValueOnce(page(last)) as unknown as typeof fetch;
		expect(await fetchConnectableToolkits()).toEqual([...first, ...last]);
		expect(global.fetch).toHaveBeenNthCalledWith(
			3,
			"https://core-api.staging.int.cline.bot/api/v1/connectors/toolkits?limit=200&cursor=last",
			expect.objectContaining({ method: "GET" }),
		);
	});

	it("rejects a failed catalog page instead of presenting a partial catalog", async () => {
		global.fetch = vi
			.fn()
			.mockResolvedValueOnce(page([{ slug: "gmail", name: "Gmail" }], "next"))
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ error: "Catalog unavailable" }), {
					status: 502,
				}),
			) as unknown as typeof fetch;
		await expect(fetchConnectableToolkits()).rejects.toThrow(
			"Catalog unavailable",
		);
	});

	it("rejects cyclic catalog pagination", async () => {
		global.fetch = vi.fn(async () =>
			page([], "same"),
		) as unknown as typeof fetch;
		await expect(fetchConnectableToolkits()).rejects.toThrow(/repeated cursor/);
		expect(global.fetch).toHaveBeenCalledTimes(2);
	});

	it("accepts the toolkit page without a total", async () => {
		const toolkits = [
			{ slug: "github", name: "GitHub" },
			{ slug: "googlecalendar", name: "Google Calendar" },
		];
		mockFetchOnce(
			200,
			JSON.stringify({
				success: true,
				data: { items: toolkits, nextToken: "" },
			}),
		);
		expect(await fetchConnectableToolkits()).toEqual(toolkits);
	});

	it("initiates OAuth with only the toolkit in the request body", async () => {
		const result = {
			connectedAccountId: "c1",
			redirectUrl: "https://connect.example/c1",
		};
		mockFetchOnce(200, JSON.stringify({ success: true, data: result }));
		expect(await initiateConnection("gmail")).toEqual(result);
		expect(global.fetch).toHaveBeenCalledWith(
			"https://core-api.staging.int.cline.bot/api/v1/connectors/connections",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ toolkit: "gmail" }),
			}),
		);
	});

	it("loads all 47 schemas across pages and preserves input_parameters and version", async () => {
		const tools = Array.from({ length: 47 }, (_, i) => ({
			slug: `GOOGLECALENDAR_TOOL_${i}`,
			version: "v1",
			input_parameters: {
				type: "object",
				properties: { to: { type: "string" } },
				required: ["to"],
			},
		}));
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(page(tools.slice(0, 20), "next/+="))
			.mockResolvedValueOnce(page([], "last"))
			.mockResolvedValueOnce(page(tools.slice(20)));
		global.fetch = fetchMock as unknown as typeof fetch;
		expect(await listToolkitTools("googlecalendar")).toEqual(tools);
		expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
			"https://core-api.staging.int.cline.bot/api/v1/connectors/toolkits/googlecalendar/tools?limit=200",
			"https://core-api.staging.int.cline.bot/api/v1/connectors/toolkits/googlecalendar/tools?limit=200&cursor=next%2F%2B%3D",
			"https://core-api.staging.int.cline.bot/api/v1/connectors/toolkits/googlecalendar/tools?limit=200&cursor=last",
		]);
	});

	it("rejects a failed tool page instead of returning partial schemas", async () => {
		global.fetch = vi
			.fn()
			.mockResolvedValueOnce(page([{ slug: "GMAIL_SEND_EMAIL" }], "next"))
			.mockResolvedValueOnce(
				Response.json({ error: "Tools unavailable" }, { status: 502 }),
			) as unknown as typeof fetch;
		await expect(listToolkitTools("gmail")).rejects.toThrow(
			"Tools unavailable",
		);
	});

	it("rejects a malformed later tool page", async () => {
		global.fetch = vi
			.fn()
			.mockResolvedValueOnce(page([{ slug: "GMAIL_SEND_EMAIL" }], "next"))
			.mockResolvedValueOnce(
				Response.json({ success: true, data: { items: [] } }),
			) as unknown as typeof fetch;
		await expect(listToolkitTools("gmail")).rejects.toThrow(
			/Invalid connectors page/,
		);
	});

	it("rejects cyclic tool pagination", async () => {
		global.fetch = vi.fn(async () =>
			page([{ slug: "GMAIL_SEND_EMAIL" }], "same"),
		) as unknown as typeof fetch;
		await expect(listToolkitTools("gmail")).rejects.toThrow(/repeated cursor/);
		expect(global.fetch).toHaveBeenCalledTimes(2);
	});

	it("does not combine tool pages from different accounts", async () => {
		global.fetch = vi.fn(async () => {
			identity.accountId = "account-b";
			return page([{ slug: "GMAIL_SEND_EMAIL" }], "next");
		}) as unknown as typeof fetch;
		await expect(listToolkitTools("gmail")).rejects.toMatchObject({
			status: 401,
		});
		expect(global.fetch).toHaveBeenCalledOnce();
	});

	it("keeps polling while an ACTIVE connection is disabled", async () => {
		global.fetch = vi
			.fn()
			.mockResolvedValueOnce(page([{ ...account, is_disabled: true }]))
			.mockResolvedValueOnce(page([account])) as unknown as typeof fetch;
		await waitForConnectionActive("c1", {
			timeoutMs: 1_000,
			pollIntervalMs: 1,
		});
		expect(global.fetch).toHaveBeenCalledTimes(2);
	});

	it("deletes an encoded connection ID and accepts HTTP 204", async () => {
		mockFetchOnce(204, null);
		await deleteConnection("account/id");
		expect(global.fetch).toHaveBeenCalledWith(
			"https://core-api.staging.int.cline.bot/api/v1/connectors/connections/account%2Fid",
			expect.objectContaining({ method: "DELETE" }),
		);
	});
});
