import { readFile, rm } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import {
	clearHubDiscovery,
	ensureDetachedHubServer,
	localHubHasNoActiveSessions,
	probeHubServer,
	readHubDiscovery,
	requestHubDrain,
	resolveProductionHubOwnerContext,
	resolveSharedHubOwnerContext,
	stopLocalHubServerGracefully,
} from "@cline/core";
import {
	createFileDeviceStore,
	deletePairingOffer,
	hubPairingOffersDir,
	loadOrCreateHubIdentity,
	openDeviceRegistry,
	resolveHubPairingDir,
	writePairingOffer,
	writePrivateFile,
} from "@cline/core/hub/pairing";
import {
	type ApprovalPolicy,
	base64UrlToBytes,
	completePairing,
	createHubPairingSession,
	createPairingOffer,
	deviceFingerprint,
	encodePublicKey,
	type PairedDeviceRecord,
	type PairingAttestation,
} from "@cline/hub-pairing";
import { formatUptime, resolveClineBuildEnv } from "@cline/shared";
import { Command, InvalidArgumentError } from "commander";
import { version as cliVersion } from "../../package.json";
import {
	buildHandoffPresentation,
	DEFAULT_HANDOFF_TTL_MS,
	formatHandoffJson,
	formatHandoffTerminalLines,
	type HandoffDeps,
	runHandoff,
} from "./handoff";
import { renderQrCode } from "./qr-code";

interface HubCommandIo {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
}

function parsePositiveSeconds(value: string): number {
	if (!/^\d+$/.test(value)) {
		throw new InvalidArgumentError(
			"must be a positive whole number of seconds",
		);
	}
	const seconds = Number(value);
	if (!Number.isSafeInteger(seconds) || seconds <= 0) {
		throw new InvalidArgumentError(
			"must be a positive whole number of seconds",
		);
	}
	return seconds;
}

function parseNonnegativeSeconds(value: string): number {
	if (!/^\d+$/.test(value)) {
		throw new InvalidArgumentError(
			"must be a non-negative whole number of seconds",
		);
	}
	const seconds = Number(value);
	if (!Number.isSafeInteger(seconds)) {
		throw new InvalidArgumentError(
			"must be a non-negative whole number of seconds",
		);
	}
	return seconds;
}

// ---------------------------------------------------------------------------
// Hub device identity + paired-device persistence
//
// The on-disk format lives in `@cline/core/hub/pairing` because the hub daemon
// reads the same tree: it loads the identity key and pending offers to complete
// a phone's pairing handshake itself. Re-exported here so `cline hub` keeps its
// existing entry points, and so there is exactly one implementation of a format
// two processes have to agree on.
// ---------------------------------------------------------------------------

export {
	createFileDeviceStore,
	loadOrCreateHubIdentity,
	openDeviceRegistry,
	resolveHubPairingDir,
};

// Terminal QR rendering lives in `./qr-code` so the TUI can render the same
// matrix without ANSI escapes. Re-exported here to keep the existing entry point.
export { renderQrCode };

// ---------------------------------------------------------------------------
// Pairing rendezvous
//
// `cline hub pair` publishes the offer into the 0600 `offers/` directory and then
// waits. Two things can satisfy that wait:
//
//   1. The running hub completes the handshake itself, over the phone's websocket
//      (`cline-hub-pair.v2.<offerId>`), and enrolls the device. This is the real
//      path: the phone talks to the hub, not to this process.
//   2. A local component drops `<offerId>.attestation.json` in and reads
//      `<offerId>.response.json` back. That seam predates the socket path and is
//      kept because it is the only way to complete a pairing without a hub.
//
// Whichever happens, the offer is single-use and its expiry is enforced by the
// component that completes it.
// ---------------------------------------------------------------------------

interface AttestationFile {
	version: number;
	offerId: string;
	message: string;
}

type PairingOutcome =
	| { kind: "attestation"; attestation: PairingAttestation }
	| { kind: "enrolled"; record: PairedDeviceRecord };

