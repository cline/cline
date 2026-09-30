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
vi.mock("../feature-flags/cline-account-feature-flags", async () => ({
	...(await vi.importActual<
		typeof import("../feature-flags/cline-account-feature-flags")
	>("../feature-flags/cline-account-feature-flags")),
	isClineAccountFeatureEnabled: vi.fn(async () => beta.enabled),
}));

vi.mock("./cline-auth", () => ({
	getClineAccountId: () => identity.accountId,
	resolveConnectorsApiAuth: vi.fn(async () => ({
		accountId: identity.accountId,
		baseUrl: "https://core-api.staging.int.cline.bot",
		token: "test-token",
	})),
}));

import { isClineAccountFeatureEnabled } from "../feature-flags/cline-account-feature-flags";
import { resolveConnectorsApiAuth } from "./cline-auth";
import {
	type ConnectorsApiError,
	type ConnectorsRequest,
	deleteConnection,
	executeConnectorTool,
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

describe("host-supplied connector requests", () => {
	beforeEach(() => {
		identity.accountId = undefined;
		beta.enabled = false;
		global.fetch = vi.fn() as unknown as typeof fetch;
	});

	it("still requires the saved login when no host request is supplied", async () => {
		await expect(listConnections()).rejects.toMatchObject({ status: 401 });
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it("discovers all pages using the host without consulting a desktop login or flag", async () => {
		const account = {
			id: "cloud-account",
			toolkit: { slug: "gmail" },
			status: "ACTIVE",
		};
		const request = vi
			.fn<ConnectorsRequest>()
			.mockResolvedValueOnce(
				Response.json({
					success: true,
					data: { items: [], nextToken: "next/+=" },
				}),
			)
			.mockResolvedValueOnce(
				Response.json({
					success: true,
					data: { items: [account], nextToken: "" },
				}),
			);
		expect(await listConnections({ request })).toEqual([account]);
		expect(request.mock.calls.map(([path]) => path)).toEqual([
			"/api/v1/connectors/connections?limit=200",
			"/api/v1/connectors/connections?limit=200&cursor=next%2F%2B%3D",
		]);
		expect(request.mock.calls[0][1]).toEqual({ method: "GET", headers: {} });
		expect(resolveConnectorsApiAuth).not.toHaveBeenCalled();
		expect(isClineAccountFeatureEnabled).not.toHaveBeenCalled();
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it("uses the supplied request for catalog, schemas, create and delete", async () => {
		const request = vi
			.fn<ConnectorsRequest>()
			.mockResolvedValueOnce(
				Response.json({
					success: true,
					data: { items: [{ slug: "gmail", name: "Gmail" }], nextToken: "" },
				}),
			)
			.mockResolvedValueOnce(
				Response.json({
					success: true,
					data: {
						items: [{ slug: "GMAIL_FETCH_EMAILS", version: "v1" }],
						nextToken: "",
					},
				}),
			)
			.mockResolvedValueOnce(
				Response.json({ success: true, data: { connectedAccountId: "c1" } }),
			)
			.mockResolvedValueOnce(new Response(null, { status: 204 }));
		const ctx = { request };
		expect(await fetchConnectableToolkits(ctx)).toEqual([
			{ slug: "gmail", name: "Gmail" },
		]);
		expect(await listToolkitTools("gmail", ctx)).toEqual([
			{ slug: "GMAIL_FETCH_EMAILS", version: "v1" },
		]);
		expect(await initiateConnection("gmail", ctx)).toEqual({
			connectedAccountId: "c1",
		});
		await deleteConnection("c/1", ctx);
		expect(request.mock.calls.map(([path]) => path)).toEqual([
			"/api/v1/connectors/toolkits?limit=200",
			"/api/v1/connectors/toolkits/gmail/tools?limit=200",
			"/api/v1/connectors/connections",
			"/api/v1/connectors/connections/c%2F1",
		]);
		expect(JSON.parse(request.mock.calls[2][1].body as string)).toEqual({
			toolkit: "gmail",
		});
	});

	it.each([
		401, 403,
	])("preserves backend HTTP %i without falling back to a desktop login", async (status) => {
		const request = vi
			.fn<ConnectorsRequest>()
			.mockResolvedValue(Response.json({ error: "access denied" }, { status }));
		await expect(listConnections({ request })).rejects.toMatchObject({
			status,
			message: "access denied",
		});
		expect(request).toHaveBeenCalledOnce();
		expect(resolveConnectorsApiAuth).not.toHaveBeenCalled();
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it("executes with the host request and preserves the raw provider body and version", async () => {
		const result = { success: true, data: { messages: [] } };
		const request = vi
			.fn<ConnectorsRequest>()
			.mockResolvedValue(Response.json(result));
		expect(
			await executeConnectorTool(
				{ slug: "GMAIL_FETCH_EMAILS", version: "v1" },
				{ max_results: 1 },
				{ request },
			),
		).toEqual(result);
		expect(request).toHaveBeenCalledWith(
			"/api/v1/connectors/tools/GMAIL_FETCH_EMAILS/execute",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ arguments: { max_results: 1 }, version: "v1" }),
			},
		);
		expect(resolveConnectorsApiAuth).not.toHaveBeenCalled();
	});

	it("returns execution errors without retrying or falling back to local credentials", async () => {
		const request = vi
			.fn<ConnectorsRequest>()
			.mockResolvedValue(
				Response.json({ error: "access denied" }, { status: 403 }),
			);
		expect(
			await executeConnectorTool(
				{ slug: "GMAIL_FETCH_EMAILS" },
				{},
				{ request },
			),
		).toMatchObject({
			successful: false,
			error: expect.stringContaining("HTTP 403"),
		});
		expect(request).toHaveBeenCalledOnce();
		expect(resolveConnectorsApiAuth).not.toHaveBeenCalled();
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it("does not share host transports between simultaneous users", async () => {
		const ctx = (id: string) => ({
			request: vi.fn<ConnectorsRequest>().mockImplementation(async () =>
				Response.json({
					success: true,
					data: { items: [{ id }], nextToken: "" },
				}),
			),
		});
		const a = ctx("user-a-connection");
		const b = ctx("user-b-connection");
		const results = await Promise.all([listConnections(a), listConnections(b)]);
		expect(results).toEqual([
			[{ id: "user-a-connection" }],
			[{ id: "user-b-connection" }],
		]);
		expect(a.request).toHaveBeenCalledOnce();
		expect(b.request).toHaveBeenCalledOnce();
	});
});
