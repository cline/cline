#!/usr/bin/env bun
/**
 * A runnable stand-in for the Cline relay.
 *
 *   bun run apps/mobile/scripts/dev-relay.ts
 *
 * Boots `@cline/hub-relay`'s REAL relay server — the same code the package tests
 * drive — with a permissive dev `verifyAccount` in place of WorkOS/Cline JWT
 * verification. Everything else (account-scoped routing, channel pairing,
 * heartbeats, frame caps, blind-pipe forwarding) is the production code path.
 *
 * The relay is what makes "My Machine" work without Tailscale, port forwarding or
 * LAN reachability: the laptop hub dials OUT to the relay and registers under the
 * user's Cline account, the phone connects to the same relay with the same
 * account, and the relay brokers bytes. Production deployments must use scoped relay tickets.
 *
 * If `apps/mobile/.dev-hub.json` exists (written by `scripts/dev-hub.ts`) this
 * also starts a host client bridging that hub, so one extra terminal gives a
 * complete phone -> relay -> hub path. Set `DEV_RELAY_NO_HOST=1` to skip it.
 *
 * ## Dev auth
 *
 * - the printed shared token             -> account `dev-account`
 * - `dev:<accountId>:<proof>`            -> that account, where `<proof>` is
 *                                           derived from the shared token
 *                                           (the script prints a ready-made one)
 * - anything else, including a bare
 *   `dev:<accountId>`                    -> 401, same as production
 *
 * Every account needs proof on purpose. A channel to the bridged hub is arbitrary
 * tool execution on this laptop, so "claim an account id and be believed" would
 * make the port itself the only thing standing between anyone who can reach it
 * and a shell here. The policy and its tests live in
 * `sdk/packages/hub-relay/src/server/dev-auth.ts`.
 *
 * Binding anything other than loopback additionally requires
 * `DEV_RELAY_ALLOW_REMOTE=1` AND an explicit, long `DEV_RELAY_TOKEN`.
 *
 * ## Why the import looks unusual
 *
 * `@cline/hub-relay` is not a dependency of `@cline/mobile`, and the mobile
 * typecheck includes `scripts/**`. The relay is therefore loaded from source by
 * absolute path through a computed specifier, which Bun resolves at runtime and
 * `tsc` leaves alone — the same trick `scripts/dev-hub.ts` uses for
 * `@cline/core/hub`. The surface actually used is declared locally below.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const RELAY_SERVER_SRC = resolve(
	REPO_ROOT,
	"sdk/packages/hub-relay/src/server/index.ts",
);
const RELAY_HOST_SRC = resolve(
	REPO_ROOT,
	"sdk/packages/hub-relay/src/host/index.ts",
);
const DEV_RELAY_JSON = resolve(HERE, "..", ".dev-relay.json");
const DEV_HUB_JSON = resolve(HERE, "..", ".dev-hub.json");

const PREFERRED_PORT = Number(process.env.DEV_RELAY_PORT ?? 4610);
const HOST = process.env.DEV_RELAY_HOST ?? "127.0.0.1";
const DEV_TOKEN = process.env.DEV_RELAY_TOKEN ?? "cline-dev-relay-token";
const DEV_TOKEN_WAS_PROVIDED = Boolean(process.env.DEV_RELAY_TOKEN);
const ALLOW_REMOTE = process.env.DEV_RELAY_ALLOW_REMOTE === "1";
const DEV_ACCOUNT_ID = "dev-account";

// ---------------------------------------------------------------------------
// Local declarations of the (computed-specifier) relay surface this script uses.
// ---------------------------------------------------------------------------

interface DevRelayAccount {
	accountId: string;
}

type DevRelayEvent =
	| { type: "listening"; url: string; port: number }
	| { type: "auth.rejected"; role: string; reason: string }
	| {
			type: "host.registered";
			machineId: string;
			accountId: string;
			label: string;
	  }
	| {
			type: "host.disconnected";
			machineId: string;
			accountId: string;
			channelsTornDown: number;
	  }
	| {
			type: "channel.opened";
			channelId: string;
			machineId: string;
			accountId: string;
	  }
	| {
			type: "channel.closed";
			channelId: string;
			machineId: string;
			code: string;
			framesFromClient: number;
			framesFromHost: number;
			bytes: number;
	  }
	| { type: "frame"; channelId: string; direction: string; bytes: number }
	| { type: "rejected"; role: string; code: string; message: string };

interface DevRelayServer {
	url: string;
	port: number;
	machines(): { machineId: string; label: string; channels: number }[];
	stats(): {
		hosts: number;
		clients: number;
		channels: number;
		framesRelayed: number;
		bytesRelayed: number;
	};
	close(): Promise<void>;
}

type DevVerifyAccount = (context: {
	token: string | undefined;
	role: string;
	headers: Record<string, string | undefined>;
}) => DevRelayAccount | undefined;

interface DevRelayServerModule {
	createRelayServer(options: {
		verifyAccount: DevVerifyAccount;
		port: number;
		host: string;
		onEvent: (event: DevRelayEvent) => void;
	}): Promise<DevRelayServer>;
	/** See `sdk/packages/hub-relay/src/server/dev-auth.ts`. */
	createDevVerifyAccount(options: {
		sharedToken: string;
		defaultAccountId: string;
	}): DevVerifyAccount;
	deriveDevAccountToken(sharedToken: string, accountId: string): string;
	assertDevRelayBindAllowed(request: {
		host: string;
		sharedToken: string;
		allowRemote: boolean;
		tokenWasProvided: boolean;
	}): { warning?: string };
}

