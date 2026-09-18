import { afterEach, describe, expect, it, vi } from "vitest";
import {
	getClineRecommendedModelsPayload,
	resetClineRecommendedPayloadCache,
} from "./catalog-cline-recommended";
import { clineCatalogBaseUrl } from "./cline-catalog-context";

afterEach(() => {
	resetClineRecommendedPayloadCache();
	vi.restoreAllMocks();
});

describe("recommendation request deadlines", () => {
	it.each([
		true,
		false,
	])("isolates short and long deadlines (short first: %s)", async (shortFirst) => {
		const short = new AbortController();
		const long = new AbortController();
		vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) =>
			ms === 100 ? short.signal : long.signal,
		);
		const releases = new Map<AbortSignal, (response: Response) => void>();
		const fetchImpl = vi.fn(
			(_input: Parameters<typeof fetch>[0], init?: RequestInit) =>
				new Promise<Response>((resolve, reject) => {
					const signal = init?.signal;
					if (!signal) throw new Error("Expected a bounded request");
					releases.set(signal, resolve);
					signal.addEventListener("abort", () => reject(signal.reason), {
						once: true,
					});
				}),
		);
		const context = { baseUrl: "https://cline.test", fetchImpl };
		const first = getClineRecommendedModelsPayload(
			context,
			shortFirst ? 100 : 5_000,
		);
		const second = getClineRecommendedModelsPayload(
			context,
			shortFirst ? 5_000 : 100,
		);
		const shortRequest = shortFirst ? first : second;
		const longRequest = shortFirst ? second : first;
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		// Equal deadlines still deduplicate.
		const anotherLong = getClineRecommendedModelsPayload(context, 5_000);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		const failure = expect(shortRequest).rejects.toThrow("Short deadline");
		short.abort(new Error("Short deadline"));
		await failure;
		expect(long.signal.aborted).toBe(false);
		const payload = { recommended: [{ id: "vendor/model" }] };
		releases.get(long.signal)?.(Response.json(payload));
		expect(await longRequest).toEqual(payload);
		expect(await anotherLong).toEqual(payload);
		// Successful data can be reused regardless of the caller's deadline.
		expect(await getClineRecommendedModelsPayload(context, 100)).toEqual(
			payload,
		);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});
});

describe("Cline API base URL normalization", () => {
	it.each([
		[" https://cline.test/api/v1/// ", "https://cline.test"],
		["https://cline.test/proxy///", "https://cline.test/proxy"],
		[
			`https://cline.test/${"/".repeat(100_000)}tail`,
			`https://cline.test/${"/".repeat(100_000)}tail`,
		],
	])("normalizes endpoint case %#", (baseUrl, expected) => {
		expect(clineCatalogBaseUrl({ baseUrl })).toBe(expected);
	});
});
