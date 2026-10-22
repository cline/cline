import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createComposioMetaToolSession,
	executeComposioMetaTool,
} from "./composio-meta-tools";

const sessionTools = [
	{ slug: "COMPOSIO_SEARCH_TOOLS" },
	{ slug: "COMPOSIO_MANAGE_CONNECTIONS" },
	{ slug: "COMPOSIO_WAIT_FOR_CONNECTIONS" },
	{ slug: "COMPOSIO_MULTI_EXECUTE_TOOL" },
];

const request = (path: string, init: RequestInit) => fetch(path, init);

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("createComposioMetaToolSession", () => {
	it("returns the session id and tool schemas", async () => {
		const fetchMock = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						success: true,
						data: {
							sessionId: "trs_1",
							tools: [
								...sessionTools,
								{ slug: "COMPOSIO_SEARCH_TOOLS" },
								{ name: "no slug" },
								{ slug: "GMAIL_SEND_EMAIL" },
							],
						},
					}),
				),
		);
		vi.stubGlobal("fetch", fetchMock);

		expect(await createComposioMetaToolSession(request)).toEqual({
			sessionId: "trs_1",
			tools: sessionTools,
		});
		const [url, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(url).toBe("/api/v1/connectors/meta-tools/sessions");
		expect(init.method).toBe("POST");
	});

	it.each(
		sessionTools.map((tool) => tool.slug),
	)("rejects a session missing %s", async (missingSlug) => {
		vi.stubGlobal("fetch", async () =>
			Response.json({
				data: {
					sessionId: "trs_1",
					tools: sessionTools.filter((tool) => tool.slug !== missingSlug),
				},
			}),
		);
		const log = vi.fn();
		expect(
			await createComposioMetaToolSession(request, { log }),
		).toBeUndefined();
		expect(log).toHaveBeenCalledWith(expect.stringContaining(missingSlug));
	});

	it("rejects connection tools whose description requires unavailable search", async () => {
		vi.stubGlobal("fetch", async () =>
			Response.json({
				data: {
					sessionId: "trs_1",
					tools: [
						{
							slug: "COMPOSIO_MANAGE_CONNECTIONS",
							description:
								"First call COMPOSIO_SEARCH_TOOLS for the user's query.",
						},
						{ slug: "COMPOSIO_WAIT_FOR_CONNECTIONS" },
					],
				},
			}),
		);
		expect(await createComposioMetaToolSession(request)).toBeUndefined();
	});

	it("returns undefined without logging when there are no connectable toolkits", async () => {
		vi.stubGlobal("fetch", async () => new Response("{}", { status: 404 }));
		const log = vi.fn();
		expect(
			await createComposioMetaToolSession(request, { log }),
		).toBeUndefined();
		expect(log).not.toHaveBeenCalled();
	});

	it("returns undefined and logs on server and network errors", async () => {
		const log = vi.fn();
		vi.stubGlobal("fetch", async () => new Response("{}", { status: 502 }));
		expect(
			await createComposioMetaToolSession(request, { log }),
		).toBeUndefined();
		vi.stubGlobal("fetch", async () => {
			throw new Error("offline");
		});
		expect(
			await createComposioMetaToolSession(request, { log }),
		).toBeUndefined();
		expect(log).toHaveBeenCalledTimes(2);
	});

	it("returns undefined for a malformed body", async () => {
		vi.stubGlobal(
			"fetch",
			async () => new Response(JSON.stringify({ data: {} })),
		);
		expect(await createComposioMetaToolSession(request)).toBeUndefined();
	});

	it.each([
		"request",
		"body",
	])("times out a stalled %s when the host ignores cancellation", async (stage) => {
		vi.useFakeTimers();
		try {
			const pending = createComposioMetaToolSession(() =>
				stage === "request"
					? new Promise<Response>(() => {})
					: Promise.resolve(new Response(new ReadableStream())),
			);
			await vi.advanceTimersByTimeAsync(5_000);
			await expect(pending).resolves.toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("executeComposioMetaTool", () => {
	it("returns a structured error for a non-2xx response", async () => {
		vi.stubGlobal(
			"fetch",
			async () =>
				new Response(JSON.stringify({ error: "not found" }), { status: 404 }),
		);
		const result = await executeComposioMetaTool(
			request,
			"trs_1",
			"COMPOSIO_MANAGE_CONNECTIONS",
			{},
		);
		expect(result).toMatchObject({ successful: false });
		expect((result as { error: string }).error).toContain("HTTP 404");
	});
});
