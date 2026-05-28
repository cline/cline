import { describe, expect, it, vi } from "vitest";
import { createMaestroTools } from "./maestro";

/**
 * Build a typed `fetch` mock that records every call and returns canned
 * responses keyed by `${method} ${pathname}`.
 *
 * A response can be either a plain JSON-stringifiable object or a function
 * (request → body) for cases where the response depends on the request body.
 */
function makeFetchMock(
	routes: Record<
		string,
		unknown | ((req: { url: string; method: string; body: unknown }) => unknown)
	>,
) {
	type RecordedCall = { url: string; method: string; body: unknown };
	const calls: RecordedCall[] = [];
	const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input.toString();
		const method = (init?.method ?? "GET").toUpperCase();
		const body = init?.body ? JSON.parse(init.body as string) : undefined;
		calls.push({ url, method, body });

		const u = new URL(url);
		const key = `${method} ${u.pathname}`;
		if (!(key in routes)) {
			return new Response(`no route for ${key}`, { status: 404 });
		}
		const value = routes[key];
		const resolved =
			typeof value === "function" ? value({ url, method, body }) : value;
		return new Response(JSON.stringify(resolved), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}) as unknown as typeof fetch;
	return { fetchMock, calls };
}

const daemonUrl = "http://daemon.test:8765";

function getTool(tools: ReturnType<typeof createMaestroTools>, name: string) {
	const tool = tools.find((t) => t.name === name);
	if (!tool) throw new Error(`tool ${name} not found`);
	return tool;
}

// Minimal AgentToolContext stub. Every tool only reads context.signal so the
// rest of the fields can be left as default-ish placeholders.
// biome-ignore lint/suspicious/noExplicitAny: test-only stub
const ctx = () => ({ agentId: "test", iteration: 0 }) as any;