interface DevRelayHostModule {
	createRelayHostClient(options: {
		relayUrl: string;
		accountToken: string;
		hubUrl: string;
		hubAuthToken?: string;
		machineId: string;
		label: string;
		onEvent?: (event: { type: string }) => void;
	}): {
		machineId: string;
		start(): Promise<void>;
		close(): Promise<void>;
	};
}

function log(...parts: unknown[]): void {
	console.log(`[dev-relay ${new Date().toISOString()}]`, ...parts);
}

/** Per-channel frame counters, flushed on a timer so the log stays readable. */
class FrameMeter {
	private readonly up = new Map<string, { frames: number; bytes: number }>();
	private readonly down = new Map<string, { frames: number; bytes: number }>();
	private dirty = false;

	record(channelId: string, direction: string, bytes: number): void {
		const table = direction === "client->host" ? this.up : this.down;
		const entry = table.get(channelId) ?? { frames: 0, bytes: 0 };
		entry.frames += 1;
		entry.bytes += bytes;
		table.set(channelId, entry);
		this.dirty = true;
	}

	forget(channelId: string): void {
		this.up.delete(channelId);
		this.down.delete(channelId);
	}

	/** Counts and sizes only. Payload contents are never read, let alone logged. */
	flush(): void {
		if (!this.dirty) {
			return;
		}
		this.dirty = false;
		const channelIds = new Set([...this.up.keys(), ...this.down.keys()]);
		for (const channelId of channelIds) {
			const up = this.up.get(channelId) ?? { frames: 0, bytes: 0 };
			const down = this.down.get(channelId) ?? { frames: 0, bytes: 0 };
			log(
				`channel ${channelId} frames phone->hub=${up.frames} (${up.bytes}B) hub->phone=${down.frames} (${down.bytes}B)`,
			);
		}
	}
}

async function startRelay(
	relayModule: DevRelayServerModule,
	port: number,
	onEvent: (event: DevRelayEvent) => void,
): Promise<DevRelayServer> {
	return await relayModule.createRelayServer({
		// Permissive about WHO, strict about PROOF: every account, including
		// `dev-account`, must present a token derived from the shared secret.
		verifyAccount: relayModule.createDevVerifyAccount({
			sharedToken: DEV_TOKEN,
			defaultAccountId: DEV_ACCOUNT_ID,
		}),
		port,
		host: HOST,
		onEvent,
	});
}

/** `.dev-hub.json`, if `scripts/dev-hub.ts` is running. */
function readDevHub(): { url: string; authToken: string } | undefined {
	if (!existsSync(DEV_HUB_JSON)) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(readFileSync(DEV_HUB_JSON, "utf8")) as {
			url?: string;
			authToken?: string;
		};
		return parsed.url
			? { url: parsed.url, authToken: parsed.authToken ?? "" }
			: undefined;
	} catch {
		return undefined;
	}
}

