import { withConnectorStore } from "@cline/shared/db";

const INTERACTIVE_FLAGS = new Set(["-i", "--interactive"]);

function stripInteractiveFlags(args: string[]): string[] {
	return args.filter((arg) => !INTERACTIVE_FLAGS.has(arg));
}

/**
 * Record a successful connector start so the connector can be reconnected
 * automatically after a hub or host restart.
 */
export function persistConnectorConnection(
	channel: string,
	rawArgs: string[],
): void {
	try {
		withConnectorStore((store) =>
			store.recordConnected(channel, stripInteractiveFlags(rawArgs)),
		);
	} catch {
		// Persistence is best-effort; never fail the connector start over it.
	}
}

/** Stop auto-reconnecting a channel after the user stopped it explicitly. */
export function disableConnectorAutostart(channel?: string): void {
	try {
		withConnectorStore((store) => {
			if (channel) {
				store.setEnabled(channel, false);
			} else {
				store.disableAll();
			}
		});
	} catch {
		// Persistence is best-effort; never fail the connector stop over it.
	}
}

export interface ReconnectAttempt {
	channel: string;
	ok: boolean;
	error?: string;
}

export interface ReconnectPersistedConnectorsOptions {
	/** Starts a connector channel with the stored, non-interactive arguments. */
	start: (channel: string, args: string[]) => Promise<boolean>;
	/** Reports whether a host already has an active connector for the channel. */
	isActive?: (channel: string) => boolean;
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
	let candidates: { channel: string; args: string[] }[];
	try {
		candidates = withConnectorStore((store) => store.list())
			.filter((entry) => entry.enabled && entry.connectArgs !== undefined)
			.map((entry) => ({
				channel: entry.channel,
				args: stripInteractiveFlags(entry.connectArgs ?? []),
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
	for (const { channel, args } of candidates) {
		if (options.isActive?.(channel)) {
			continue;
		}
		log(`[connect] reconnecting ${channel} connector`);
		try {
			const ok = await options.start(channel, args);
			attempts.push({ channel, ok });
			if (!ok) {
				log(`[connect] failed to reconnect ${channel} connector`);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			attempts.push({ channel, ok: false, error: message });
			log(`[connect] failed to reconnect ${channel} connector: ${message}`);
		}
	}
	return attempts;
}
