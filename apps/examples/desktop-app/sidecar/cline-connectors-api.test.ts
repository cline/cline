import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Exercises `requestConnectorsApi`'s own parsing against the real backend's
 * observed envelope shapes: success as `{"data": ..., "success": true}`,
 * errors as `{"error": "..."}`. Mocks auth resolution and `fetch` directly —
 * one level below `composio.test.ts`, which mocks this module instead.
 */
const beta = vi.hoisted(() => ({ enabled: true }));
vi.mock("@cline/core", async () => ({
	...(await vi.importActual<typeof import("@cline/core")>("@cline/core")),
	isClineAccountFeatureEnabled: async () => beta.enabled,
}));

vi.mock("./cline-auth", () => ({
	resolveConnectorsApiAuth: vi.fn(async () => ({
		baseUrl: "https://core-api.staging.int.cline.bot",
		token: "test-token",
	})),
}));

import {
	type ConnectorsApiError,
	deleteConnection,
	fetchConnectableToolkits,
	listConnections,
} from "./cline-connectors-api";

const originalFetch = global.fetch;

function mockFetchOnce(status: number, body: string) {
	global.fetch = vi.fn(
		async () => new Response(body, { status }),
	) as unknown as typeof fetch;
}

beforeEach(() => {
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
					connections: [
						{ id: "c1", toolkit: { slug: "gmail" }, status: "ACTIVE" },
					],
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
			JSON.stringify({ data: { toolkits: [] }, success: true }),
		);
		const toolkits = await fetchConnectableToolkits();
		expect(toolkits).toEqual([]);
	});

	it("treats a response with no body as an empty success (e.g. DELETE)", async () => {
		mockFetchOnce(200, "");
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
		mockFetchOnce(200, "");
		await expect(deleteConnection("acct-1")).resolves.toBeUndefined();
		expect(global.fetch).toHaveBeenCalledOnce();
	});
});
