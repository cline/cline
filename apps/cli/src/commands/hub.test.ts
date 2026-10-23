import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockClearHubDiscovery,
	mockEnsureDetachedHubServer,
	mockLocalHubHasNoActiveSessions,
	mockProbeHubServer,
	mockReadHubDiscovery,
	mockRequestHubDrain,
	mockResolveProductionHubOwnerContext,
	mockResolveSharedHubOwnerContext,
	mockStopLocalHubServerGracefully,
} = vi.hoisted(() => ({
	mockClearHubDiscovery: vi.fn(),
	mockEnsureDetachedHubServer: vi.fn(),
	mockLocalHubHasNoActiveSessions: vi.fn(),
	mockProbeHubServer: vi.fn(),
	mockReadHubDiscovery: vi.fn(),
	mockRequestHubDrain: vi.fn(),
	mockResolveProductionHubOwnerContext: vi.fn(() => ({
		ownerId: "hub-production",
		discoveryPath: "/tmp/cline-data/locks/hub/production.json",
	})),
	mockResolveSharedHubOwnerContext: vi.fn(() => ({
		ownerId: "hub-owner",
		discoveryPath: "/tmp/cline-data/locks/hub/owners/hub-owner.json",
	})),
	mockStopLocalHubServerGracefully: vi.fn(),
}));

vi.mock("@cline/core", () => ({
	clearHubDiscovery: mockClearHubDiscovery,
	ensureDetachedHubServer: mockEnsureDetachedHubServer,
	localHubHasNoActiveSessions: mockLocalHubHasNoActiveSessions,
	probeHubServer: mockProbeHubServer,
	readHubDiscovery: mockReadHubDiscovery,
	requestHubDrain: mockRequestHubDrain,
	resolveProductionHubOwnerContext: mockResolveProductionHubOwnerContext,
	resolveSharedHubOwnerContext: mockResolveSharedHubOwnerContext,
	stopLocalHubServerGracefully: mockStopLocalHubServerGracefully,
}));

const { mockResolveClineDataDir } = vi.hoisted(() => ({
	mockResolveClineDataDir: vi.fn(() => "/tmp/cline-data"),
}));

// The pairing flow writes a 0600 identity key and a device registry, so tests
// point the data dir at a throwaway directory instead of the real one.
vi.mock("@cline/shared/storage", () => ({
	resolveClineDataDir: mockResolveClineDataDir,
}));

import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	acceptPairingOffer,
	createPairingOffer,
	type DeviceRegistry,
	decodeHandoffUri,
	decodePairingUri,
	deviceFingerprint,
	deviceIdFromPublicKey,
	encodePairingUri,
	encodePublicKey,
	generateDeviceKeyPair,
} from "@cline/hub-pairing";
import { version as cliVersion } from "../../package.json";
import {
	buildHandoffPresentation,
	formatHandoffTerminalLines,
} from "./handoff";
import type { StartRelayHandoffInput } from "./handoff-relay";
import { createHubCommand, renderQrCode } from "./hub";

const originalBuildEnv = process.env.CLINE_BUILD_ENV;

interface Harness {
	output: string[];
	errors: string[];
	exitCode: number;
}

function harness(): {
	state: Harness;
	io: { writeln: (text?: string) => void; writeErr: (text: string) => void };
	setExitCode: (code: number) => void;
} {
	const state: Harness = { output: [], errors: [], exitCode: 0 };
	return {
		state,
		io: {
			writeln: (text) => {
				state.output.push(text ?? "");
			},
			writeErr: (text) => {
				state.errors.push(text);
			},
		},
		setExitCode: (code) => {
			state.exitCode = code;
		},
	};
}

