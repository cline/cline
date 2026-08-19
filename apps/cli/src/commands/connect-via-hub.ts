import {
	ensureDetachedHubServer,
	NodeHubClient,
	readHubDiscovery,
	resolveProductionHubOwnerContext,
	resolveSharedHubOwnerContext,
} from "@cline/core";
import {
	type ConnectorStartResult,
	resolveClineBuildEnv,
	type SupervisedConnectorRecord,
} from "@cline/shared";
import type { ConnectIo } from "../connectors/types";

/**
 * Error codes that mean "this hub cannot supervise connectors", as opposed to
 * "the start failed". Both are answers from the hub, but only the former should
 * send the caller back to starting the connector itself.
 */
const UNSUPPORTED_ERROR_CODES = new Set([
	"unsupported_command",
	"unsupported_connector_command",
]);
const UNSUPPORTED_MESSAGE_FRAGMENT = "connector supervision is unavailable";

export type HubDelegationOutcome =
	/** The hub owns the connector now; `exitCode` is the command's result. */
	| { delegated: true; exitCode: number }
	/** Nothing was started; the caller should start the connector locally. */
	| { delegated: false; reason: string };

function resolveHubOwnerContext() {
	return resolveClineBuildEnv() === "production"
		? resolveProductionHubOwnerContext()
		: resolveSharedHubOwnerContext();
}

/**
 * Whether the hub at `url` advertises connector supervision.
 *
 * A newer CLI regularly talks to an older running hub — that is the normal state
 * of a long-lived host mid-upgrade — and such a hub would reject
 * `connector.start` outright. Checking the advertised capability first keeps that
 * case on the local path instead of turning it into a failed start.
 */
async function hubSupportsSupervision(): Promise<boolean> {
	try {
		const owner = resolveHubOwnerContext();
		const record = await readHubDiscovery(owner.discoveryPath);
		return record?.capabilities?.includes("connector.start") === true;
	} catch {
		return false;
	}
}

function describeRecord(record: SupervisedConnectorRecord | undefined): string {
	if (!record) {
		return "";
	}
	const details = [
		record.pid === undefined ? undefined : `pid=${record.pid}`,
		`state=${record.state}`,
	].filter(Boolean);
	return details.length > 0 ? ` ${details.join(" ")}` : "";
}

/**
 * What the running hub is supervising, or undefined when it cannot say.
 *
 * Deliberately does not start a hub: this exists for diagnostics, and `cline
 * doctor` reporting on the system must never change it.
 */
export async function listSupervisedConnectorsViaHub(): Promise<
	SupervisedConnectorRecord[] | undefined
> {
	let url: string;
	let authToken: string | undefined;
	try {
		const owner = resolveHubOwnerContext();
		const record = await readHubDiscovery(owner.discoveryPath);
		if (
			!record?.url ||
			!record.capabilities?.includes("connector.supervised")
		) {
			return undefined;
		}
		url = record.url;
		authToken = record.authToken;
	} catch {
		return undefined;
	}
	const client = new NodeHubClient({
		url,
		...(authToken ? { authToken } : {}),
		clientType: "cli-doctor",
		displayName: "doctor",
	});
	try {
		await client.connect();
		const reply = await client.command("connector.supervised");
		if (!reply.ok) {
			return undefined;
		}
		const supervised = (reply.payload as { supervised?: unknown })?.supervised;
		return Array.isArray(supervised)
			? (supervised as SupervisedConnectorRecord[])
			: undefined;
	} catch {
		return undefined;
	} finally {
		try {
			client.close();
		} catch {
			// One-shot connection; a failed close changes nothing.
		}
	}
}

/**
 * Ask the hub to stop supervising a channel's connectors, or one instance of it.
 *
 * Returns how many the hub stopped, or undefined when it cannot supervise. The
 * local stop path alone is not enough: it finds processes through their state
 * files, so a connector that has not written one yet — still starting, or failing
 * to start — would keep running under the hub and be restarted.
 */