describe("createMaestroTools", () => {
	it("returns the full set of nine maestro tools", () => {
		const tools = createMaestroTools({ daemonUrl });
		const names = tools.map((t) => t.name);
		expect(names).toEqual([
			"maestro_list_sessions",
			"maestro_create_session",
			"maestro_destroy_session",
			"maestro_screenshot",
			"maestro_click",
			"maestro_type",
			"maestro_key",
			"maestro_scroll",
			"maestro_zoom",
		]);
	});

	it("normalises a trailing slash in daemonUrl so paths concatenate cleanly", async () => {
		const { fetchMock, calls } = makeFetchMock({
			"GET /sessions": [{ id: "abc" }],
		});
		const [list] = createMaestroTools({
			daemonUrl: `${daemonUrl}//`,
			fetch: fetchMock,
		});
		await list.execute({}, ctx());
		expect(calls[0].url).toBe(`${daemonUrl}/sessions`);
	});

	it("throws at construction if no fetch implementation is available", () => {
		// Simulate a runtime without a global `fetch` (e.g. very old Node).
		const originalFetch = globalThis.fetch;
		// biome-ignore lint/suspicious/noExplicitAny: stubbing for the test
		(globalThis as any).fetch = undefined;
		try {
			expect(() =>
				createMaestroTools({
					daemonUrl,
					fetch: undefined as unknown as typeof fetch,
				}),
			).toThrow(/no fetch implementation/i);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});

describe("maestro_list_sessions", () => {
	it("GETs /sessions and returns the parsed array", async () => {
		const { fetchMock, calls } = makeFetchMock({
			"GET /sessions": [
				{ id: "s1", label: "first", status: "running" },
				{ id: "s2", label: "second", status: "running" },
			],
		});
		const tool = getTool(
			createMaestroTools({ daemonUrl, fetch: fetchMock }),
			"maestro_list_sessions",
		);
		const result = await tool.execute({}, ctx());
		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe("GET");
		expect(calls[0].url).toBe(`${daemonUrl}/sessions`);
		expect(result).toEqual([
			{ id: "s1", label: "first", status: "running" },
			{ id: "s2", label: "second", status: "running" },
		]);
	});
});

describe("maestro_create_session", () => {
	it("POSTs /sessions with an empty body when no label is supplied", async () => {
		const { fetchMock, calls } = makeFetchMock({
			"POST /sessions": { id: "new-session-id" },
		});
		const tool = getTool(
			createMaestroTools({ daemonUrl, fetch: fetchMock }),
			"maestro_create_session",
		);
		const result = await tool.execute({}, ctx());
		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe("POST");
		expect(calls[0].body).toEqual({});
		expect(result).toEqual({ id: "new-session-id" });
	});

	it("forwards a non-empty label", async () => {
		const { fetchMock, calls } = makeFetchMock({
			"POST /sessions": (req: { body: unknown }) => ({
				id: "new-session-id",
				echoed: req.body,
			}),
		});
		const tool = getTool(
			createMaestroTools({ daemonUrl, fetch: fetchMock }),
			"maestro_create_session",
		);
		await tool.execute({ label: "browser" }, ctx());
		expect(calls[0].body).toEqual({ label: "browser" });
	});
});

describe("maestro_destroy_session", () => {
	it("DELETEs /sessions/:id and returns an ok marker", async () => {
		const { fetchMock, calls } = makeFetchMock({
			"DELETE /sessions/sess-1": {},
		});
		const tool = getTool(
			createMaestroTools({ daemonUrl, fetch: fetchMock }),
			"maestro_destroy_session",
		);
		const result = await tool.execute({ session_id: "sess-1" }, ctx());
		expect(calls[0].method).toBe("DELETE");
		expect(calls[0].url).toBe(`${daemonUrl}/sessions/sess-1`);
		expect(result).toEqual({ ok: true, session_id: "sess-1" });
	});
});

describe("maestro_screenshot", () => {
	it("POSTs an action and returns a multimodal [text, image] array", async () => {
		const { fetchMock, calls } = makeFetchMock({
			"POST /sessions/sess-1/action": { data: "BASE64IMAGEDATA" },
		});
		const tool = getTool(
			createMaestroTools({ daemonUrl, fetch: fetchMock }),
			"maestro_screenshot",
		);
		const result = await tool.execute({ session_id: "sess-1" }, ctx());
		expect(calls[0].body).toEqual({ action: "screenshot" });
		expect(result).toEqual([
			{ type: "text", text: "Screenshot of session sess-1." },
			{ type: "image", data: "BASE64IMAGEDATA", mediaType: "image/jpeg" },
		]);
	});

	it("falls back to a text-only result when the daemon returns no image data", async () => {
		const { fetchMock } = makeFetchMock({
			"POST /sessions/sess-1/action": { error: "no display" },
		});
		const tool = getTool(
			createMaestroTools({ daemonUrl, fetch: fetchMock }),
			"maestro_screenshot",
		);
		const result = (await tool.execute(
			{ session_id: "sess-1" },
			ctx(),
		)) as Array<{ type: string }>;
		expect(result).toHaveLength(1);
		expect(result[0].type).toBe("text");
	});
});

describe("maestro_click", () => {
	it("defaults to left_click", async () => {
		const { fetchMock, calls } = makeFetchMock({
			"POST /sessions/sess-1/action": {},
		});
		const tool = getTool(
			createMaestroTools({ daemonUrl, fetch: fetchMock }),
			"maestro_click",
		);
		await tool.execute({ session_id: "sess-1", x: 100, y: 200 }, ctx());
		expect(calls[0].body).toEqual({
			action: "left_click",
			x: 100,
			y: 200,
		});
	});

	it("maps button=right to right_click and button=middle to middle_click", async () => {
		const { fetchMock, calls } = makeFetchMock({
			"POST /sessions/sess-1/action": {},
		});
		const tool = getTool(
			createMaestroTools({ daemonUrl, fetch: fetchMock }),
			"maestro_click",
		);
		await tool.execute(
			{ session_id: "sess-1", x: 1, y: 2, button: "right" },
			ctx(),
		);
		await tool.execute(
			{ session_id: "sess-1", x: 3, y: 4, button: "middle" },
			ctx(),
		);
		expect(calls[0].body).toMatchObject({ action: "right_click" });
		expect(calls[1].body).toMatchObject({ action: "middle_click" });
	});
});

describe("maestro_type", () => {
	it("forwards the text payload to the action endpoint", async () => {
		const { fetchMock, calls } = makeFetchMock({
			"POST /sessions/sess-1/action": {},
		});
		const tool = getTool(
			createMaestroTools({ daemonUrl, fetch: fetchMock }),
			"maestro_type",
		);
		await tool.execute({ session_id: "sess-1", text: "hello" }, ctx());
		expect(calls[0].body).toEqual({ action: "type", text: "hello" });
	});
});

describe("maestro_key", () => {
	it("forwards xdotool key combos verbatim", async () => {
		const { fetchMock, calls } = makeFetchMock({
			"POST /sessions/sess-1/action": {},
		});
		const tool = getTool(
			createMaestroTools({ daemonUrl, fetch: fetchMock }),
			"maestro_key",
		);
		await tool.execute({ session_id: "sess-1", key: "ctrl+shift+t" }, ctx());
		expect(calls[0].body).toEqual({ action: "key", key: "ctrl+shift+t" });
	});
});

describe("maestro_scroll", () => {
	it("includes x, y, direction, and amount in the action payload", async () => {
		const { fetchMock, calls } = makeFetchMock({
			"POST /sessions/sess-1/action": {},
		});
		const tool = getTool(
			createMaestroTools({ daemonUrl, fetch: fetchMock }),
			"maestro_scroll",
		);
		await tool.execute(
			{
				session_id: "sess-1",
				x: 50,
				y: 60,
				direction: "down",
				amount: 3,
			},
			ctx(),
		);
		expect(calls[0].body).toEqual({
			action: "scroll",
			x: 50,
			y: 60,
			direction: "down",
			amount: 3,
		});
	});
});

describe("maestro_zoom", () => {
	it("posts the rectangle and returns a multimodal image result", async () => {
		const { fetchMock, calls } = makeFetchMock({
			"POST /sessions/sess-1/action": { data: "ZOOMDATA" },
		});
		const tool = getTool(
			createMaestroTools({ daemonUrl, fetch: fetchMock }),
			"maestro_zoom",
		);
		const result = await tool.execute(
			{
				session_id: "sess-1",
				x0: 10,
				y0: 20,
				x1: 110,
				y1: 220,
			},
			ctx(),
		);
		expect(calls[0].body).toEqual({
			action: "zoom",
			x0: 10,
			y0: 20,
			x1: 110,
			y1: 220,
		});
		expect(result).toEqual([
			{
				type: "text",
				text: "Zoomed region (10, 20)-(110, 220) of session sess-1.",
			},
			{ type: "image", data: "ZOOMDATA", mediaType: "image/jpeg" },
		]);
	});
});

describe("error handling", () => {
	it("surfaces HTTP error responses as thrown errors", async () => {
		const fetchMock = vi.fn(
			async () => new Response("session not found", { status: 404 }),
		) as unknown as typeof fetch;
		const tool = getTool(
			createMaestroTools({ daemonUrl, fetch: fetchMock }),
			"maestro_screenshot",
		);
		await expect(tool.execute({ session_id: "nope" }, ctx())).rejects.toThrow(
			/HTTP 404/,
		);
	});
});
