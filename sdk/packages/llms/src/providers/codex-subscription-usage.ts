import type { SubscriptionUsageSnapshot } from "@cline/shared";

type ResponseHeaders = Readonly<Record<string, string | undefined>>;

function readNumber(
	headers: ResponseHeaders,
	name: string,
): number | undefined {
	const key = Object.keys(headers).find((key) => key.toLowerCase() === name);
	const raw = key === undefined ? undefined : headers[key];
	if (typeof raw !== "string" || !/^-?\d+(?:\.\d+)?$/.test(raw.trim())) return;
	const value = Number(raw);
	return Number.isFinite(value) ? value : undefined;
}

/** Reads only the six default Codex quota headers; no account metadata is copied. */
export function parseCodexSubscriptionUsage(
	headers: ResponseHeaders | undefined,
	capturedAt: number,
): SubscriptionUsageSnapshot | undefined {
	if (!headers || !Number.isFinite(capturedAt)) return;
	const windows: SubscriptionUsageSnapshot["windows"] = [];
	for (const id of ["primary", "secondary"] as const) {
		const prefix = `x-codex-${id}`;
		const usedPercent = readNumber(headers, `${prefix}-used-percent`);
		if (usedPercent === undefined || usedPercent < 0) continue;
		const minutes = readNumber(headers, `${prefix}-window-minutes`);
		const seconds = readNumber(headers, `${prefix}-reset-at`);
		const window: SubscriptionUsageSnapshot["windows"][number] = {
			id,
			usedPercent,
		};
		if (minutes !== undefined && Number.isSafeInteger(minutes) && minutes > 0) {
			window.windowMinutes = minutes;
		}
		// The wire reset-at value is epoch seconds; UI timestamps use milliseconds.
		if (
			seconds !== undefined &&
			Number.isSafeInteger(seconds) &&
			seconds > 0 &&
			seconds <= 8.64e12
		) {
			window.resetsAt = seconds * 1000;
		}
		windows.push(window);
	}
	return windows.length
		? {
				providerId: "openai-codex",
				source: "codex-response-headers",
				capturedAt,
				windows,
			}
		: undefined;
}