export async function stopConnectorsViaHub(input: {
	channel: string;
	instanceId?: string;
}): Promise<number | undefined> {
	const supervised = await listSupervisedConnectorsViaHub();
	if (!supervised) {
		return undefined;
	}
	const targets = supervised.filter(
		(record) =>
			record.channel === input.channel &&
			(input.instanceId === undefined ||
				record.instanceId === input.instanceId),
	);
	if (targets.length === 0) {
		return 0;
	}
	let url: string;
	let authToken: string | undefined;
	try {
		const owner = resolveHubOwnerContext();
		const record = await readHubDiscovery(owner.discoveryPath);
		if (!record?.url) {
			return undefined;
		}
		url = record.url;
		authToken = record.authToken;
	} catch {
		return undefined;
	}
	const client = new NodeHubClient({
		url,
		...(authToken ? { authToken } : {}),
		clientType: "cli-connect",
		displayName: `stop ${input.channel}`,
	});
	let stopped = 0;
	try {
		await client.connect();
		for (const target of targets) {
			const reply = await client.command("connector.stop", {
				channel: target.channel,
				instanceId: target.instanceId,
			});
			if (reply.ok) {
				stopped += 1;
			}
		}
		return stopped;
	} catch {
		return stopped > 0 ? stopped : undefined;
	} finally {
		try {
			client.close();
		} catch {
			// One-shot connection; a failed close changes nothing.
		}
	}
}

/**
 * Ask the hub to start and own a connector.
 *
 * The hub spawning the connector — rather than the connector spawning itself and
 * then bringing up a hub — is what makes the hub the single authority on how many
 * processes hold one connector's credentials, and what lets it reap and restart
 * them when they die. Every failure mode here falls back to the local path so a
 * missing or older hub cannot stop a connector from starting.
 */
export async function startConnectorViaHub(input: {
	channel: string;
	instanceId: string;
	args: string[];
	restart?: boolean;
	io: ConnectIo;
	cwd?: string;
}): Promise<HubDelegationOutcome> {
	const cwd = input.cwd ?? process.cwd();
	let hub: { url: string; authToken: string };
	try {
		hub = await ensureDetachedHubServer(cwd);
	} catch (error) {
		return {
			delegated: false,
			reason: `hub unavailable: ${
				error instanceof Error ? error.message : String(error)
			}`,
		};
	}
	if (!(await hubSupportsSupervision())) {
		return {
			delegated: false,
			reason: "hub does not support connector supervision",
		};
	}

	const client = new NodeHubClient({
		url: hub.url,
		authToken: hub.authToken,
		clientType: "cli-connect",
		displayName: `connect ${input.channel}`,
		cwd,
	});
	try {
		await client.connect();
		const reply = await client.command("connector.start", {
			channel: input.channel,
			instanceId: input.instanceId,
			args: input.args,
			restart: input.restart === true,
		});
		if (!reply.ok) {
			const code = reply.error?.code ?? "";
			const message = reply.error?.message ?? "connector start failed";
			if (
				UNSUPPORTED_ERROR_CODES.has(code) ||
				message.includes(UNSUPPORTED_MESSAGE_FRAGMENT)
			) {
				return { delegated: false, reason: message };
			}
			input.io.writeErr(
				`[connect] hub refused to start ${input.channel}: ${message}`,
			);
			return { delegated: true, exitCode: 1 };
		}
		const payload = reply.payload as ConnectorStartResult | undefined;
		const record = payload?.record;
		if (payload?.started === false && payload.reason === "already_running") {
			input.io.writeln(
				`[connect] ${input.channel} connector ${input.instanceId} is already running under the hub${describeRecord(record)}`,
			);
			return { delegated: true, exitCode: 0 };
		}
		if (payload?.started !== true) {
			input.io.writeErr(
				`[connect] hub could not start ${input.channel} connector ${input.instanceId}${
					record?.lastError ? `: ${record.lastError}` : ""
				}`,
			);
			return { delegated: true, exitCode: 1 };
		}
		input.io.writeln(
			`[connect] ${input.channel} connector ${input.instanceId} started under hub supervision${describeRecord(record)}`,
		);
		input.io.writeln(
			"[connect] the hub will restart it if it exits; use `cline connect --stop` to retire it",
		);
		return { delegated: true, exitCode: 0 };
	} catch (error) {
		return {
			delegated: false,
			reason: `hub command failed: ${
				error instanceof Error ? error.message : String(error)
			}`,
		};
	} finally {
		try {
			client.close();
		} catch {
			// The connection is one-shot; a failed close changes nothing.
		}
	}
}
