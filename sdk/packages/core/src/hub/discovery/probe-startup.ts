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
		if (probe.status === "unreachable") return undefined;
		if (probe.status === "invalid-response") {
			throw new Error(
				"The existing Hub endpoint returned an invalid health response; it was left unchanged.",
			);
		}
		await setTimeout(
			Math.min(100, Math.max(0, deadline - Date.now())),
			undefined,
			{ signal: options.signal },
		);
	}
	throw new HubStartupProbeTimeoutError();
}
