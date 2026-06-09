import { describe, expect, it, vi } from "vitest";
import {
	createMiniMaxThinkingFetch,
	MINIMAX_THINKING_DISABLED_HEADER,
	miniMaxThinkingDisabledMiddleware,
} from "./minimax-thinking";

describe("MiniMax thinking shim", () => {
	it("preserves fetch preconnect when the runtime exposes it", () => {
		const preconnect = vi.fn();
		const baseFetch = Object.assign(vi.fn(async () => new Response("{}")), {
			preconnect,
		}) as unknown as typeof fetch;

		const wrappedFetch = createMiniMaxThinkingFetch(baseFetch) as typeof fetch & {
			preconnect?: (url: string) => void;
		};
		wrappedFetch.preconnect?.("https://api.minimax.io");

		expect(preconnect).toHaveBeenCalledWith("https://api.minimax.io");
	});

	it("marks MiniMax requests whose provider options disable thinking", async () => {
		const result = await miniMaxThinkingDisabledMiddleware.transformParams?.({
			type: "stream",
			model: {} as never,
			params: {
				providerOptions: {
					minimax: { thinking: { type: "disabled" } },
				},
			} as never,
		});

		expect(result).toEqual(
			expect.objectContaining({
				headers: expect.objectContaining({
					[MINIMAX_THINKING_DISABLED_HEADER]: "1",
				}),
			}),
		);
	});

	it("injects explicit disabled thinking and strips the private marker header", async () => {
		const baseFetch = vi.fn(async () => new Response("{}"));
		const wrappedFetch = createMiniMaxThinkingFetch(baseFetch);

		await wrappedFetch("https://api.minimax.io/anthropic/v1/messages", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				[MINIMAX_THINKING_DISABLED_HEADER]: "1",
			},
			body: JSON.stringify({
				model: "MiniMax-M3",
				messages: [],
			}),
		});

		const init = baseFetch.mock.calls[0]?.[1];
		expect(new Headers(init?.headers).has(MINIMAX_THINKING_DISABLED_HEADER)).toBe(
			false,
		);
		expect(JSON.parse(String(init?.body))).toEqual(
			expect.objectContaining({
				thinking: { type: "disabled" },
			}),
		);
	});
});