async function pollForPairing(
	offerId: string,
	expiresAt: number,
	pollIntervalMs: number,
	now: () => number,
	sleep: (ms: number) => Promise<void>,
	knownDeviceIds: ReadonlySet<string>,
): Promise<PairingOutcome | undefined> {
	const path = join(hubPairingOffersDir(), `${offerId}.attestation.json`);
	while (now() < expiresAt) {
		try {
			const parsed = JSON.parse(
				await readFile(path, "utf8"),
			) as AttestationFile;
			await rm(path, { force: true }).catch(() => undefined);
			return {
				kind: "attestation",
				attestation: {
					version: parsed.version,
					offerId: parsed.offerId,
					message: base64UrlToBytes(parsed.message),
				},
			};
		} catch {
			// Not there yet.
		}
		// The hub may have finished the handshake on its own socket. Re-reading the
		// store is how this process learns that, since the enrollment happened in
		// another process entirely.
		const enrolled = (await openDeviceRegistry())
			.list({ includeRevoked: true })
			.find((record) => !knownDeviceIds.has(record.deviceId));
		if (enrolled) {
			return { kind: "enrolled", record: enrolled };
		}
		await sleep(pollIntervalMs);
	}
	return undefined;
}

async function stopHubServer(_workspaceRoot: string): Promise<boolean> {
	const owner = resolveCliHubOwnerContext();
	const discovery = await readHubDiscovery(owner.discoveryPath);
	if (await stopLocalHubServerGracefully(owner)) {
		await clearHubDiscovery(owner.discoveryPath);
		return true;
	}
	const pid = discovery?.pid;
	if (pid) {
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			// best effort
		}
	}
	await clearHubDiscovery(owner.discoveryPath);
	return !!pid;
}

function formatHubUptimeFromStartedAt(
	startedAt: string | undefined,
): string | undefined {
	if (!startedAt) {
		return undefined;
	}
	const timestamp = Date.parse(startedAt);
	if (Number.isNaN(timestamp)) {
		return undefined;
	}
	return formatUptime(Date.now() - timestamp);
}

export function resolveCliHubOwnerContext() {
	return resolveClineBuildEnv() === "production"
		? resolveProductionHubOwnerContext()
		: resolveSharedHubOwnerContext();
}

/**
 * Ambient dependencies the pairing flow needs. Injectable so tests can drive the
 * wait loop without real clocks, real sleeps or the machine's real hostname.
 */
export interface HubCommandDeps {
	hostname: () => string;
	now: () => number;
	sleep: (ms: number) => Promise<void>;
	pollIntervalMs: number;
	/** Session `hub share` hands off when `--session` is absent. */
	latestSessionId: () => Promise<string | undefined>;
	openDeviceRegistry: NonNullable<HandoffDeps["openDeviceRegistry"]>;
	startRelayHandoff: NonNullable<HandoffDeps["startRelayHandoff"]>;
	shouldUseRelay: () => Promise<boolean>;
}

function defaultHubCommandDeps(): HubCommandDeps {
	return {
		hostname: () => hostname(),
		now: () => Date.now(),
		latestSessionId: async () => {
			// Lazy: the session backend is a large graph the other hub subcommands
			// never touch.
			const { listSessions } = await import("../session/session");
			const [latest] = await listSessions(1);
			return latest?.sessionId;
		},
		openDeviceRegistry,
		startRelayHandoff: async (input) => {
			const { startRelayHandoff } = await import("./handoff-relay");
			return await startRelayHandoff(input);
		},
		shouldUseRelay: async () => {
			const { hasRelayAccount } = await import("./handoff-relay");
			return hasRelayAccount();
		},
		sleep: (ms) =>
			new Promise((resolve) => {
				setTimeout(resolve, ms);
			}),
		pollIntervalMs: 250,
	};
}

function parseWaitSeconds(value: string): number {
	const parsed = Number.parseInt(value, 10);
	if (Number.isNaN(parsed) || parsed < 0) {
		throw new InvalidArgumentError(
			"--wait requires a non-negative number of seconds.",
		);
	}
	return parsed;
}