describe("createHubCommand", () => {
	afterEach(() => {
		vi.clearAllMocks();
		if (originalBuildEnv === undefined) {
			delete process.env.CLINE_BUILD_ENV;
		} else {
			process.env.CLINE_BUILD_ENV = originalBuildEnv;
		}
	});

	it("includes uptime in hub status output", async () => {
		vi.spyOn(Date, "now").mockReturnValue(
			new Date("2026-01-01T00:01:05.000Z").getTime(),
		);
		mockReadHubDiscovery.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			port: 25463,
			pid: 50174,
			startedAt: "2026-01-01T00:00:00.000Z",
		});
		mockProbeHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			port: 25463,
			pid: 50174,
			startedAt: "2026-01-01T00:00:00.000Z",
			coreVersion: "0.0.62",
		});

		const output: string[] = [];
		let exitCode = 0;
		const cmd = createHubCommand(
			{
				writeln: (text) => {
					output.push(text ?? "");
				},
				writeErr: () => {},
			},
			(code) => {
				exitCode = code;
			},
		);

		await cmd.parseAsync(["status"], { from: "user" });

		expect(exitCode).toBe(0);
		expect(JSON.parse(output[0] || "")).toMatchObject({
			running: true,
			url: "ws://127.0.0.1:25463/hub",
			pid: 50174,
			startedAt: "2026-01-01T00:00:00.000Z",
			uptime: "1m 5s",
			cliVersion,
			coreVersion: "0.0.62",
		});
	});

	function createCommand() {
		const output: string[] = [];
		const errors: string[] = [];
		let exitCode = 0;
		const cmd = createHubCommand(
			{
				writeln: (text) => {
					output.push(text ?? "");
				},
				writeErr: (text) => {
					errors.push(text);
				},
			},
			(code) => {
				exitCode = code;
			},
		);
		return {
			cmd,
			output,
			errors,
			exitCode: () => exitCode,
		};
	}

	it("sends an un-drain request with drain --off", async () => {
		mockReadHubDiscovery.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "token",
		});
		mockRequestHubDrain.mockResolvedValue(true);

		const { cmd, output, exitCode } = createCommand();
		await cmd.parseAsync(["drain", "--off"], { from: "user" });

		expect(exitCode()).toBe(0);
		expect(mockRequestHubDrain).toHaveBeenCalledWith(
			"ws://127.0.0.1:25463/hub",
			"token",
			"cline hub drain --off",
			{ off: true },
		);
		expect(JSON.parse(output[0] || "")).toEqual({
			draining: false,
			url: "ws://127.0.0.1:25463/hub",
		});
	});

	it("drains without the off flag by default", async () => {
		mockReadHubDiscovery.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "token",
		});
		mockRequestHubDrain.mockResolvedValue(true);

		const { cmd, output, exitCode } = createCommand();
		await cmd.parseAsync(["drain"], { from: "user" });

		expect(exitCode()).toBe(0);
		expect(mockRequestHubDrain).toHaveBeenCalledWith(
			"ws://127.0.0.1:25463/hub",
			"token",
			"cline hub drain",
			{ off: false },
		);
		expect(JSON.parse(output[0] || "")).toEqual({
			draining: true,
			url: "ws://127.0.0.1:25463/hub",
		});
	});

	it("replaces an idle hub with upgrade --wait 0 instead of skipping the idle check", async () => {
		mockReadHubDiscovery.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "token",
		});
		mockRequestHubDrain.mockResolvedValue(true);
		mockLocalHubHasNoActiveSessions.mockResolvedValue(true);
		mockStopLocalHubServerGracefully.mockResolvedValue(true);
		mockEnsureDetachedHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "new-token",
		});

		const { cmd, output, errors, exitCode } = createCommand();
		await cmd.parseAsync(["upgrade", "--wait", "0"], { from: "user" });

		expect(errors).toEqual([]);
		expect(exitCode()).toBe(0);
		expect(mockLocalHubHasNoActiveSessions).toHaveBeenCalled();
		expect(mockStopLocalHubServerGracefully).toHaveBeenCalled();
		expect(mockEnsureDetachedHubServer).toHaveBeenCalled();
		// The drain was never lifted manually: the drained hub was replaced.
		expect(mockRequestHubDrain).toHaveBeenCalledTimes(1);
		expect(JSON.parse(output[0] || "")).toEqual({
			upgraded: true,
			url: "ws://127.0.0.1:25463/hub",
		});
	});

	it("un-drains the hub when upgrade aborts because sessions are still active", async () => {
		mockReadHubDiscovery.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "token",
		});
		mockRequestHubDrain.mockResolvedValue(true);
		mockLocalHubHasNoActiveSessions.mockResolvedValue(false);

		const { cmd, errors, exitCode } = createCommand();
		await cmd.parseAsync(["upgrade", "--wait", "0"], { from: "user" });

		expect(exitCode()).toBe(1);
		expect(errors[0]).toContain("still serving sessions");
		expect(mockStopLocalHubServerGracefully).not.toHaveBeenCalled();
		expect(mockEnsureDetachedHubServer).not.toHaveBeenCalled();
		expect(mockRequestHubDrain).toHaveBeenCalledTimes(2);
		expect(mockRequestHubDrain).toHaveBeenLastCalledWith(
			"ws://127.0.0.1:25463/hub",
			"token",
			"cline hub upgrade aborted",
			{ off: true },
		);
	});

	it("rejects a non-numeric upgrade --wait instead of treating it as an expired deadline", async () => {
		mockReadHubDiscovery.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "token",
		});

		const { cmd } = createCommand();
		cmd.configureOutput({ writeErr: () => {} });
		for (const sub of cmd.commands) {
			sub.configureOutput({ writeErr: () => {} });
		}
		await expect(
			cmd.parseAsync(["upgrade", "--wait", "soon"], { from: "user" }),
		).rejects.toThrow("--wait requires a non-negative number of seconds.");
		expect(mockRequestHubDrain).not.toHaveBeenCalled();
	});

	it("passes the selected owner to graceful stop", async () => {
		process.env.CLINE_BUILD_ENV = "development";
		mockReadHubDiscovery.mockResolvedValue({
			url: "ws://127.0.0.1:25466/hub",
			port: 25466,
			pid: 50174,
		});
		mockStopLocalHubServerGracefully.mockResolvedValue(true);

		const output: string[] = [];
		let exitCode = 0;
		const cmd = createHubCommand(
			{
				writeln: (text) => {
					output.push(text ?? "");
				},
				writeErr: () => {},
			},
			(code) => {
				exitCode = code;
			},
		);

		await cmd.parseAsync(["stop"], { from: "user" });

		expect(exitCode).toBe(0);
		expect(mockStopLocalHubServerGracefully).toHaveBeenCalledWith({
			ownerId: "hub-owner",
			discoveryPath: "/tmp/cline-data/locks/hub/owners/hub-owner.json",
		});
		expect(JSON.parse(output[0] || "")).toEqual({ stopped: true });
	});
});

