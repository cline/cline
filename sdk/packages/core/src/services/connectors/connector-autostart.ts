import {
	type ConnectorConnectionRecord,
	withConnectorStore,
} from "@cline/shared/db";

const INTERACTIVE_FLAGS = new Set(["-i", "--interactive"]);

function normalizeReconnectArgs(args: string[], cwd: string): string[] {
	const normalized = args.filter((arg) => !INTERACTIVE_FLAGS.has(arg));
	const hasExplicitCwd = normalized.some(
		(arg) => arg === "--cwd" || arg.startsWith("--cwd="),
	);
	return hasExplicitCwd ? normalized : [...normalized, "--cwd", cwd];
}

/**
 * Record a successful connector start so the connector can be reconnected
 * automatically after a hub or host restart.
 */
export function persistConnectorConnection(
	channel: string,
	instanceId: string,
	rawArgs: string[],
	cwd = process.cwd(),
): void {
	try {
		const reconnectArgs = normalizeReconnectArgs(rawArgs, cwd);
		withConnectorStore((store) =>
			store.recordConnected(channel, instanceId, reconnectArgs),
		);
	} catch {
		// Persistence is best-effort; never fail the connector start over it.
	}
}

/** Stop auto-reconnecting one instance, one channel, or every connector. */
export function disableConnectorAutostart(
	channel?: string,
	instanceId?: string,
): void {
	try {
		withConnectorStore((store) => {
			if (channel) {
				store.setEnabled(channel, false, instanceId);
			} else {
				store.disableAll();
			}
		});
	} catch {
		// Persistence is best-effort; never fail the connector stop over it.
	}
}

export function getPersistedConnectorConnection(
	channel: string,
	instanceId: string,
): ConnectorConnectionRecord | undefined {
	try {
		return withConnectorStore((store) =>
			store.getConnection(channel, instanceId),
		);
	} catch {
		return undefined;
	}
}

export function removePersistedConnectorConnection(
	channel: string,
	instanceId: string,
): void {
	try {
		withConnectorStore((store) => store.deleteConnection(channel, instanceId));
	} catch {
		// Replacement cleanup is best-effort.
	}
}

export interface ReconnectTarget {
	channel: string;
	instanceId: string;
	args: string[];
}

export interface ReconnectAttempt {
	channel: string;
	instanceId: string;
	ok: boolean;
	error?: string;
}

export interface ReconnectPersistedConnectorsOptions {
	/** Starts one connector instance with its stored, non-interactive arguments. */
	start: (target: ReconnectTarget) => Promise<boolean>;
	/** Reports whether this exact connector instance is healthy in the host. */
	isHealthy?: (target: ReconnectTarget) => boolean;
	log?: (message: string) => void;
}

/**
 * Reconnect every connector that has stored connection arguments, is enabled,
 * and is not already active in the calling host.
 */
export async function reconnectPersistedConnectors(
	options: ReconnectPersistedConnectorsOptions,
): Promise<ReconnectAttempt[]> {
	const log = options.log ?? (() => {});
	let candidates: ReconnectTarget[];
	try {
		candidates = withConnectorStore((store) => store.listConnections())
			.filter((entry) => entry.enabled)
			.map((entry) => ({
				channel: entry.channel,
				instanceId: entry.instanceId,
				args: entry.connectArgs,
			}));
	} catch (error) {
		log(
			`[connect] failed to read persisted connectors: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		return [];
	}

	const attempts: ReconnectAttempt[] = [];
	for (const target of candidates) {
		const { channel, instanceId } = target;
		if (options.isHealthy?.(target)) {
			log(
				`[connect] skipping ${channel} connector ${instanceId}: already live in this host`,
			);
			continue;
		}
		log(`[connect] reconnecting ${channel} connector ${instanceId}`);
		try {
			const ok = await options.start(target);
			attempts.push({ channel, instanceId, ok });
			if (!ok) {
				log(`[connect] failed to reconnect ${channel} connector ${instanceId}`);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			attempts.push({
				channel,
				instanceId,
				ok: false,
				error: message,
			});
			log(
				`[connect] failed to reconnect ${channel} connector ${instanceId}: ${message}`,
			);
		}
	}
	return attempts;
}