export function createHubCommand(
	io: HubCommandIo,
	setExitCode: (code: number) => void,
	depsOverrides: Partial<HubCommandDeps> = {},
): Command {
	const deps: HubCommandDeps = { ...defaultHubCommandDeps(), ...depsOverrides };
	let actionExitCode = 0;
	const fail = () => {
		actionExitCode = 1;
	};
	const action =
		<T extends unknown[]>(fn: (...args: T) => Promise<void>) =>
		async (...args: T) => {
			try {
				await fn(...args);
			} catch (error) {
				io.writeErr(error instanceof Error ? error.message : String(error));
				fail();
			}
		};

	const hub = new Command("hub")
		.description("Manage the local hub daemon")
		.exitOverride()
		.hook("postAction", () => {
			setExitCode(actionExitCode);
		})
		.option("--cwd <path>", "Workspace root", process.cwd())
		.option("--host <host>", "Hub host")
		.option("--port <port>", "Hub port", (value) => Number.parseInt(value, 10))
		.option("--pathname <path>", "Hub websocket path");

	hub.command("ensure").action(
		action(async () => {
			const opts = hub.opts<{
				cwd: string;
				host?: string;
				port?: number;
				pathname?: string;
			}>();
			const { url } = await ensureDetachedHubServer(opts.cwd, {
				host: opts.host,
				port: opts.port,
				pathname: opts.pathname,
			});
			io.writeln(url);
		}),
	);

	hub.command("start").action(
		action(async () => {
			const opts = hub.opts<{
				cwd: string;
				host?: string;
				port?: number;
				pathname?: string;
			}>();
			const { url } = await ensureDetachedHubServer(opts.cwd, {
				host: opts.host,
				port: opts.port,
				pathname: opts.pathname,
			});
			io.writeln(url);
		}),
	);

	hub.command("status").action(
		action(async () => {
			const owner = resolveCliHubOwnerContext();
			const discovery = await readHubDiscovery(owner.discoveryPath);
			const health = discovery?.url
				? await probeHubServer(discovery.url, {
						authToken: discovery.authToken,
					})
				: undefined;
			const uptime = formatHubUptimeFromStartedAt(health?.startedAt);
			io.writeln(
				JSON.stringify({
					running: !!health?.url,
					url: health?.url,
					pid: health?.pid,
					startedAt: health?.startedAt,
					uptime,
					cliVersion,
					coreVersion: health?.coreVersion ?? discovery?.coreVersion,
				}),
			);
		}),
	);

	hub.command("stop").action(
		action(async () => {
			const opts = hub.opts<{ cwd: string }>();
			const stopped = await stopHubServer(opts.cwd);
			io.writeln(JSON.stringify({ stopped }));
		}),
	);

	const remote = hub
		.command("remote")
		.description("Keep this machine reachable through your Cline account");
	remote
		.command("enable")
		.option("--name <name>", "Machine name shown on paired devices")
		.action(
			action(async (options: { name?: string }) => {
				const hubOptions = hub.opts<{ cwd: string }>();
				await ensureDetachedHubServer(hubOptions.cwd);
				const { ensureRemoteHostProcess } = await import(
					"./remote-host-lifecycle"
				);
				const status = await ensureRemoteHostProcess({
					...(options.name ? { machineName: options.name } : {}),
				});
				io.writeln(JSON.stringify({ enabled: true, ...status }));
			}),
		);
	remote.command("disable").action(
		action(async () => {
			const { disableRemoteHostProcess } = await import(
				"./remote-host-lifecycle"
			);
			const stopped = await disableRemoteHostProcess();
			io.writeln(JSON.stringify({ enabled: false, stopped }));
		}),
	);
	remote.command("status").action(
		action(async () => {
			const { readRemoteHostStatus } = await import("./remote-host-lifecycle");
			io.writeln(
				JSON.stringify(
					(await readRemoteHostStatus()) ?? {
						enabled: false,
						running: false,
					},
				),
			);
		}),
	);

	hub
		.command("pair")
		.description("Pair a phone with this machine by scanning a QR code")
		.option("--label <label>", "Label to record if the device sends none")
		.option(
			"--ttl <seconds>",
			"Seconds the pairing code stays valid",
			parseNonnegativeSeconds,
			60,
		)
		.option("--json", "Emit machine-readable output instead of a QR code")
		.action(
			action(
				async (pairOptions: {
					label?: string;
					ttl: number;
					json?: boolean;
				}) => {
					const owner = resolveCliHubOwnerContext();
					const discovery = await readHubDiscovery(owner.discoveryPath);
					if (!discovery?.url) {
						throw new Error(
							"The hub is not running. Start it with `cline hub start` first.",
						);
					}

					const identity = await loadOrCreateHubIdentity();
					const hubName = deps.hostname();
					const { offer, uri, expiresAt } = createPairingOffer({
						hubPublicKey: identity.publicKey,
						hubName,
						url: discovery.url,
						ttlMs: Math.max(1, pairOptions.ttl * 1000),
						// Same clock as the wait loop below, so the offer's expiry and our
						// idea of "expired" can never disagree.
						now: deps.now,
					});
					// The session snapshots the offer's remaining TTL, so it must read the
					// same clock the offer was minted on.
					const session = createHubPairingSession(offer, identity.privateKey, {
						now: deps.now,
					});
					// Publish it where the running hub will look. Without this the phone
					// would open a `cline-hub-pair.v2.<offerId>` socket and the hub would have
					// no record of the offer to complete.
					await writePairingOffer(offer);
					// Devices already enrolled, so a *new* row is unambiguous evidence that
					// the hub completed this pairing on the phone's socket.
					const knownDeviceIds = new Set(
						(await openDeviceRegistry())
							.list({ includeRevoked: true })
							.map((record) => record.deviceId),
					);

					if (pairOptions.json) {
						io.writeln(
							JSON.stringify({
								offerId: offer.offerId,
								uri,
								expiresAt: new Date(expiresAt).toISOString(),
								hubName,
								hubFingerprint: deviceFingerprint(identity.publicKey),
							}),
						);
					} else {
						io.writeln();
						io.writeln(`Pair a device with ${hubName}`);
						io.writeln();
						for (const line of renderQrCode(uri)) {
							io.writeln(line);
						}
						io.writeln();
						io.writeln("Scan the code in the Cline app, or paste this URI:");
						io.writeln(`  ${uri}`);
						io.writeln();
						io.writeln(
							`This machine's fingerprint: ${deviceFingerprint(identity.publicKey)}`,
						);
						io.writeln(
							`Code expires in ${Math.max(1, pairOptions.ttl)}s. Waiting…`,
						);
					}

					const outcome = await pollForPairing(
						offer.offerId,
						expiresAt,
						deps.pollIntervalMs,
						deps.now,
						deps.sleep,
						knownDeviceIds,
					);
					if (!outcome) {
						// The offer stays on disk until it expires otherwise, and its secret
						// is readable there.
						await deletePairingOffer(offer.offerId).catch(() => undefined);
						throw new Error(
							"Pairing code expired before a device completed pairing.",
						);
					}

					const registry = await openDeviceRegistry();
					let record: PairedDeviceRecord;
					let fingerprint: string;
					if (outcome.kind === "enrolled") {
						// The hub already did the handshake, wrote the record and consumed the
						// offer; this process only reports it.
						// `--label` is only a fallback for a device that named itself nothing,
						// and the hub already applied the device's own label, so it does not
						// apply on this branch.
						record = outcome.record;
						fingerprint = registry.fingerprintOf(record);
					} else {
						// Same clock again: with `Date.now()` here an injected clock would
						// make every pairing fail as expired.
						const completed = completePairing(session, outcome.attestation, {
							now: deps.now,
						});
						record = await registry.add({
							publicKey: completed.device.publicKey,
							label: pairOptions.label ?? completed.device.label,
						});
						fingerprint = completed.device.fingerprint;
						// Hand the hub's half of the handshake back so the device can finish.
						await writePrivateFile(
							join(hubPairingOffersDir(), `${offer.offerId}.response.json`),
							`${JSON.stringify({
								version: completed.response.version,
								offerId: completed.response.offerId,
								message: encodePublicKey(completed.response.message),
							})}\n`,
						);
						await deletePairingOffer(offer.offerId).catch(() => undefined);
					}

					if (pairOptions.json) {
						io.writeln(
							JSON.stringify({
								paired: true,
								deviceId: record.deviceId,
								fingerprint,
								label: record.label,
								approvalPolicy: registry.getApprovalPolicy(record.deviceId),
							}),
						);
						return;
					}
					io.writeln();
					io.writeln(`Paired "${record.label}"`);
					io.writeln(`  device id:   ${record.deviceId}`);
					io.writeln(`  fingerprint: ${fingerprint}`);
					io.writeln(
						"  permissions: read=auto, write=ask, execute=ask (change with `cline hub devices policy`)",
					);
				},
			),
		);

	hub
		.command("share")
		.description("Hand the session you are in to your phone (QR + deep link)")
		.option(
			"--session <id>",
			"Session to open on the phone (default: most recent; 'none' to let the phone choose)",
		)
		.option("--name <name>", "Machine name shown on the phone")
		.option(
			"--ttl <seconds>",
			"Seconds the handoff link stays valid",
			parsePositiveSeconds,
			DEFAULT_HANDOFF_TTL_MS / 1000,
		)
		.option(
			"--relay",
			"Route through your Cline account's relay instead of this machine's own address (for a phone on another network)",
		)
		.option(
			"--direct",
			"Use this machine's own address even when signed in (same network only)",
		)
		.option("--json", "Emit machine-readable output instead of a QR code")
		.action(
			action(
				async (shareOptions: {
					session?: string;
					name?: string;
					ttl: number;
					relay?: boolean;
					direct?: boolean;
					json?: boolean;
				}) => {
					const requested = shareOptions.session?.trim();
					const viaRelay = shareOptions.direct
						? false
						: shareOptions.relay || (await deps.shouldUseRelay());
					const result = await runHandoff(
						{
							// `none` is the explicit way to say "no opinion", which makes the
							// phone land in its own session list.
							sessionId: requested === "none" ? "" : requested,
							machineName: shareOptions.name,
							ttlMs: shareOptions.ttl * 1000,
							viaRelay,
						},
						{
							now: deps.now,
							hostname: deps.hostname,
							readHubEndpoint: async () => {
								const owner = resolveCliHubOwnerContext();
								const discovery = await readHubDiscovery(owner.discoveryPath);
								return discovery?.url
									? { url: discovery.url, authToken: discovery.authToken }
									: undefined;
							},
							latestSessionId:
								requested === "none"
									? async () => undefined
									: deps.latestSessionId,
							openDeviceRegistry: deps.openDeviceRegistry,
							startRelayHandoff: deps.startRelayHandoff,
						},
					);
					if (shareOptions.json) {
						io.writeln(formatHandoffJson(result));
						return;
					}
					for (const line of formatHandoffTerminalLines(
						buildHandoffPresentation(result),
					)) {
						io.writeln(line);
					}
				},
			),
		);

	const devices = hub
		.command("devices")
		.description("List and manage devices paired with this machine");

	devices.action(
		action(async () => {
			const devicesOptions = devices.opts<{ json?: boolean; all?: boolean }>();
			const registry = await openDeviceRegistry();
			const records = registry.list({ includeRevoked: devicesOptions.all });
			if (devicesOptions.json) {
				io.writeln(
					JSON.stringify(
						records.map((record) => ({
							...record,
							fingerprint: registry.fingerprintOf(record),
							approvalPolicy: registry.getApprovalPolicy(record.deviceId),
						})),
					),
				);
				return;
			}
			if (records.length === 0) {
				io.writeln("No paired devices. Run `cline hub pair` to add one.");
				return;
			}
			for (const record of records) {
				const policy = registry.getApprovalPolicy(record.deviceId);
				io.writeln(
					`${record.deviceId}  ${record.label}${record.revokedAt ? " (revoked)" : ""}`,
				);
				io.writeln(`  fingerprint: ${registry.fingerprintOf(record)}`);
				io.writeln(`  paired:      ${record.pairedAt}`);
				io.writeln(`  last seen:   ${record.lastSeenAt ?? "never"}`);
				io.writeln(
					`  permissions: read=${policy.read}, write=${policy.write}, execute=${policy.execute}`,
				);
			}
		}),
	);
	devices.option("--json", "Emit machine-readable output");
	devices.option("--all", "Include revoked devices");

	devices
		.command("revoke")
		.argument("<deviceId>", "Device id from `cline hub devices`")
		// Precise about what this process can and cannot do: it owns no hub session,
		// so it revokes by persisting the marker. The process that holds a live
		// channel is the one that can close it, and it does so when it sees the
		// change (DeviceRegistry.startRevocationWatch / syncRevocations).
		.description(
			"Revoke a device: it can no longer connect, and any running session is dropped as soon as the hub sees the revocation",
		)
		.action(
			action(async (deviceId: string) => {
				const registry = await openDeviceRegistry();
				const terminated = registry.liveChannelCount(deviceId);
				const record = await registry.revoke(deviceId);
				io.writeln(
					JSON.stringify({
						revoked: true,
						deviceId: record.deviceId,
						label: record.label,
						revokedAt: record.revokedAt,
						// Sessions this process itself was holding. A `cline` invocation
						// holds none; a running hub terminates its own.
						sessionsTerminated: terminated,
						enforcement:
							"persisted; the process holding any live session terminates it on its next store sync",
					}),
				);
			}),
		);

	devices
		.command("policy")
		.argument("<deviceId>", "Device id from `cline hub devices`")
		.description("Show or change what a device may do without asking")
		.option("--read <auto|ask>", "Policy for read-tier tools")
		.option("--write <auto|ask>", "Policy for write-tier tools")
		.option("--execute <auto|ask>", "Policy for execute-tier tools")
		.action(
			action(
				async (
					deviceId: string,
					policyOptions: {
						read?: string;
						write?: string;
						execute?: string;
					},
				) => {
					const registry = await openDeviceRegistry();
					if (!registry.get(deviceId)) {
						// Reporting the strictest fallback and exiting 0 would imply the
						// device exists and is locked down.
						throw new Error(`Unknown device: ${deviceId}`);
					}
					const requested = parsePolicyFlags(policyOptions);
					const policy =
						requested === undefined
							? registry.getApprovalPolicy(deviceId)
							: await registry.setApprovalPolicy(deviceId, {
									...registry.getApprovalPolicy(deviceId),
									...requested,
								});
					io.writeln(JSON.stringify({ deviceId, approvalPolicy: policy }));
				},
			),
		);

	hub
		.command("drain")
		.description("Refuse new mutating work while accepted runs finish")
		.option("--reason <text>", "Why the hub is draining")
		.option("--off", "Lift the drain and accept new mutating work again")
		.action(
			action(async (cmdOptions: { reason?: string; off?: boolean }) => {
				const owner = resolveCliHubOwnerContext();
				const discovery = await readHubDiscovery(owner.discoveryPath);
				if (!discovery?.url) {
					io.writeErr("No hub is running.");
					fail();
					return;
				}
				const draining = cmdOptions.off !== true;
				const ok = await requestHubDrain(
					discovery.url,
					discovery.authToken,
					cmdOptions.reason ??
						(draining ? "cline hub drain" : "cline hub drain --off"),
					{ off: !draining },
				);
				if (!ok) {
					io.writeErr(
						draining
							? "Hub drain request failed."
							: "Hub un-drain request failed.",
					);
					fail();
					return;
				}
				io.writeln(JSON.stringify({ draining, url: discovery.url }));
			}),
		);

	hub
		.command("upgrade")
		.description(
			"Drain, wait for the hub to go idle, stop it, and start a fresh one",
		)
		.option(
			"--wait <seconds>",
			"How long to wait for the hub to go idle",
			parseWaitSeconds,
			120,
		)
		.action(
			action(async (cmdOptions: { wait: number }) => {
				const opts = hub.opts<{
					cwd: string;
					host?: string;
					port?: number;
					pathname?: string;
				}>();
				const owner = resolveCliHubOwnerContext();
				const discovery = await readHubDiscovery(owner.discoveryPath);
				if (discovery?.url) {
					const drained = await requestHubDrain(
						discovery.url,
						discovery.authToken,
						"cline hub upgrade",
					).catch(() => false);
					// An aborted upgrade must hand the hub back: leaving it
					// draining refuses all new mutating work until a restart.
					const undrain = async (): Promise<void> => {
						if (!drained) {
							return;
						}
						await requestHubDrain(
							discovery.url,
							discovery.authToken,
							"cline hub upgrade aborted",
							{ off: true },
						).catch(() => false);
					};
					try {
						const deadline = Date.now() + cmdOptions.wait * 1_000;
						let idle = false;
						// Check at least once so --wait 0 still observes an idle hub.
						for (;;) {
							idle = await localHubHasNoActiveSessions(
								discovery.url,
								discovery.authToken,
							).catch(() => true);
							if (idle || Date.now() >= deadline) {
								break;
							}
							await new Promise((resolve) => setTimeout(resolve, 1_000));
						}
						if (!idle) {
							await undrain();
							io.writeErr(
								"Hub is still serving sessions after the wait window; not replacing it. Re-run with a longer --wait, or finish the sessions first.",
							);
							fail();
							return;
						}
						await stopHubServer(opts.cwd);
					} catch (error) {
						await undrain();
						throw error;
					}
				}
				const { url } = await ensureDetachedHubServer(opts.cwd, {
					host: opts.host,
					port: opts.port,
					pathname: opts.pathname,
				});
				io.writeln(JSON.stringify({ upgraded: true, url }));
			}),
		);
	return hub;
}

function parsePolicyFlags(flags: {
	read?: string;
	write?: string;
	execute?: string;
}): Partial<ApprovalPolicy> | undefined {
	const entries = (["read", "write", "execute"] as const).flatMap((tier) => {
		const value = flags[tier];
		if (value === undefined) {
			return [];
		}
		if (value !== "auto" && value !== "ask") {
			throw new Error(`--${tier} must be "auto" or "ask", got "${value}"`);
		}
		return [[tier, value] as const];
	});
	return entries.length === 0
		? undefined
		: (Object.fromEntries(entries) as Partial<ApprovalPolicy>);
}