describe("hub pair", () => {
	let dataDir: string;

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "cline-pair-test-"));
		mockResolveClineDataDir.mockReturnValue(dataDir);
		mockReadHubDiscovery.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			port: 25463,
			pid: 50174,
		});
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	function pairDeps(
		overrides: Partial<Parameters<typeof createHubCommand>[2]> = {},
	) {
		return {
			hostname: () => "test-laptop",
			now: () => Date.now(),
			sleep: async () => {},
			pollIntervalMs: 0,
			...overrides,
		};
	}

	const offersDir = () => join(dataDir, "hub", "pairing", "offers");

	/** Clock that jumps forward on every read, so a wait loop expires at once. */
	function advancingClock(stepMs = 5_000): () => number {
		let current = 0;
		return () => {
			current += stepMs;
			return current;
		};
	}

	it("publishes the offer so the running hub can complete it, and reports what the hub enrolled", async () => {
		// The real path: the phone opens `cline-hub-pair.v2.<offerId>` against the hub,
		// the hub completes the handshake and writes the device record. This process
		// only publishes the offer and then reports the result.
		const { state, io, setExitCode } = harness();
		const device = generateDeviceKeyPair();
		let enrolled = false;
		const cmd = createHubCommand(
			io,
			setExitCode,
			pairDeps({
				sleep: async () => {
					if (enrolled) {
						return;
					}
					const uriLine = state.output.find((line) =>
						line.includes("cline-pair://v1?"),
					);
					if (!uriLine) {
						return;
					}
					const offer = decodePairingUri(uriLine.trim());
					// The offer must be on disk before the hub could possibly complete it.
					const stored = JSON.parse(
						await readFile(
							join(offersDir(), `${offer.offerId}.offer.json`),
							"utf8",
						),
					) as { offerId: string; oneTimeSecret: string };
					expect(stored.offerId).toBe(offer.offerId);
					expect(stored.oneTimeSecret).toBe(
						encodePublicKey(offer.oneTimeSecret),
					);

					// Stand in for the hub daemon: enroll the device and consume the offer.
					const { createFileDeviceStore } = await import("./hub");
					const { DeviceRegistry } = await import("@cline/hub-pairing");
					const registry = await DeviceRegistry.open(createFileDeviceStore());
					await registry.add({
						publicKey: device.publicKey,
						label: "Examples iPhone",
					});
					await rm(join(offersDir(), `${offer.offerId}.offer.json`));
					enrolled = true;
				},
			}),
		);

		await cmd.parseAsync(["pair"], { from: "user" });

		expect(state.errors).toEqual([]);
		expect(state.exitCode).toBe(0);
		const text = state.output.join("\n");
		expect(text).toContain(`Paired "Examples iPhone"`);
		expect(text).toContain(deviceFingerprint(device.publicKey));
	});

	it("cleans up the published offer when nobody pairs before it expires", async () => {
		const { state, io, setExitCode } = harness();
		const cmd = createHubCommand(
			io,
			setExitCode,
			pairDeps({ now: advancingClock() }),
		);

		await cmd.parseAsync(["pair", "--ttl", "1"], { from: "user" });

		expect(state.exitCode).toBe(1);
		// A dead offer's one-time secret must not be left readable on disk.
		expect(
			(await readdir(offersDir()).catch(() => [] as string[])).filter((name) =>
				name.endsWith(".offer.json"),
			),
		).toEqual([]);
	});

	it("prints a QR code and a fallback URI, then completes pairing", async () => {
		const { state, io, setExitCode } = harness();
		const device = generateDeviceKeyPair();

		// Stand in for the phone: as soon as the offer URI is printed, drop the
		// device's attestation into the local rendezvous directory.
		let dropped = false;
		const cmd = createHubCommand(
			io,
			setExitCode,
			pairDeps({
				sleep: async () => {
					if (dropped) {
						return;
					}
					const uriLine = state.output.find((line) =>
						line.includes("cline-pair://v1?"),
					);
					if (!uriLine) {
						return;
					}
					const uri = uriLine.trim();
					const offer = decodePairingUri(uri);
					const pending = acceptPairingOffer(uri, device.privateKey, {
						metadata: { label: "Example's iPhone", platform: "ios" },
					});
					await writeFile(
						join(offersDir(), `${offer.offerId}.attestation.json`),
						JSON.stringify({
							version: pending.attestation.version,
							offerId: pending.attestation.offerId,
							message: encodePublicKey(pending.attestation.message),
						}),
					);
					dropped = true;
				},
			}),
		);

		await cmd.parseAsync(["pair"], { from: "user" });

		expect(state.errors).toEqual([]);
		expect(state.exitCode).toBe(0);
		const text = state.output.join("\n");
		expect(text).toContain("Pair a device with test-laptop");
		// The QR is rendered as half-blocks, not just the URI.
		expect(text).toMatch(/[█▀▄]/);
		expect(text).toContain("cline-pair://v1?");
		expect(text).toContain(`Paired "Example's iPhone"`);
		expect(text).toContain(deviceFingerprint(device.publicKey));
		expect(text).toContain("read=auto, write=ask, execute=ask");

		// The device landed in the on-disk registry.
		const devices = JSON.parse(
			await readFile(join(dataDir, "hub", "pairing", "devices.json"), "utf8"),
		) as Array<{ label: string; approvalPolicy: unknown }>;
		expect(devices).toHaveLength(1);
		expect(devices[0]?.label).toBe("Example's iPhone");
		expect(devices[0]?.approvalPolicy).toEqual({
			read: "auto",
			write: "ask",
			execute: "ask",
		});
	});

	it("writes the hub identity key with 0600 permissions and reuses it", async () => {
		const first = harness();
		const cmdOne = createHubCommand(
			first.io,
			first.setExitCode,
			pairDeps({ now: advancingClock() }),
		);
		// Expires immediately, so it does not wait; the key is still created.
		await cmdOne.parseAsync(["pair", "--ttl", "0"], { from: "user" });

		const identityPath = join(dataDir, "hub", "pairing", "identity.json");
		const stats = await stat(identityPath);
		expect(stats.mode & 0o777).toBe(0o600);

		const before = await readFile(identityPath, "utf8");
		const second = harness();
		const cmdTwo = createHubCommand(
			second.io,
			second.setExitCode,
			pairDeps({ now: advancingClock() }),
		);
		await cmdTwo.parseAsync(["pair", "--ttl", "0"], { from: "user" });
		// A second pair run must not rotate the machine identity.
		expect(await readFile(identityPath, "utf8")).toBe(before);
	});

	it("emits the offer as JSON when asked", async () => {
		const { state, io, setExitCode } = harness();
		const cmd = createHubCommand(
			io,
			setExitCode,
			pairDeps({ now: advancingClock() }),
		);
		await cmd.parseAsync(["pair", "--ttl", "0", "--json"], { from: "user" });

		const offer = JSON.parse(state.output[0] as string) as {
			uri: string;
			hubName: string;
			hubFingerprint: string;
		};
		expect(offer.hubName).toBe("test-laptop");
		expect(offer.uri).toContain("cline-pair://v1?");
		expect(offer.hubFingerprint).toMatch(
			/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/,
		);
	});

	it("fails when the hub is not running", async () => {
		mockReadHubDiscovery.mockResolvedValue(undefined);
		const { state, io, setExitCode } = harness();
		const cmd = createHubCommand(io, setExitCode, pairDeps());
		await cmd.parseAsync(["pair"], { from: "user" });
		expect(state.exitCode).toBe(1);
		expect(state.errors.join("\n")).toContain("hub is not running");
	});

	it("reports expiry when no device pairs in time", async () => {
		const { state, io, setExitCode } = harness();
		const cmd = createHubCommand(
			io,
			setExitCode,
			pairDeps({ now: advancingClock() }),
		);
		await cmd.parseAsync(["pair", "--ttl", "0"], { from: "user" });
		expect(state.exitCode).toBe(1);
		expect(state.errors.join("\n")).toContain("expired");
	});

	it("ATTACK: a damaged identity file is never silently rotated", async () => {
		// Rotating the laptop's root-equivalent key invalidates the pinned key on
		// every paired device, so a parse failure must be reported, not "fixed".
		const identityPath = join(dataDir, "hub", "pairing", "identity.json");
		const first = harness();
		await createHubCommand(
			first.io,
			first.setExitCode,
			pairDeps({ now: advancingClock() }),
		).parseAsync(["pair", "--ttl", "0"], { from: "user" });
		const original = await readFile(identityPath, "utf8");

		// Truncate it, the way an interrupted write or a bad editor save would.
		await writeFile(identityPath, original.slice(0, original.length - 5));
		const damaged = await readFile(identityPath, "utf8");

		const second = harness();
		await createHubCommand(
			second.io,
			second.setExitCode,
			pairDeps({ now: advancingClock() }),
		).parseAsync(["pair", "--ttl", "0"], { from: "user" });

		expect(second.state.exitCode).toBe(1);
		expect(second.state.errors.join("\n")).toMatch(/identity/i);
		// Above all: the file was not replaced with a new key.
		expect(await readFile(identityPath, "utf8")).toBe(damaged);
	});

	it("ATTACK: an identity file with a wrong-length key is refused, not rotated", async () => {
		const identityPath = join(dataDir, "hub", "pairing", "identity.json");
		await mkdir(join(dataDir, "hub", "pairing"), { recursive: true });
		await writeFile(
			identityPath,
			JSON.stringify({
				privateKey: encodePublicKey(new Uint8Array(16).fill(3)),
				publicKey: "x",
				createdAt: "2026-01-01T00:00:00.000Z",
			}),
		);
		const before = await readFile(identityPath, "utf8");
		const { state, io, setExitCode } = harness();
		await createHubCommand(
			io,
			setExitCode,
			pairDeps({ now: advancingClock() }),
		).parseAsync(["pair", "--ttl", "0"], { from: "user" });
		expect(state.exitCode).toBe(1);
		expect(await readFile(identityPath, "utf8")).toBe(before);
	});

	it("creates the pairing directories 0700 and files 0600", async () => {
		const { io, setExitCode } = harness();
		await createHubCommand(
			io,
			setExitCode,
			pairDeps({ now: advancingClock() }),
		).parseAsync(["pair", "--ttl", "0"], { from: "user" });

		// Offer ids and device file names are not for other local users to see.
		for (const dir of [
			join(dataDir, "hub"),
			join(dataDir, "hub", "pairing"),
			join(dataDir, "hub", "pairing", "offers"),
		]) {
			expect((await stat(dir)).mode & 0o777, dir).toBe(0o700);
		}
		expect(
			(await stat(join(dataDir, "hub", "pairing", "identity.json"))).mode &
				0o777,
		).toBe(0o600);
	});

	it("mints the offer and judges its expiry on the same injected clock", async () => {
		// A clock that is far behind the wall clock: if expiry is checked against
		// Date.now() while the offer was minted on this clock, every pairing fails as
		// expired no matter how fast the phone answers.
		const fixed = Date.parse("2020-01-01T00:00:00.000Z");
		const device = generateDeviceKeyPair();
		const { state, io, setExitCode } = harness();
		let dropped = false;
		const cmd = createHubCommand(
			io,
			setExitCode,
			pairDeps({
				now: () => fixed,
				sleep: async () => {
					if (dropped) {
						return;
					}
					const uriLine = state.output.find((line) =>
						line.includes("cline-pair://v1?"),
					);
					if (!uriLine) {
						return;
					}
					const uri = uriLine.trim();
					const offer = decodePairingUri(uri);
					const pending = acceptPairingOffer(uri, device.privateKey, {
						metadata: { label: "Example's iPhone" },
						now: () => fixed,
					});
					await writeFile(
						join(offersDir(), `${offer.offerId}.attestation.json`),
						JSON.stringify({
							version: pending.attestation.version,
							offerId: pending.attestation.offerId,
							message: encodePublicKey(pending.attestation.message),
						}),
					);
					dropped = true;
				},
			}),
		);

		await cmd.parseAsync(["pair"], { from: "user" });

		expect(state.errors).toEqual([]);
		expect(state.output.join("\n")).toContain(`Paired "Example's iPhone"`);
	});

	it("ATTACK: an attestation without the QR secret is refused by the CLI", async () => {
		const { state, io, setExitCode } = harness();
		const attacker = generateDeviceKeyPair();

		let dropped = false;
		const cmd = createHubCommand(
			io,
			setExitCode,
			pairDeps({
				sleep: async () => {
					if (dropped) {
						return;
					}
					const uriLine = state.output.find((line) =>
						line.includes("cline-pair://v1?"),
					);
					if (!uriLine) {
						return;
					}
					const offer = decodePairingUri(uriLine.trim());
					// The attacker knows the URL, hub key, offer id and expiry, but
					// substitutes a guessed one-time secret.
					const pending = acceptPairingOffer(
						{ ...offer, oneTimeSecret: new Uint8Array(32).fill(7) },
						attacker.privateKey,
						{ metadata: { label: "attacker" } },
					);
					await writeFile(
						join(offersDir(), `${offer.offerId}.attestation.json`),
						JSON.stringify({
							version: pending.attestation.version,
							offerId: pending.attestation.offerId,
							message: encodePublicKey(pending.attestation.message),
						}),
					);
					dropped = true;
				},
			}),
		);

		await cmd.parseAsync(["pair"], { from: "user" });

		expect(state.exitCode).toBe(1);
		expect(state.errors.join("\n")).toMatch(/attestation rejected/i);
		// Nothing was enrolled.
		await expect(
			readFile(join(dataDir, "hub", "pairing", "devices.json"), "utf8"),
		).rejects.toThrow();
	});
});