async function main(): Promise<void> {
	// Computed specifiers: resolved by Bun at runtime, opaque to tsc. See header.
	const relayServerPath = RELAY_SERVER_SRC;
	const relayHostPath = RELAY_HOST_SRC;
	const relayModule = (await import(relayServerPath)) as DevRelayServerModule;

	// Before anything binds: a dev relay reachable off this machine is a remote
	// path to this laptop's hub, so it needs an explicit opt-in AND a real token.
	const bind = relayModule.assertDevRelayBindAllowed({
		host: HOST,
		sharedToken: DEV_TOKEN,
		allowRemote: ALLOW_REMOTE,
		tokenWasProvided: DEV_TOKEN_WAS_PROVIDED,
	});
	if (bind.warning) {
		const banner = "!".repeat(72);
		console.warn(`\n${banner}\n!! ${bind.warning}\n${banner}\n`);
	}

	const meter = new FrameMeter();
	const onEvent = (event: DevRelayEvent): void => {
		switch (event.type) {
			case "host.registered":
				log(
					`host registered machine=${event.machineId} account=${event.accountId} label=${JSON.stringify(event.label)}`,
				);
				return;
			case "host.disconnected":
				log(
					`host gone machine=${event.machineId} account=${event.accountId} channelsTornDown=${event.channelsTornDown}`,
				);
				return;
			case "channel.opened":
				log(
					`channel opened ${event.channelId} machine=${event.machineId} account=${event.accountId}`,
				);
				return;
			case "channel.closed":
				meter.forget(event.channelId);
				log(
					`channel closed ${event.channelId} machine=${event.machineId} code=${event.code} frames phone->hub=${event.framesFromClient} hub->phone=${event.framesFromHost} bytes=${event.bytes}`,
				);
				return;
			case "frame":
				meter.record(event.channelId, event.direction, event.bytes);
				return;
			case "auth.rejected":
				log(`auth rejected role=${event.role} (${event.reason})`);
				return;
			case "rejected":
				log(`refused role=${event.role} code=${event.code} — ${event.message}`);
				return;
			default:
				return;
		}
	};

	let relay: DevRelayServer;
	try {
		relay = await startRelay(relayModule, PREFERRED_PORT, onEvent);
	} catch (error) {
		log(
			`could not bind port ${PREFERRED_PORT} (${
				error instanceof Error ? error.message : String(error)
			}); falling back to an ephemeral port`,
		);
		relay = await startRelay(relayModule, 0, onEvent);
	}

	// Machine-readable, single line, easy to grep/parse.
	console.log(`DEV_RELAY_URL=${relay.url}`);
	console.log(`DEV_RELAY_TOKEN=${DEV_TOKEN}`);
	console.log(`DEV_RELAY_PORT=${relay.port}`);

	const record = {
		relayUrl: relay.url,
		devAccountToken: DEV_TOKEN,
		port: relay.port,
		accountId: DEV_ACCOUNT_ID,
		hostPath: "/v1/host",
		clientPath: "/v1/client",
		createdAt: Date.now(),
	};
	writeFileSync(DEV_RELAY_JSON, `${JSON.stringify(record, null, 2)}\n`);
	log(`wrote ${DEV_RELAY_JSON}`);
	log(
		"payload contents are NEVER read or logged — only frame counts and sizes.",
	);
	log(
		`hub registers at ${relay.url}/v1/host, phone connects at ${relay.url}/v1/client`,
	);
	log(
		"Set EXPO_PUBLIC_RELAY_URL / EXPO_PUBLIC_RELAY_TOKEN for the phone to auto-connect.",
	);
	log(
		`to test cross-account denial by hand, use ${relayModule.deriveDevAccountToken(
			DEV_TOKEN,
			"dev-other-account",
		)} — a bare dev:<accountId> is refused, because impersonating dev-account would be a channel to the hub below.`,
	);

	// Bridge a locally running dev hub, if there is one, so this single relay is a
	// complete stand-in rather than half a path.
	const devHub =
		process.env.DEV_RELAY_NO_HOST === "1" ? undefined : readDevHub();
	let hostClient: { close(): Promise<void> } | undefined;
	if (devHub) {
		const hostModule = (await import(relayHostPath)) as DevRelayHostModule;
		const client = hostModule.createRelayHostClient({
			relayUrl: relay.url,
			accountToken: DEV_TOKEN,
			hubUrl: devHub.url,
			hubAuthToken: devHub.authToken,
			machineId: "mach_dev_laptop",
			label: "dev laptop (scripts/dev-hub.ts)",
		});
		await client.start();
		hostClient = client;
		log(
			`bridging the local dev hub at ${devHub.url} as machine mach_dev_laptop`,
		);
	} else {
		log(
			"no .dev-hub.json found: run `bun run scripts/dev-hub.ts` first, or start your own host client.",
		);
	}

	log("Waiting for connections. Ctrl-C to stop.");

	const flushTimer = setInterval(() => meter.flush(), 2_000);
	flushTimer.unref?.();

	let closing = false;
	const shutdown = async (): Promise<void> => {
		if (closing) {
			return;
		}
		closing = true;
		clearInterval(flushTimer);
		meter.flush();
		const stats = relay.stats();
		log(
			`shutting down — hosts=${stats.hosts} clients=${stats.clients} channels=${stats.channels} frames=${stats.framesRelayed} bytes=${stats.bytesRelayed}`,
		);
		if (hostClient) {
			await hostClient.close();
		}
		await relay.close();
		process.exit(0);
	};
	process.on("SIGINT", () => void shutdown());
	process.on("SIGTERM", () => void shutdown());

	// Keep the process alive until a signal arrives.
	await new Promise<never>(() => {});
}

void main().catch((error) => {
	console.error("[dev-relay] fatal:", error);
	process.exit(1);
});
