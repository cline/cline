import { describe, expect, it } from "vitest";
import { parseCodexSubscriptionUsage } from "./codex-subscription-usage";

const capturedAt = 1_900_000_000_000;
const parse = (headers?: Record<string, string | undefined>) =>
	parseCodexSubscriptionUsage(headers, capturedAt);

const invalidPercentages = ["-1", "Infinity", "NaN", "", "bad", "12%"];
const invalidOptions = [
	"0",
	"-1",
	"0.5",
	"bad",
	"Infinity",
	"9007199254740992",
];

describe("parseCodexSubscriptionUsage", () => {
	it("reads both windows case-insensitively, preserving zero and converting epoch seconds", () => {
		const result = parse({
			"X-Codex-Primary-Used-Percent": "0",
			"x-codex-primary-window-minutes": "90",
			"x-codex-primary-reset-at": "1",
			"x-codex-secondary-used-percent": "23.25",
			"x-codex-secondary-window-minutes": "7",
			"x-codex-secondary-reset-at": "2",
		});
		expect(result).toMatchObject({
			providerId: "openai-codex",
			source: "codex-response-headers",
			capturedAt,
		});
		expect(result?.windows).toEqual([
			{ id: "primary", usedPercent: 0, windowMinutes: 90, resetsAt: 1000 },
			{
				id: "secondary",
				usedPercent: 23.25,
				windowMinutes: 7,
				resetsAt: 2000,
			},
		]);
	});

	it.each([100, 125.75])("preserves %s%% with unknown reset", (usedPercent) => {
		expect(
			parse({ "x-codex-primary-used-percent": String(usedPercent) })?.windows,
		).toEqual([{ id: "primary", usedPercent }]);
	});

	it.each(invalidPercentages)("retains the valid sibling for %j", (value) => {
		expect(
			parse({
				"x-codex-primary-used-percent": value,
				"x-codex-secondary-used-percent": "25",
			})?.windows,
		).toEqual([{ id: "secondary", usedPercent: 25 }]);
	});

	it.each(invalidOptions)("omits invalid option %j", (value) => {
		expect(
			parse({
				"x-codex-primary-used-percent": "8",
				"x-codex-primary-window-minutes": value,
				"x-codex-primary-reset-at": value,
			})?.windows,
		).toEqual([{ id: "primary", usedPercent: 8 }]);
	});

	it("returns undefined for absent usage or malformed percentages", () => {
		for (const headers of [
			undefined,
			{},
			{ "x-codex-primary-reset-at": "1900001000" },
			{ "x-codex-primary-used-percent": "bad" },
		])
			expect(parse(headers)).toBeUndefined();
	});

	it("never reads or copies secrets and unrelated fields", () => {
		const headers = {
			"x-codex-primary-used-percent": "12",
			"chatgpt-account-id": "synthetic-account-canary",
			"set-cookie": "synthetic-cookie-canary",
			"x-unrelated": "synthetic-unrelated-canary",
		};
		Object.defineProperty(headers, "authorization", {
			enumerable: true,
			get: () => {
				throw new Error("must not read credentials");
			},
		});
		const snapshot = parse(headers);
		expect(snapshot).toEqual(parse({ "x-codex-primary-used-percent": "12" }));
		expect(JSON.stringify(snapshot)).not.toContain("canary");
	});
});