describe("hub devices", () => {
	let dataDir: string;

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "cline-devices-test-"));
		mockResolveClineDataDir.mockReturnValue(dataDir);
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	async function seedDevice(label = "iPhone"): Promise<string> {
		const { createFileDeviceStore } = await import("./hub");
		const { DeviceRegistry } = await import("@cline/hub-pairing");
		const registry = await DeviceRegistry.open(createFileDeviceStore());
		const record = await registry.add({
			publicKey: generateDeviceKeyPair().publicKey,
			label,
		});
		return record.deviceId;
	}

	it("reports when there are no paired devices", async () => {
		const { state, io, setExitCode } = harness();
		const cmd = createHubCommand(io, setExitCode);
		await cmd.parseAsync(["devices"], { from: "user" });
		expect(state.output.join("\n")).toContain("No paired devices");
	});

	it("lists a paired device with its fingerprint and policy", async () => {
		const deviceId = await seedDevice();
		const { state, io, setExitCode } = harness();
		const cmd = createHubCommand(io, setExitCode);
		await cmd.parseAsync(["devices"], { from: "user" });

		const text = state.output.join("\n");
		expect(text).toContain(deviceId);
		expect(text).toContain("iPhone");
		expect(text).toContain("read=auto, write=ask, execute=ask");
		expect(state.exitCode).toBe(0);
	});

	it("revokes a device and hides it from the default listing", async () => {
		const deviceId = await seedDevice();
		const revoke = harness();
		const revokeCmd = createHubCommand(revoke.io, revoke.setExitCode);
		await revokeCmd.parseAsync(["devices", "revoke", deviceId], {
			from: "user",
		});
		expect(JSON.parse(revoke.state.output[0] as string)).toMatchObject({
			revoked: true,
			deviceId,
		});

		const list = harness();
		const listCmd = createHubCommand(list.io, list.setExitCode);
		await listCmd.parseAsync(["devices"], { from: "user" });
		expect(list.state.output.join("\n")).toContain("No paired devices");

		const all = harness();
		const allCmd = createHubCommand(all.io, all.setExitCode);
		await allCmd.parseAsync(["devices", "--all"], { from: "user" });
		expect(all.state.output.join("\n")).toContain("(revoked)");
	});

	it("fails when revoking an unknown device", async () => {
		const { state, io, setExitCode } = harness();
		const cmd = createHubCommand(io, setExitCode);
		await cmd.parseAsync(["devices", "revoke", "NOSUCHDEVICE"], {
			from: "user",
		});
		expect(state.exitCode).toBe(1);
		expect(state.errors.join("\n")).toContain("Unknown device");
	});

	it("shows and updates a device's tiered policy", async () => {
		const deviceId = await seedDevice();

		const show = harness();
		await createHubCommand(show.io, show.setExitCode).parseAsync(
			["devices", "policy", deviceId],
			{ from: "user" },
		);
		expect(JSON.parse(show.state.output[0] as string).approvalPolicy).toEqual({
			read: "auto",
			write: "ask",
			execute: "ask",
		});

		const update = harness();
		await createHubCommand(update.io, update.setExitCode).parseAsync(
			["devices", "policy", deviceId, "--write", "auto"],
			{ from: "user" },
		);
		expect(JSON.parse(update.state.output[0] as string).approvalPolicy).toEqual(
			{
				read: "auto",
				write: "auto",
				execute: "ask",
			},
		);
	});

	it("rejects a policy value that is neither auto nor ask", async () => {
		const deviceId = await seedDevice();
		const { state, io, setExitCode } = harness();
		await createHubCommand(io, setExitCode).parseAsync(
			["devices", "policy", deviceId, "--execute", "always"],
			{ from: "user" },
		);
		expect(state.exitCode).toBe(1);
		expect(state.errors.join("\n")).toContain('must be "auto" or "ask"');
	});

	it("ATTACK: a corrupt devices.json is never silently replaced by a fresh one", async () => {
		// Presenting a corrupt store as "no devices" and then overwriting it on the
		// next pair destroys every record — including revocation markers, which is
		// how a revoked device would come back.
		const devicesPath = join(dataDir, "hub", "pairing", "devices.json");
		await seedDevice("iPhone");
		const good = await readFile(devicesPath, "utf8");
		await writeFile(devicesPath, good.slice(0, good.length - 12));
		const corrupt = await readFile(devicesPath, "utf8");

		const list = harness();
		await createHubCommand(list.io, list.setExitCode).parseAsync(["devices"], {
			from: "user",
		});
		expect(list.state.exitCode).toBe(1);
		expect(list.state.errors.join("\n")).toMatch(/devices\.json|unreadable/i);

		// And nothing rewrote it.
		expect(await readFile(devicesPath, "utf8")).toBe(corrupt);
	});

	it("ATTACK: a hostile record cannot crash the listing or smuggle a policy", async () => {
		const devicesPath = join(dataDir, "hub", "pairing", "devices.json");
		const device = generateDeviceKeyPair();
		await mkdir(join(dataDir, "hub", "pairing"), { recursive: true });
		await writeFile(
			devicesPath,
			JSON.stringify([
				{
					deviceId: deviceIdFromPublicKey(device.publicKey),
					publicKey: encodePublicKey(device.publicKey),
					label: "iPhone",
					// A number, not a string: `localeCompare` on this throws inside `list`.
					pairedAt: 17,
					approvalPolicy: { execute: "auto" },
				},
			]),
		);

		const crash = harness();
		await createHubCommand(crash.io, crash.setExitCode).parseAsync(
			["devices"],
			{
				from: "user",
			},
		);
		// The non-string field is refused, and above all it does not crash `list`.
		expect(crash.state.exitCode).toBe(1);
		expect(crash.state.errors.join("\n")).toMatch(/pairedAt/);
		expect(crash.state.errors.join("\n")).not.toMatch(
			/localeCompare|not a function/,
		);

		// With a well-formed pairedAt, the partial policy is the remaining hazard:
		// `normalizeApprovalPolicy` would pass `execute: "auto"` straight through.
		await writeFile(
			devicesPath,
			JSON.stringify([
				{
					deviceId: deviceIdFromPublicKey(device.publicKey),
					publicKey: encodePublicKey(device.publicKey),
					label: "iPhone",
					pairedAt: "2026-01-01T00:00:00.000Z",
					approvalPolicy: { execute: "auto" },
				},
			]),
		);
		const { state, io, setExitCode } = harness();
		await createHubCommand(io, setExitCode).parseAsync(["devices"], {
			from: "user",
		});
		expect(state.exitCode).toBe(0);
		// An incomplete policy collapses to the strictest one, not to "execute=auto".
		expect(state.output.join("\n")).toContain(
			"read=ask, write=ask, execute=ask",
		);
		expect(state.output.join("\n")).not.toContain("execute=auto");
	});

	it("ATTACK: a record whose id does not match its key is refused", async () => {
		const devicesPath = join(dataDir, "hub", "pairing", "devices.json");
		const attacker = generateDeviceKeyPair();
		const trusted = generateDeviceKeyPair();
		await mkdir(join(dataDir, "hub", "pairing"), { recursive: true });
		await writeFile(
			devicesPath,
			JSON.stringify([
				{
					deviceId: deviceIdFromPublicKey(attacker.publicKey),
					publicKey: encodePublicKey(trusted.publicKey),
					label: "iPhone",
					pairedAt: "2026-01-01T00:00:00.000Z",
					approvalPolicy: { read: "auto", write: "auto", execute: "auto" },
				},
			]),
		);
		const { state, io, setExitCode } = harness();
		await createHubCommand(io, setExitCode).parseAsync(["devices"], {
			from: "user",
		});
		expect(state.exitCode).toBe(1);
		expect(state.output.join("\n")).not.toContain("execute=auto");
	});

	it("ATTACK: `revoke` from this process kills a session another process is holding", async () => {
		// Two DeviceRegistry instances over the same devices.json stand in for two
		// processes: a hub holding a live encrypted channel, and this CLI. The CLI's
		// in-memory map is empty by construction, so the ONLY way its revoke can
		// reach the live channel is via the persisted marker the hub watches for.
		const { createFileDeviceStore } = await import("./hub");
		const { DeviceRegistry, acceptDeviceSession, startDeviceSession } =
			await import("@cline/hub-pairing");

		const hubIdentity = generateDeviceKeyPair();
		const device = generateDeviceKeyPair();
		const owner = await DeviceRegistry.open(createFileDeviceStore());
		const record = await owner.add({
			publicKey: device.publicKey,
			label: "iPhone",
		});
		const stopWatch = owner.startRevocationWatch();
		try {
			const pending = startDeviceSession({
				devicePrivateKey: device.privateKey,
				hubPublicKey: hubIdentity.publicKey,
			});
			const accepted = acceptDeviceSession({
				hubPrivateKey: hubIdentity.privateKey,
				registry: owner,
				message: pending.message,
			});
			const phone = pending.complete(accepted.message);
			expect(
				phone.channel.decryptFrame(accepted.channel.encryptFrame({ n: 1 })),
			);

			const { state, io, setExitCode } = harness();
			await createHubCommand(io, setExitCode).parseAsync(
				["devices", "revoke", record.deviceId],
				{ from: "user" },
			);
			expect(state.exitCode).toBe(0);

			// The owning process stops accepting frames from that device.
			await vi.waitFor(() => expect(accepted.channel.closed).toBe(true), {
				timeout: 5_000,
			});
			expect(() =>
				accepted.channel.decryptFrame(phone.channel.encryptFrame({ n: 2 })),
			).toThrow(/closed/);
			expect(() => accepted.channel.encryptFrame({ n: 3 })).toThrow(/closed/);
		} finally {
			stopWatch();
		}
	});

	it("errors on `policy` for a device that does not exist", async () => {
		// Returning the strictest fallback and exiting 0 reads as "this device exists
		// and is locked down", which is a dangerous thing to imply.
		const { state, io, setExitCode } = harness();
		await createHubCommand(io, setExitCode).parseAsync(
			["devices", "policy", "NOSUCHDEVICE"],
			{ from: "user" },
		);
		expect(state.exitCode).toBe(1);
		expect(state.errors.join("\n")).toContain("Unknown device");
	});

	it("revoke reports what it actually guarantees", async () => {
		const deviceId = await seedDevice();
		const { state, io, setExitCode } = harness();
		await createHubCommand(io, setExitCode).parseAsync(
			["devices", "revoke", deviceId],
			{ from: "user" },
		);
		const result = JSON.parse(state.output[0] as string) as {
			revoked: boolean;
			sessionsTerminated: number;
		};
		expect(result.revoked).toBe(true);
		// This process owns no channels, so it terminated none. The claim in the
		// command's own description must match.
		expect(result.sessionsTerminated).toBe(0);
		const description = createHubCommand(io, setExitCode)
			.commands.find((command) => command.name() === "devices")
			?.commands.find((command) => command.name() === "revoke")
			?.description();
		expect(description).not.toMatch(/terminate its active sessions/);
	});

	it("refuses to widen a revoked device's policy", async () => {
		const deviceId = await seedDevice();
		await createHubCommand(harness().io, () => {}).parseAsync(
			["devices", "revoke", deviceId],
			{ from: "user" },
		);
		const { state, io, setExitCode } = harness();
		await createHubCommand(io, setExitCode).parseAsync(
			["devices", "policy", deviceId, "--execute", "auto"],
			{ from: "user" },
		);
		expect(state.exitCode).toBe(1);
		expect(state.errors.join("\n")).toContain("revoked");
	});
});

