import { withConnectorStore } from "@cline/shared/db";
import { listActiveConnectors } from "./status";

const INTERACTIVE_FLAGS = new Set(["-i", "--interactive"]);

function stripInteractiveFlags(args: string[]): string[] {
	return args.filter((arg) => !INTERACTIVE_FLAGS.has(arg));
}

/**
 * Record a successful `cline connect <channel>` start so the connector can be
 * reconnected automatically after a hub/CLI restart. The stored args include
 * the auth flags the connector was started with; the interactive flag is
 * stripped so reconnects always run detached.
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
		// Persistence is best-effort; never fail the connect command over it.
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
		// Best-effort only.
	}
}

export interface ReconnectAttempt {
	channel: string;
	ok: boolean;
	error?: string;
}

export interface ReconnectOptions {
	/**
	 * Starts a connector channel with the stored args and resolves to whether
	 * the start succeeded. CLI-hosted callers run the connect adapter
	 * in-process (which detaches a background connector); hosts whose
	 * entrypoint is not the CLI (e.g. the hub dashboard app) must spawn a
	 * `cline connect` subprocess instead.
	 */
	start: (channel: string, args: string[]) => Promise<boolean>;
	log?: (message: string) => void;
}

/**
 * Reconnect every connector that was previously connected (has stored connect
 * args), is still enabled, and is not already running. Returns one entry per
 * attempted channel; already-active and never-connected channels are skipped.
 */
export async function reconnectPersistedConnectors(
	options: ReconnectOptions,
): Promise<ReconnectAttempt[]> {
	const log = options.log ?? (() => {});
	let candidates: { channel: string; args: string[] }[];
	try {
		candidates = withConnectorStore((store) => store.list())
			.filter((entry) => entry.enabled && entry.connectArgs?.length)
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
	if (candidates.length === 0) {
		return [];
	}

	const activeTypes = new Set(
		listActiveConnectors().map((record) => record.type),
	);
	const attempts: ReconnectAttempt[] = [];
	for (const { channel, args } of candidates) {
		if (activeTypes.has(channel)) {
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
