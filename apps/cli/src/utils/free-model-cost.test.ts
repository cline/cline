import type { AgentEvent } from "@cline/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	clearClineFreeModelCostCache,
	shouldZeroClineFreeModelCost,
	zeroCliAgentEventCost,
	zeroCliUsageCost,
} from "./free-model-cost";

afterEach(() => {
	clearClineFreeModelCostCache();
	vi.unstubAllGlobals();
});

describe("shouldZeroClineFreeModelCost", () => {
	it("uses the Cline free model list", async () => {
		const fetchMock = vi.fn(
			async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) => {
				return new Response(
					JSON.stringify({
						free: [{ id: "deepseek/deepseek-v4-flash" }],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			},
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			shouldZeroClineFreeModelCost({
				providerId: "cline",
				modelId: "deepseek/deepseek-v4-flash",
				baseUrl: "https://cline.test/api/v1",
			}),
		).resolves.toBe(true);

		expect(fetchMock.mock.calls[0]?.[0]).toBe(
			"https://cline.test/api/v1/ai/cline/recommended-models",
		);
	});

	it("does not zero non-Cline providers", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			shouldZeroClineFreeModelCost({
				providerId: "openrouter",
				modelId: "deepseek/deepseek-v4-flash",
				baseUrl: "https://cline.test/api/v1",
			}),
		).resolves.toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("does not match a paid model by only the final path segment", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				return new Response(
					JSON.stringify({
						free: [{ id: "deepseek/deepseek-v4-flash" }],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}),
		);

		await expect(
			shouldZeroClineFreeModelCost({
				providerId: "cline",
				modelId: "acme/deepseek-v4-flash",
				baseUrl: "https://cline.test/api/v1",
			}),
		).resolves.toBe(false);
	});

	it("retries after a failed free model list fetch", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						free: [{ id: "deepseek/deepseek-v4-flash" }],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			);
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			shouldZeroClineFreeModelCost({
				providerId: "cline",
				modelId: "deepseek/deepseek-v4-flash",
				baseUrl: "https://cline.test/api/v1",
			}),
		).resolves.toBe(false);
		await expect(
			shouldZeroClineFreeModelCost({
				providerId: "cline",
				modelId: "deepseek/deepseek-v4-flash",
				baseUrl: "https://cline.test/api/v1",
			}),
		).resolves.toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});

describe("zeroCliUsageCost", () => {
	it("zeros total cost while preserving token usage", () => {
		expect(
			zeroCliUsageCost(
				{
					inputTokens: 10,
					outputTokens: 5,
					totalCost: 0.001,
				},
				true,
			),
		).toEqual({
			inputTokens: 10,
			outputTokens: 5,
			totalCost: 0,
		});
	});
});

describe("zeroCliAgentEventCost", () => {
	it("zeros usage event cost fields", () => {
		const event = {
			type: "usage",
			inputTokens: 10,
			outputTokens: 5,
			cost: 0.001,
			totalCost: 0.001,
		} as AgentEvent;

		expect(zeroCliAgentEventCost(event, true)).toMatchObject({
			cost: 0,
			totalCost: 0,
		});
	});

	it("zeros done event usage cost", () => {
		const event = {
			type: "done",
			reason: "completed",
			text: "ok",
			iterations: 1,
			usage: {
				inputTokens: 10,
				outputTokens: 5,
				totalCost: 0.001,
			},
		} as AgentEvent;

		expect(zeroCliAgentEventCost(event, true)).toMatchObject({
			usage: { totalCost: 0 },
		});
	});
});