describe("hub share", () => {
	let dataDir: string;
	const FIXED_NOW = 1_800_000_000_000;
	const HUB_TOKEN = "63baaf16".repeat(8);

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "cline-share-test-"));
		mockResolveClineDataDir.mockReturnValue(dataDir);
		mockReadHubDiscovery.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			// Present but deliberately unused by the default (hub) path: the link
			// carries a one-time pairing secret, never this token.
			authToken: HUB_TOKEN,
			port: 25463,
			pid: 50174,
		});
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	function shareDeps(
		overrides: Partial<Parameters<typeof createHubCommand>[2]> = {},
	) {
		return {
			hostname: () => "Examples-MacBook-Pro.local",
			now: () => FIXED_NOW,
			sleep: async () => {},
			pollIntervalMs: 0,
			latestSessionId: async () => "sess_latest",
			openDeviceRegistry: async () => ({}) as DeviceRegistry,
			startRelayHandoff: async (input: StartRelayHandoffInput) => {
				const relayUrl = "wss://session.cline.bot";
				const created = createPairingOffer({
					hubPublicKey: input.identity.publicKey,
					hubName: input.machineName,
					url: relayUrl,
					ttlMs: input.ttlMs,
					now: input.now,
					...(input.sessionId ? { sessionId: input.sessionId } : {}),
				});
				return {
					uri: encodePairingUri(created.offer, { format: "handoff" }),
					relayUrl,
					expiresAt: created.expiresAt,
					offerId: created.offer.offerId,
				};
			},
			shouldUseRelay: async () => false,
			...overrides,
		};
	}

	function uriFrom(output: string[]): string {
		const line = output.find((entry) =>
			entry.trim().startsWith("clinecode://handoff?"),
		);
		if (!line) {
			throw new Error(`No handoff URI in output:\n${output.join("\n")}`);
		}
		return line.trim();
	}

	it("prints a QR and a copyable deep link for the most recent session", async () => {
		const { state, io, setExitCode } = harness();
		const cmd = createHubCommand(io, setExitCode, shareDeps());

		await cmd.parseAsync(["share"], { from: "user" });

		expect(state.errors).toEqual([]);
		expect(state.exitCode).toBe(0);
		const text = state.output.join("\n");
		expect(text).toMatch(/[█▀▄]/);
		expect(text).toContain("Hand off to your phone — Examples MacBook Pro");
		expect(text).toContain("Scan this with Cline Code on your phone.");
		expect(text).toContain("Pairing code expires in 2 minutes");
		expect(text).toContain("hub token stays on this machine");

		const uri = uriFrom(state.output);
		// The URI must be alone on its line so it can be copied out of the terminal.
		expect(state.output).toContain(uri);
		const link = decodeHandoffUri(uri);
		expect(link.sessionId).toBe("sess_latest");
		// Straight at this machine's hub, which is what the phone pairs against.
		expect(link.url).toBe("ws://127.0.0.1:25463/hub");
		expect(link.hubName).toBe("Examples MacBook Pro");
		expect(link.expiresAt).toBe(FIXED_NOW + 120_000);
		expect(link.credential).not.toBe(HUB_TOKEN);
		expect(link.offerId).toBeDefined();
	});

	it("formats with the same implementation /handoff uses", async () => {
		const { state, io, setExitCode } = harness();
		const cmd = createHubCommand(io, setExitCode, shareDeps());

		await cmd.parseAsync(["share", "--session", "sess_shared"], {
			from: "user",
		});

		const uri = uriFrom(state.output);
		const link = decodeHandoffUri(uri);
		// Rebuild the shared presentation from what was printed: if `hub share` did
		// any bespoke formatting, these would not be line-for-line identical.
		const expected = formatHandoffTerminalLines(
			buildHandoffPresentation({
				uri,
				machineName: link.hubName,
				hubUrl: link.url,
				sessionId: link.sessionId,
				expiresAt: link.expiresAt,
				ttlMs: link.expiresAt - FIXED_NOW,
				fingerprint: deviceFingerprint(link.hubPublicKey),
				transport: "hub" as const,
				offerId: link.offerId ?? "",
			}),
		);
		expect(state.output).toEqual(expected);
	});

	it("pins an explicit session and can be told to pin none", async () => {
		const { state, io, setExitCode } = harness();
		const latestSessionId = vi.fn(async () => "sess_latest");
		const cmd = createHubCommand(
			io,
			setExitCode,
			shareDeps({ latestSessionId }),
		);

		await cmd.parseAsync(["share", "--session", "sess_explicit"], {
			from: "user",
		});
		expect(decodeHandoffUri(uriFrom(state.output)).sessionId).toBe(
			"sess_explicit",
		);
		expect(latestSessionId).not.toHaveBeenCalled();

		state.output.length = 0;
		await cmd.parseAsync(["share", "--session", "none"], { from: "user" });
		const uri = uriFrom(state.output);
		expect(uri).not.toContain("sid=");
		expect(decodeHandoffUri(uri).sessionId).toBeUndefined();
		expect(state.output.join("\n")).toContain("session list");
	});

	it("accepts --name and --ttl", async () => {
		const { state, io, setExitCode } = harness();
		const cmd = createHubCommand(io, setExitCode, shareDeps());

		await cmd.parseAsync(["share", "--name", "Work laptop", "--ttl", "45"], {
			from: "user",
		});

		const link = decodeHandoffUri(uriFrom(state.output));
		expect(link.hubName).toBe("Work laptop");
		expect(link.expiresAt).toBe(FIXED_NOW + 45_000);
		expect(state.output.join("\n")).toContain(
			"Pairing code expires in 45 seconds",
		);
	});

	it("emits JSON for scripting", async () => {
		const { state, io, setExitCode } = harness();
		const cmd = createHubCommand(io, setExitCode, shareDeps());

		await cmd.parseAsync(["share", "--json"], { from: "user" });

		expect(state.output).toHaveLength(1);
		const payload = JSON.parse(state.output[0] ?? "");
		expect(payload.sessionId).toBe("sess_latest");
		expect(payload.hubUrl).toBe("ws://127.0.0.1:25463/hub");
		expect(payload.transport).toBe("hub");
		expect(payload.expiresAt).toBe(new Date(FIXED_NOW + 120_000).toISOString());
		expect(payload.credential).toBe("one-time-pairing-secret");
		expect(payload.expiryEnforcedBy).toBe("machine");
		// No QR, no prose.
		expect(state.output.join("\n")).not.toMatch(/[█▀▄]/);
		expect(decodeHandoffUri(payload.uri).sessionId).toBe("sess_latest");
	});

	it("reuses the same hub identity key as `hub pair`", async () => {
		const { state, io, setExitCode } = harness();
		const cmd = createHubCommand(io, setExitCode, shareDeps());

		await cmd.parseAsync(["share", "--json"], { from: "user" });

		const identity = JSON.parse(
			await readFile(join(dataDir, "hub", "pairing", "identity.json"), "utf8"),
		);
		const payload = JSON.parse(state.output[0] ?? "");
		const link = decodeHandoffUri(payload.uri);
		expect(payload.hubFingerprint).toBe(deviceFingerprint(link.hubPublicKey));
		expect(encodePublicKey(link.hubPublicKey)).toBe(identity.publicKey);
	});

	it("hands off even when the hub published no token, because it does not need one", async () => {
		mockReadHubDiscovery.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			port: 25463,
			pid: 50174,
		});
		const { state, io, setExitCode } = harness();
		const cmd = createHubCommand(io, setExitCode, shareDeps());

		await cmd.parseAsync(["share", "--json"], { from: "user" });

		expect(state.exitCode).toBe(0);
		const payload = JSON.parse(state.output[0] ?? "");
		expect(payload.credential).toBe("one-time-pairing-secret");
		expect(state.output.join("\n")).not.toContain(HUB_TOKEN);
	});

	it("leaves the offer on disk for the hub to complete, and never the token", async () => {
		const { state, io, setExitCode } = harness();
		const cmd = createHubCommand(io, setExitCode, shareDeps());

		await cmd.parseAsync(["share", "--json"], { from: "user" });

		const payload = JSON.parse(state.output[0] ?? "");
		const stored = JSON.parse(
			await readFile(
				join(
					dataDir,
					"hub",
					"pairing",
					"offers",
					`${payload.offerId}.offer.json`,
				),
				"utf8",
			),
		);
		const link = decodeHandoffUri(payload.uri);
		// Same offer, same secret: this is the rendezvous the hub reads.
		expect(stored.offerId).toBe(link.offerId);
		expect(stored.oneTimeSecret).toBe(link.credential);
		expect(stored.url).toBe("ws://127.0.0.1:25463/hub");
		expect(stored.expiresAt).toBe(link.expiresAt);
		expect(JSON.stringify(stored)).not.toContain(HUB_TOKEN);
		// 0600: the file holds a live pairing secret.
		expect(
			(
				await stat(
					join(
						dataDir,
						"hub",
						"pairing",
						"offers",
						`${payload.offerId}.offer.json`,
					),
				)
			).mode & 0o777,
		).toBe(0o600);
	});

	it("routes through the relay on --relay, and then needs the hub token", async () => {
		const { state, io, setExitCode } = harness();
		const cmd = createHubCommand(io, setExitCode, shareDeps());

		await cmd.parseAsync(["share", "--relay", "--json"], { from: "user" });
		const payload = JSON.parse(state.output[0] ?? "");
		expect(payload.transport).toBe("relay");
		expect(payload.hubUrl).toBe("wss://session.cline.bot");

		mockReadHubDiscovery.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			port: 25463,
			pid: 50174,
		});
		const second = harness();
		const relayCmd = createHubCommand(
			second.io,
			second.setExitCode,
			shareDeps(),
		);
		await relayCmd.parseAsync(["share", "--relay"], { from: "user" });
		expect(second.state.exitCode).toBe(1);
		expect(second.state.errors.join("\n")).toContain("could not reach it");
	});

	it("defaults signed-in sharing to relay and lets --direct override it", async () => {
		const signedIn = harness();
		await createHubCommand(
			signedIn.io,
			signedIn.setExitCode,
			shareDeps({ shouldUseRelay: async () => true }),
		).parseAsync(["share", "--json"], { from: "user" });
		expect(JSON.parse(signedIn.state.output[0] ?? "").transport).toBe("relay");

		const direct = harness();
		await createHubCommand(
			direct.io,
			direct.setExitCode,
			shareDeps({ shouldUseRelay: async () => true }),
		).parseAsync(["share", "--direct", "--json"], { from: "user" });
		expect(JSON.parse(direct.state.output[0] ?? "").transport).toBe("hub");
	});

	it("tells the user to start the hub instead of minting a dead link", async () => {
		mockReadHubDiscovery.mockResolvedValue(undefined);
		const { state, io, setExitCode } = harness();
		const cmd = createHubCommand(io, setExitCode, shareDeps());

		await cmd.parseAsync(["share"], { from: "user" });

		expect(state.exitCode).toBe(1);
		expect(state.errors.join("\n")).toContain("cline hub start");
		expect(state.output.join("\n")).not.toContain("clinecode://");
	});
});

const ESC = "\u001b";

/** Drops ANSI SGR sequences without putting a control char in a regex literal. */
function visibleWidth(line: string): number {
	return line
		.split(ESC)
		.map((part, index) =>
			index === 0 ? part : part.replace(/^\[[0-9;]*m/, ""),
		)
		.join("").length;
}

describe("renderQrCode", () => {
	it("renders a square block of half-block characters with a quiet zone", () => {
		const lines = renderQrCode("cline-pair://v1?i=abc");
		expect(lines.length).toBeGreaterThan(8);
		// Every row is the same visible width.
		const widths = new Set(lines.map(visibleWidth));
		expect(widths.size).toBe(1);
		// Sets an explicit black-on-white colour pair so polarity survives dark
		// terminal themes; an inverted QR does not scan.
		expect(lines[0]).toContain(`${ESC}[30;47m`);
		expect(lines[0]?.endsWith(`${ESC}[0m`)).toBe(true);
	});

	it("grows the code to fit a longer payload", () => {
		const small = renderQrCode("short");
		const large = renderQrCode("x".repeat(300));
		expect(large.length).toBeGreaterThan(small.length);
	});
});
