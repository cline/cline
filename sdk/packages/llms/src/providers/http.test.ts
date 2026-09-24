import { describe, expect, it, vi } from "vitest";
import {
	shouldDisableFetchConnectionReuse,
	wrapFetchWithoutConnectionReuse,
} from "./http";

describe("shouldDisableFetchConnectionReuse", () => {
	it("only opts out of the keep-alive pool under Bun on Windows", () => {
		expect(
			shouldDisableFetchConnectionReuse({ isBun: true, platform: "win32" }),
		).toBe(true);
		expect(
			shouldDisableFetchConnectionReuse({ isBun: true, platform: "darwin" }),
		).toBe(false);
		expect(
			shouldDisableFetchConnectionReuse({ isBun: false, platform: "win32" }),
		).toBe(false);
	});
});

describe("wrapFetchWithoutConnectionReuse", () => {
	it("returns the base fetch untouched when disabled", () => {
		const baseFetch = vi.fn() as unknown as typeof fetch;
		expect(wrapFetchWithoutConnectionReuse(baseFetch, false)).toBe(baseFetch);
		expect(wrapFetchWithoutConnectionReuse(undefined, false)).toBeUndefined();
	});

	it("sends Connection: close while preserving the request's own headers", async () => {
		const baseFetch = vi.fn(async () => new Response("ok"));
		const wrapped = wrapFetchWithoutConnectionReuse(
			baseFetch as unknown as typeof fetch,
			true,
		);
		await wrapped?.("https://api.example.com/v1/chat/completions", {
			method: "POST",
			headers: { Authorization: "Bearer test" },
			body: "{}",
		});
		const [, init] = baseFetch.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		const headers = new Headers(init.headers);
		expect(headers.get("connection")).toBe("close");
		expect(headers.get("authorization")).toBe("Bearer test");
		expect(init.method).toBe("POST");
		expect(init.body).toBe("{}");
	});

	it("merges headers carried on a Request object", async () => {
		const baseFetch = vi.fn(async () => new Response("ok"));
		const wrapped = wrapFetchWithoutConnectionReuse(
			baseFetch as unknown as typeof fetch,
			true,
		);
		await wrapped?.(
			new Request("https://api.example.com/v1/models", {
				headers: { "X-Test": "1" },
			}),
		);
		const [, init] = baseFetch.mock.calls[0] as unknown as [
			Request,
			RequestInit,
		];
		const headers = new Headers(init.headers);
		expect(headers.get("connection")).toBe("close");
		expect(headers.get("x-test")).toBe("1");
	});
});
