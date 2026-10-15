import { setTimeout } from "node:timers/promises";
import { type HubServerProbeRecord, probeHubServer } from ".";

/** Startup preserves ownership while an existing endpoint has indeterminate health. */
export class HubStartupProbeTimeoutError extends Error {
	constructor() {
		super(
			"Timed out checking the existing Cline Hub; its discovery record and process were left unchanged.",
		);
		this.name = "HubStartupProbeTimeoutError";
	}
}

export async function probeHubForStartup(
	url: string,
	options: { authToken?: string; signal?: AbortSignal; deadline?: number } = {},
): Promise<HubServerProbeRecord | undefined> {
	const deadline = options.deadline ?? Date.now() + 15_000;
	options.signal?.throwIfAborted();
	while (Date.now() < deadline) {
		const probe = await probeHubServer(url, {
			authToken: options.authToken,
			signal: options.signal,
			timeoutMs: Math.min(3_000, Math.max(1, deadline - Date.now())),
		});
		if (probe.status === "healthy") return probe.hub;
		// An endpoint that answers but is not a Hub (a stale discovery port reused
		// by another server, or a fallback-eligible requested port) cannot own
		// startup. Treating it as absent lets callers clear stale discovery or fall
		// back to another port; the instance lock still prevents a second Hub.
		if (probe.status === "unreachable" || probe.status === "invalid-response")
			return undefined;
		await setTimeout(
			Math.min(100, Math.max(0, deadline - Date.now())),
			undefined,
			{ signal: options.signal },
		);
	}
	throw new HubStartupProbeTimeoutError();
}
