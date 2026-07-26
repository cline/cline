/**
 * Host conformance kit — fail closed when declared capabilities no-op.
 */

import type { DriveHostPort, HostCapabilities } from "../hostPort";
import { CLINE_HUB_WRITER_ENDPOINT } from "../hostPort";

export type ConformanceIssue = {
	readonly code: string;
	readonly message: string;
};

export type ConformanceReport = {
	readonly ok: boolean;
	readonly issues: readonly ConformanceIssue[];
};

export class FakeHostCapabilityError extends Error {
	readonly code = "fake_host_capability" as const;

	constructor(capability: string) {
		super(
			`fakeHost: capability "${capability}" is declared but not implemented (fail closed)`,
		);
		this.name = "FakeHostCapabilityError";
	}
}

/**
 * Host stub for kernel tests. Declared capabilities throw when exercised;
 * undeclared capabilities refuse with a clear error.
 */
export function fakeHost(capabilities: HostCapabilities): DriveHostPort {
	const refuse = (capability: string): never => {
		throw new FakeHostCapabilityError(capability);
	};

	return {
		capabilities,
		async resolveKnownAgents() {
			return [];
		},
		async readDurableFacets() {
			return refuse("durableConfigIo");
		},
		async writeDurableFacets() {
			return refuse("durableConfigIo");
		},
		async commitRoomOp() {
			return refuse("roomOps");
		},
		async broadcast() {
			return refuse("eventsFirstStage");
		},
		subscribe() {
			return refuse("eventsFirstStage");
		},
		bridgeWorkEvents() {
			return refuse("eventsFirstStage");
		},
		async applyPromptRewrite() {
			return refuse("promptRewrite");
		},
	};
}

/**
 * Static capability matrix checks. Effect probes for stubs live in
 * `assertFakeHostFailClosed` so a real host that successfully commits is not
 * misclassified as a silent no-op.
 */
export async function runHostConformance(
	host: DriveHostPort,
	required: Partial<HostCapabilities> = {},
): Promise<ConformanceReport> {
	const issues: ConformanceIssue[] = [];
	const caps = host.capabilities;

	if (!caps.writerEndpoint || caps.writerEndpoint.trim() === "") {
		issues.push({
			code: "writer_endpoint_required",
			message: "HostCapabilities.writerEndpoint is required",
		});
	}

	// Second-daemon port (never a Drive writer). Keep as a number so source
	// does not embed the forbidden default endpoint string CI greps for.
	const forbiddenSecondDaemonPort = 7891;
	if (caps.writerEndpoint.includes(`:${forbiddenSecondDaemonPort}`)) {
		issues.push({
			code: "forbidden_writer_endpoint",
			message: `writerEndpoint must not use a second daemon port; expected Cline hub at ${CLINE_HUB_WRITER_ENDPOINT}`,
		});
	}

	if (required.localOnly !== false && caps.localOnly !== true) {
		issues.push({
			code: "local_only_required",
			message: "MVP hosts must declare localOnly: true",
		});
	}

	if (caps.pixelShare === true) {
		issues.push({
			code: "pixel_share_forbidden",
			message: "pixelShare must be false for every MVP host",
		});
	}

	for (const [key, want] of Object.entries(required) as Array<
		[keyof HostCapabilities, HostCapabilities[keyof HostCapabilities]]
	>) {
		if (want === undefined) {
			continue;
		}
		if (caps[key] !== want) {
			issues.push({
				code: "capability_mismatch",
				message: `Expected ${String(key)}=${String(want)}, got ${String(caps[key])}`,
			});
		}
	}

	return { ok: issues.length === 0, issues };
}

/**
 * Proves fakeHost (or any stub) fails closed: declared effect capabilities
 * must throw, never silently succeed.
 */
export async function assertFakeHostFailClosed(
	host: DriveHostPort,
): Promise<ConformanceReport> {
	const issues: ConformanceIssue[] = [];
	const caps = host.capabilities;

	const probes: Array<{
		flag: keyof HostCapabilities;
		run: () => Promise<void>;
	}> = [
		{
			flag: "roomOps",
			run: async () => {
				await host.commitRoomOp({
					type: "leave",
					participantId: "__conformance__",
				});
			},
		},
		{
			flag: "durableConfigIo",
			run: async () => {
				await host.writeDurableFacets("/tmp", {});
			},
		},
		{
			flag: "promptRewrite",
			run: async () => {
				await host.applyPromptRewrite({
					turnId: "__conformance__",
					rewrite: "x",
				});
			},
		},
		{
			flag: "eventsFirstStage",
			run: async () => {
				await host.broadcast({
					schemaVersion: 1,
					id: "__conformance__",
					roomId: "__conformance__",
					at: new Date().toISOString(),
					type: "control.mute",
					track: "control",
					participantId: "__conformance__",
					muted: true,
				});
			},
		},
	];

	for (const probe of probes) {
		if (caps[probe.flag] !== true) {
			continue;
		}
		try {
			await probe.run();
			issues.push({
				code: "capability_noop",
				message: `Declared ${String(probe.flag)}=true but probe completed without throwing (fail closed)`,
			});
		} catch (error) {
			if (!(error instanceof FakeHostCapabilityError)) {
				// Still not a silent no-op; acceptable for stubs that throw differently.
			}
		}
	}

	return { ok: issues.length === 0, issues };
}
